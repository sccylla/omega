'use strict';
// One manual $90+ Bybit USDT-perpetual entry per user confirmation.
// No recurring scanning, server background work, or automatic new funded entries.
// Attached Bybit full-position TP/SL are exchange-managed; no 24/7 worker.
const crypto=require('node:crypto');
const auth=require('../lib/bybit-demo');
const {LiveBroker}=require('../lib/live-broker');
const {collectEvidence}=require('../lib/market-evidence');
const {decide}=require('../lib/advanced-decision');
const {MIN_LIVE_ORDER_USD,MAX_LIVE_ORDER_USD,MIN_LIVE_EQUITY_USD,MAX_EXPOSURE_FRACTION}=require('../lib/live-policy');
const SYMBOL=/^[A-Z0-9]{2,24}USDT$/;
const TTL=60000,MAX_BODY=3000;
const err=(status,message)=>Object.assign(new Error(message),{status});
const sign=(s,key)=>crypto.createHmac('sha256',key).update(s).digest('hex');
function assertSafeSession(env){
 if(typeof env.OMEGA_SESSION_SECRET!=='string'||env.OMEGA_SESSION_SECRET.length<32)throw err(503,'Secure session signing is not configured');
}
function makePreview(data,env,now=Date.now()){
 assertSafeSession(env);
 const payload=Buffer.from(JSON.stringify({version:1,symbol:data.symbol,side:data.side,barTime:data.barTime,quote:data.price,stopLoss:data.stopLoss,takeProfit:data.takeProfit,nonce:crypto.randomBytes(16).toString('hex'),expiresAt:now+TTL})).toString('base64url');
 return payload+'.'+sign(payload,env.OMEGA_SESSION_SECRET);
}
function verifyPreview(token,env,now=Date.now()){
 assertSafeSession(env);
 if(typeof token!=='string'||token.length>1300||!token.includes('.'))throw err(400,'Missing signed trade preview; scan and prepare a new entry');
 const [payload,signature,...extra]=token.split('.');
 if(extra.length||!signature||!/^[a-f0-9]{64}$/.test(signature))throw err(400,'Invalid preview signature');
 const digest=sign(payload,env.OMEGA_SESSION_SECRET);
 if(!crypto.timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(digest,'hex')))throw err(403,'Trade preview was not issued by this server');
 let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'))}catch{throw err(400,'Invalid signed preview data')}
 if(data.version!==1||!SYMBOL.test(data.symbol)||!['BUY','SELL'].includes(data.side)||!Number.isSafeInteger(data.barTime)||!Number.isFinite(data.quote)||data.quote<=0||!Number.isFinite(data.stopLoss)||data.stopLoss<=0||!Number.isFinite(data.takeProfit)||data.takeProfit<=0||!Number.isFinite(data.expiresAt)||data.expiresAt<=now||data.expiresAt>now+TTL+1000||typeof data.nonce!=='string'||!/^[a-f0-9]{32}$/.test(data.nonce))throw err(409,'Trade preview expired or is invalid. Prepare a new entry');
 return data;
}
function risk(snapshot,ticket){
 if(!snapshot||!Number.isFinite(snapshot.equity)||!Number.isFinite(snapshot.available)||!Number.isFinite(snapshot.pnlToday)||!Array.isArray(snapshot.positions)||!Array.isArray(snapshot.pending))throw err(409,'Broker account risk data is incomplete');
 if(snapshot.positions.length||snapshot.pending.length)throw err(409,'Close or reconcile existing Bybit positions and pending orders before placing another manual trade');
 if(snapshot.equity<MIN_LIVE_EQUITY_USD||snapshot.available<MIN_LIVE_ORDER_USD||snapshot.equity*MAX_EXPOSURE_FRACTION<MIN_LIVE_ORDER_USD)throw err(409,'A $90 minimum position requires at least $450 equity and $90 available margin');
 const lossCap=Math.min(1,snapshot.equity*.02);
 if(snapshot.pnlToday<=-lossCap)throw err(409,'Daily loss threshold reached; no new funded trade');
 const costRate=Math.max(.0022,Number(ticket.estimatedRoundTripCostRate)||0);
 const riskDollars=Math.abs(ticket.price-Number(ticket.stopLoss))*Number(ticket.qty)+ticket.notional*costRate;
 if(!Number.isFinite(riskDollars)||riskDollars<=0||riskDollars>snapshot.equity*.0025||riskDollars>lossCap+Math.min(0,snapshot.pnlToday))throw err(409,'Estimated stop risk exceeds the 0.25% equity or remaining daily loss budget');
 if(!Number.isFinite(ticket.notional)||ticket.notional<MIN_LIVE_ORDER_USD-1e-8||ticket.notional>MAX_LIVE_ORDER_USD+1e-8||ticket.notional>snapshot.equity*MAX_EXPOSURE_FRACTION||ticket.notional>snapshot.available)throw err(409,'Trade must be at least $90 and no more than $91, within 20% of equity and available margin');
 return {estimatedStopRiskUsd:riskDollars,lossCapUsd:lossCap};
}
function idForBar(barTime,env){
 return 'ommanual'+sign('omega-manual-v1:'+barTime,env.OMEGA_SESSION_SECRET).slice(0,27);
}
function factory({env=process.env,broker=new LiveBroker({env}),analyze=async symbol=>decide(await collectEvidence(symbol,{fresh:true}),{mode:'live',now:Date.now(),notional:MIN_LIVE_ORDER_USD}),authentication=auth,clock=()=>Date.now()}={}){
 const enabled=()=>env.OMEGA_MANUAL_LIVE_ORDERS_ENABLED==='true';
 const prepare=async symbol=>{
  if(!SYMBOL.test(symbol))throw err(400,'Choose a valid Bybit USDT perpetual pair');
  if(!broker.ready())throw err(503,'Bybit trading credentials are missing');
  if(!enabled())throw err(503,'Manual real-money execution is disabled on this deployment');
  const [plan,snapshot]=await Promise.all([analyze(symbol),broker.snapshot()]);
  if(!plan||plan.executionPolicy!=='LIVE_STRICT'||!plan.eligible||!['BUY','SELL'].includes(plan.side)||!Number.isSafeInteger(plan.barTime)||!Number.isFinite(plan.expiresAt)||clock()>plan.expiresAt)throw err(409,'No fresh, strictly eligible live setup for '+symbol+': '+String(plan?.reason||'Market not qualified').slice(0,160));
  const ticket=await broker.ticket(symbol,plan.side==='BUY'?'Buy':'Sell',plan);
  const limits=risk(snapshot,ticket);
  if(clock()>plan.expiresAt)throw err(409,'Entry analysis expired during broker checks; prepare again');
  return {plan,ticket,limits,snapshot};
 };
 const handler=async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET or POST required'});
  if(!authentication.isAuthed(req))return res.status(401).json({error:'Sign in before preparing or confirming live trades'});
  try{
   if(req.method==='GET')return res.status(200).json({mode:'MANUAL_LIVE_ONLY',configured:broker.ready(),enabled:enabled(),workerRequired:false,exchangeManagedExits:true,minimumTradeUsd:MIN_LIVE_ORDER_USD,budget:MIN_LIVE_ORDER_USD,requiresConfirmation:true});
   authentication.assertOrigin(req);
   if(!req.body||JSON.stringify(req.body).length>MAX_BODY)throw err(400,'Invalid trade request body');
   if(req.body.action==='preview'){
    const symbol=String(req.body.symbol||'').toUpperCase();
    const {plan,ticket,limits}=await prepare(symbol);
    return res.status(200).json({mode:'MANUAL_LIVE_ONLY',symbol,side:plan.side,notional:ticket.notional,quantity:ticket.qty,entryEstimate:ticket.price,stopLoss:ticket.stopLoss,takeProfit:ticket.takeProfit,targetNet:plan.targetNet,estimatedStopRiskUsd:limits.estimatedStopRiskUsd,previewToken:makePreview({symbol,side:plan.side,barTime:plan.barTime,price:ticket.price,stopLoss:Number(ticket.stopLoss),takeProfit:Number(ticket.takeProfit)},env,clock()),expiresInSeconds:60,warning:'Exchange-managed TP/SL are requested at entry. Stops can slip; order acceptance does not prove a fill.'});
   }
   if(req.body.action!=='execute'||req.body.confirm!=='PLACE REAL $90 TRADE')throw err(400,'Explicit PLACE REAL $10 TRADE confirmation required');
   const signed=verifyPreview(req.body.previewToken,env,clock());
   const {plan,ticket,limits}=await prepare(signed.symbol);
   if(plan.side!==signed.side||plan.barTime!==signed.barTime)throw err(409,'Market direction or signal candle changed; prepare again');
   if(Math.abs(ticket.price/signed.quote-1)>.0015)throw err(409,'Price changed more than 0.15% since preview; prepare again');
   // Only one entry ID per 5-minute signal candle across all candidate symbols.
   // Replays within that candle reuse the exchange orderLinkId (Bybit requires uniqueness).
   const link=idForBar(plan.barTime,env);
   if(clock()>plan.expiresAt)throw err(409,'Entry snapshot expired. Prepare a fresh trade');
   await broker.leverage(signed.symbol);
   if(clock()>plan.expiresAt)throw err(409,'Market quote expired before entry. Prepare again');
   let accepted;
   try{accepted=await broker.enter(ticket,link)}
   catch(e){throw err(502,'Broker order outcome may be uncertain. Check Bybit positions and order history before retrying. '+String(e.message||'').slice(0,140))}
   // Do not blindly retry an ambiguous exchange response. Attachments are in
   // the original Bybit order request; confirm any later fills at the broker.
   let verification='PENDING',note='Order accepted by Bybit API. Check the actual fill and both protective prices at Bybit.';
   try{
    const order=await broker.order(signed.symbol,link);
    if(order?.orderStatus)verification=order.orderStatus;
   }catch{}
   return res.status(202).json({submitted:true,mode:'MANUAL_LIVE_ONLY',symbol:signed.symbol,side:signed.side,orderLinkId:link,orderId:accepted?.orderId||null,orderStatus:verification,notional:ticket.notional,quantity:ticket.qty,stopLoss:ticket.stopLoss,takeProfit:ticket.takeProfit,estimatedStopRiskUsd:limits.estimatedStopRiskUsd,message:note});
  }catch(e){return res.status(e.status||502).json({error:e.status?e.message:'Live execution unavailable or outcome uncertain. Verify at Bybit before submitting again.'})}
 };
 return handler;
}
// The website small-account workflow uses this existing API route so the
// Vercel Hobby deployment stays under its 12-function limit. The legacy $90
// route preserves all prior input and risk behavior unless profile=small.
const legacy=factory();
const small=require('../lib/small-live');
module.exports=(req,res)=>{
 const profile=req.method==='GET'?req.query?.profile:req.body?.profile;
 return profile==='small'?small(req,res):legacy(req,res);
};
module.exports._test={factory,makePreview,verifyPreview,risk,idForBar};
