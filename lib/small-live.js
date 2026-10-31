'use strict';
// WEBSITE-ONLY one-order-at-a-time small-capital Bybit bridge, exported as a library handler.
// No autonomous real trading, no Telegram, no browser-submitted API secrets.
// Signed, session-bound, expiring preview; Bybit orderLinkId is deterministic
// per preview to prevent a replay from becoming a second distinct order.
const crypto=require('node:crypto');
const auth=require('../lib/bybit-demo');
const {LiveBroker}=require('../lib/live-broker');
const SYMBOLS=new Set(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','BNBUSDT']);
const ORDER_USD=15,MAX_USD=16,EXPOSURE=.20;
const TP_NET=.05,MAX_DAY_LOSS=1,MAX_RISK=.15,COST_RATE=.0022;
const TTL=60000,MAX_BODY=2200;
const err=(status,message)=>Object.assign(new Error(message),{status});
const need=(test,status,message)=>{if(!test)throw err(status,message)};
const hash=(data,secret)=>crypto.createHmac('sha256',secret).update(data).digest('hex');
const safe=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&
 crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
function security(env,authentication,req){
 const secret=env.OMEGA_SESSION_SECRET;
 need(typeof secret==='string'&&secret.length>=32,503,'Secure dashboard session secret unavailable');
 const cookie=authentication.getCookie(req);
 need(typeof cookie==='string'&&cookie.length>=32,401,'Sign in again to prepare a real trade');
 return {secret,owner:hash('website-small-live:'+cookie,secret).slice(0,32)};
}
function signPreview(data,env,authentication,req,now){
 const {secret,owner}=security(env,authentication,req);
 const input={version:1,owner,symbol:data.symbol,side:data.side,
  price:data.price,nonce:crypto.randomBytes(16).toString('hex'),expires:now+TTL};
 const payload=Buffer.from(JSON.stringify(input)).toString('base64url');
 return payload+'.'+hash('omega-small-live-v1:'+payload,secret);
}
function verifyPreview(token,env,authentication,req,now){
 const {secret,owner}=security(env,authentication,req);
 need(typeof token==='string'&&token.length<1000&&token.includes('.'),400,'Prepare a fresh signed order first');
 const [payload,sig,...extra]=token.split('.');
 need(!extra.length&&/^[a-f0-9]{64}$/.test(sig||'')&&
  safe(hash('omega-small-live-v1:'+payload,secret),sig),403,'Signed order preview invalid');
 let v;try{v=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'))}catch{throw err(400,'Invalid preview data')}
 need(v?.version===1&&v.owner===owner&&SYMBOLS.has(v.symbol)&&
  ['Buy','Sell'].includes(v.side)&&Number.isFinite(v.price)&&v.price>0&&
  /^[a-f0-9]{32}$/.test(v.nonce||'')&&Number.isSafeInteger(v.expires)&&
  v.expires>now&&v.expires<=now+TTL+1000,409,'Signed preview expired or belongs to a different session');
 return v;
}
function linkForPreview(v,env){
 return 'omweb'+hash('omega-web-small-link:'+v.nonce,env.OMEGA_SESSION_SECRET).slice(0,28);
}
function risk(snapshot,ticket){
 need(snapshot&&Number.isFinite(snapshot.equity)&&Number.isFinite(snapshot.available)&&
  Number.isFinite(snapshot.pnlToday)&&Array.isArray(snapshot.positions)&&Array.isArray(snapshot.pending),
  409,'Incomplete Bybit account snapshot; cannot trade');
 need(snapshot.equity>=ORDER_USD/EXPOSURE&&snapshot.available>=ORDER_USD,409,
  'A $15 real trade at 20% maximum exposure needs at least $75 total equity and $15 available');
 need(snapshot.positions.length===0&&snapshot.pending.length===0,409,
  'Existing Bybit position or pending entry must be reconciled first');
 need(snapshot.pnlToday>-MAX_DAY_LOSS,409,'The $1 broker-reported daily loss limit has been reached');
 need(ticket&&Number.isFinite(ticket.notional)&&ticket.notional>=ORDER_USD-1e-8&&
  ticket.notional<=MAX_USD&&ticket.notional<=snapshot.equity*EXPOSURE&&ticket.notional<=snapshot.available,
  409,'Exchange-adjusted order exceeds $15–$16 or the 20% account exposure cap');
 need(Number.isFinite(ticket.price)&&ticket.price>0&&Number(ticket.qty)>0&&
  Number(ticket.stopLoss)>0&&Number(ticket.takeProfit)>0&&
  Number.isFinite(ticket.estimatedTakeProfitNetUsd)&&ticket.estimatedTakeProfitNetUsd+1e-8>=TP_NET,
  409,'Invalid exchange position size or after-cost profit/stop prices');
 const rate=Math.max(COST_RATE,Number(ticket.estimatedRoundTripCostRate)||0);
 const totalRisk=Math.abs(ticket.price-Number(ticket.stopLoss))*Number(ticket.qty)+ticket.notional*rate;
 const limit=Math.min(MAX_RISK,snapshot.equity*.0025,MAX_DAY_LOSS+Math.min(0,snapshot.pnlToday));
 need(Number.isFinite(totalRisk)&&totalRisk>0&&limit>0&&totalRisk<=limit,
  409,'Estimated stop plus costs exceeds the small-account risk limit');
 return {stopRiskUsd:totalRisk,dailyLossLimitUsd:MAX_DAY_LOSS};
}
async function marketPlan(broker,symbol,side){
 need(SYMBOLS.has(symbol)&&['Buy','Sell'].includes(side),400,'Choose a supported USDT perpetual and Buy or Sell');
 const tickers=await broker.request('GET','/v5/market/tickers',{category:'linear',symbol},false);
 const t=tickers.list?.[0],bid=Number(t?.bid1Price),ask=Number(t?.ask1Price);
 need(t?.symbol===symbol&&Number.isFinite(bid)&&Number.isFinite(ask)&&
  bid>0&&ask>bid,409,'Current public market quote unavailable');
 const spread=10000*(ask-bid)/((ask+bid)/2);
 need(spread<=2.5,409,'Bid/ask spread exceeds 2.5 basis points; trade blocked');
 return {price:side==='Buy'?ask:bid,stopPct:.30,targetNet:TP_NET,slippageBps:5};
}
function factory({env=process.env,broker=new LiveBroker({env}),authentication=auth,clock=()=>Date.now()}={}){
 const enabled=()=>env.OMEGA_SMALL_LIVE_ORDERS_ENABLED==='true';
 async function prepare(symbol,side){
  need(broker.ready(),503,'Bybit trading credentials are not configured on this website server');
  const snapshot=await broker.snapshot();
  // Avoid converting data-fetch failures into apparent qualification.
  const plan=await marketPlan(broker,symbol,side);
  const ticket=await broker.ticket(symbol,side,plan,{notionalUsd:ORDER_USD,maxNotionalUsd:MAX_USD});
  return {snapshot,ticket,limits:risk(snapshot,ticket)};
 }
 return async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET or POST only'});
  if(!authentication.isAuthed(req))return res.status(401).json({error:'Sign into your OMEGA dashboard first'});
  try{
   if(req.method==='GET'){
    const action=String(req.query?.action||'status');
    if(action==='status')return res.status(200).json({mode:'WEBSITE_SMALL_LIVE_MANUAL',
     configured:broker.ready(),enabled:enabled(),realOrdersAutomatic:false,
     tradeUsd:ORDER_USD,maxTradeUsd:MAX_USD,minEquityUsd:ORDER_USD/EXPOSURE,
     dailyLossLimitUsd:MAX_DAY_LOSS,oneTradeAtATime:true,requiresIndividualConfirmation:true});
    if(action==='order'){
     const symbol=String(req.query?.symbol||'').toUpperCase(),link=String(req.query?.link||'');
     need(SYMBOLS.has(symbol)&&/^omweb[a-f0-9]{28}$/.test(link),400,'Invalid order reconciliation request');
     need(broker.ready(),503,'Bybit account is not connected');
     const order=await broker.order(symbol,link);
     return res.status(200).json({mode:'REAL_BROKER_ORDER_CHECK',symbol,
      orderLinkId:link,status:order?.orderStatus||'NOT_FOUND',filledQty:order?.cumExecQty||null,
      caution:'Check your Bybit positions, exchange TP/SL and closed-order history before another entry.'});
    }
    throw err(404,'Unknown live account action');
   }
   authentication.assertOrigin(req);
   const body=req.body;
   need(body&&typeof body==='object'&&!Array.isArray(body)&&JSON.stringify(body).length<=MAX_BODY,
    400,'Invalid live trade request');
   if(body.action==='preview'){
    const symbol=String(body.symbol||'').toUpperCase(),side=body.side;
    need(SYMBOLS.has(symbol)&&['Buy','Sell'].includes(side),400,'Select a supported symbol and BUY or SELL');
    const {ticket,limits}=await prepare(symbol,side);
    const token=signPreview({symbol,side,price:ticket.price},env,authentication,req,clock());
    return res.status(200).json({mode:'REAL_FUNDS_PREVIEW',symbol,side,
     notional:ticket.notional,quantity:ticket.qty,entryEstimate:ticket.price,
     stopLoss:ticket.stopLoss,takeProfit:ticket.takeProfit,
     estimatedNetTarget:ticket.estimatedTakeProfitNetUsd,
     estimatedStopRiskUsd:limits.stopRiskUsd,expiresInSeconds:60,previewToken:token,
     executionEnabled:enabled(),warning:'Real Bybit market order after confirmation only. Exchange TP/SL can slip, and losses may exceed estimates. No strategy edge has been established.'});
   }
   need(body.action==='execute'&&body.confirm==='PLACE REAL $15 TRADE',
    400,'To place a live order, type PLACE REAL $15 TRADE exactly');
   need(enabled(),503,'Real small-account orders are disabled by the website server. No order was sent');
   const p=verifyPreview(body.previewToken,env,authentication,req,clock());
   const {ticket,limits}=await prepare(p.symbol,p.side);
   need(Math.abs(ticket.price/p.price-1)<=.0015,409,'Quote moved more than 0.15% since preview; prepare again');
   const link=linkForPreview(p,env);
   // First reconcile the deterministic order ID. If status cannot be checked,
   // fail closed; retries never use a new ID for the same signed preview.
   const old=await broker.order(p.symbol,link);
   need(!old,409,'This preview already generated a Bybit order; inspect broker history');
   await broker.leverage(p.symbol); // Explicitly set 1x, never increase leverage.
   let accepted;
   try{accepted=await broker.enter(ticket,link)}
   catch{throw err(502,'Bybit order outcome uncertain. Do NOT retry; inspect Bybit orders and positions')}
   return res.status(202).json({submitted:true,symbol:p.symbol,side:p.side,
    orderLinkId:link,orderId:accepted?.orderId||null,
    notional:ticket.notional,quantity:ticket.qty,stopLoss:ticket.stopLoss,
    takeProfit:ticket.takeProfit,estimatedStopRiskUsd:limits.stopRiskUsd,
    message:'Bybit acknowledged the request; this is not proof of a fill. Verify exchange position and TP/SL.'});
  }catch(e){
   return res.status(e.status||502).json({error:e.status?e.message:
    'Bybit live request unavailable or outcome uncertain. Check the exchange before retrying.'});
  }
 };
}
module.exports=factory();
module.exports._test={factory,risk,marketPlan,signPreview,verifyPreview,linkForPreview};
