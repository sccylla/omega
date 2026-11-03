'use strict';
// Explicit two-stage close of an EXISTING Bybit position. No new exposure,
// no unattended execution, and never a blind retry on an ambiguous response.
const crypto=require('node:crypto');
const auth=require('./bybit-demo');
const {LiveBroker}=require('./live-broker');
const SYMBOL=/^[A-Z0-9]{2,24}USDT$/,MAX_BODY=2200,TTL=45000;
const err=(status,message)=>Object.assign(new Error(message),{status});
function hmac(payload,key){return crypto.createHmac('sha256',key).update(payload).digest('hex')}
function secret(env){if(typeof env.OMEGA_SESSION_SECRET!=='string'||env.OMEGA_SESSION_SECRET.length<32)throw err(503,'Private session signing is not ready');return env.OMEGA_SESSION_SECRET}
function position(snapshot,symbol){
 if(!snapshot||!Array.isArray(snapshot.positions))throw err(409,'Bybit positions are unavailable; close is disabled');
 const matches=snapshot.positions.filter(p=>p.symbol===symbol&&Number(p.size)>0);
 if(matches.length!==1)throw err(409,'Selected Bybit position is no longer open or is ambiguous. Refresh the table.');
 const p=matches[0],size=String(p.size),entry=String(p.avgPrice);
 if(!['Buy','Sell'].includes(p.side)||Number(p.positionIdx)!==0||!Number.isFinite(Number(size))||
  Number(size)<=0||!Number.isFinite(Number(entry))||Number(entry)<=0)
  throw err(409,'Only one-way Bybit positions with verified size and entry may be closed here');
 return {symbol:p.symbol,side:p.side,size,entry,positionIdx:0};
}
function session(req,env){const c=auth.getCookie(req);if(!c)throw err(401,'Sign in before managing live positions');return hmac(c,secret(env)).slice(0,32)}
function signPreview(p,req,env,now){
 const data={v:1,...p,session:session(req,env),nonce:crypto.randomBytes(16).toString('hex'),expiresAt:now+TTL};
 const payload=Buffer.from(JSON.stringify(data)).toString('base64url');
 return payload+'.'+hmac(payload,secret(env));
}
function verifyPreview(token,req,env,now){
 if(typeof token!=='string'||token.length>1200||token.split('.').length!==2)throw err(400,'Close preview is missing; refresh and preview again');
 const [payload,sig]=token.split('.'),expected=hmac(payload,secret(env));
 if(!/^[a-f0-9]{64}$/.test(sig)||!crypto.timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(expected,'hex')))
  throw err(403,'Close preview did not come from this session');
 let d;try{d=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'))}catch{throw err(400,'Invalid close preview')}
 if(d.v!==1||!SYMBOL.test(d.symbol)||!['Buy','Sell'].includes(d.side)||d.positionIdx!==0||
  !(Number(d.size)>0)||!(Number(d.entry)>0)||!/^[a-f0-9]{32}$/.test(d.nonce)||
  d.session!==session(req,env)||!Number.isFinite(d.expiresAt)||d.expiresAt<=now||d.expiresAt>now+TTL+1000)
  throw err(409,'Close preview expired or position changed. Refresh and preview again.');
 return d;
}
function factory({broker=new LiveBroker(),authentication=auth,env=process.env,clock=()=>Date.now()}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  if(!authentication.isAuthed(req))return res.status(401).json({error:'Sign in before closing a real position'});
  try{
   authentication.assertOrigin(req);
   if(!req.body||JSON.stringify(req.body).length>MAX_BODY)throw err(400,'Invalid close request');
   if(!broker.ready())throw err(503,'Bybit live credentials unavailable');
   const symbol=String(req.body.symbol||'').toUpperCase();
   if(!SYMBOL.test(symbol))throw err(400,'Invalid Bybit position symbol');
   if(req.body.action==='preview_close'){
    const p=position(await broker.snapshot(),symbol);
    return res.status(200).json({...p,previewToken:signPreview(p,req,env,clock()),expiresInSeconds:45,
     warning:'This will submit a reduce-only MARKET close of the ENTIRE position. You may realize a loss; slippage and fees apply. No order has been placed.'});
   }
   if(req.body.action!=='close_position'||req.body.confirm!=='CLOSE REAL '+symbol)
    throw err(400,'Type CLOSE REAL '+symbol+' to confirm market closure');
   const signed=verifyPreview(req.body.previewToken,req,env,clock());
   if(signed.symbol!==symbol)throw err(409,'Close symbol differs from preview');
   const current=position(await broker.snapshot(),symbol);
   if(current.side!==signed.side||current.size!==signed.size||current.entry!==signed.entry)
    throw err(409,'Live position changed after preview. Refresh and authorize a new close.');
   // Idempotent identity: a repeated click cannot create a second distinct close.
   const link='omclose'+hmac('close:'+signed.nonce+':'+symbol,secret(env)).slice(0,27);
   let previous;
   try{previous=await broker.order(symbol,link)}catch{
    throw err(502,'Could not reconcile existing Bybit close request. Inspect Bybit before retrying.');
   }
   if(previous)throw err(409,'This close request was already submitted. Check Bybit fills and refresh positions.');
   if(clock()>=signed.expiresAt)throw err(409,'Preview expired while checking Bybit. Start again.');
   let accepted;
   try{accepted=await broker.close({symbol,side:current.side,size:current.size},link)}
   catch{throw err(502,'Close outcome uncertain. Inspect Bybit orders/positions before any retry.');}
   return res.status(202).json({submitted:true,symbol,side:current.side,
    quantity:current.size,orderLinkId:link,orderId:accepted?.orderId||null,
    message:'Reduce-only market close submitted to Bybit. Confirm fill and realized P&L by refreshing positions and exchange history; not yet verified as closed.'});
  }catch(e){return res.status(e.status||502).json({error:e.status?e.message:'Unable to confirm Bybit close outcome. Verify positions at Bybit.'})}
 };
}
module.exports=factory();
module.exports._test={factory,position,signPreview,verifyPreview};
