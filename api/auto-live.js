'use strict';
// A user-armed browser controls each scan and entry. This function never schedules
// work, and the exchange (not the browser) holds attached TP/SL after a fill.
const crypto=require('node:crypto');
const auth=require('../lib/bybit-demo');
const {LiveBroker}=require('../lib/live-broker');
const {collectEvidence}=require('../lib/market-evidence');
const {decide}=require('../lib/advanced-decision');
const {idForBar}=require('./manual-live')._test;
const {risk}=require('../lib/small-live')._test;
const ScalpEvidence=require('../lib/scalp-evidence');
const AUTO_TRADE_USD=15,AUTO_MAX_TRADE_USD=16,AUTO_MIN_EQUITY_USD=75,AUTO_NET_GOAL_USD=.05;
const {MAX_EXPOSURE_FRACTION}=require('../lib/live-policy');
const SYMBOL=/^[A-Z0-9]{2,24}USDT$/,MAX_SESSION_MS=60*60*1000;
const error=(status,message)=>Object.assign(new Error(message),{status});
const hmac=(message,env)=>crypto.createHmac('sha256',env.OMEGA_SESSION_SECRET).update(message).digest('hex');
function issueArm(req,env,authenticator,now=Date.now(),purpose='futures'){
 if(!['futures','scalper'].includes(purpose))throw error(400,'Invalid real-trading strategy');
 const cookie=authenticator.getCookie(req);
 if(typeof env.OMEGA_SESSION_SECRET!=='string'||env.OMEGA_SESSION_SECRET.length<32||!cookie)throw error(503,'Secure authenticated trading session unavailable');
 const payload=Buffer.from(JSON.stringify({version:3,purpose,tradeUsd:AUTO_TRADE_USD,session:hmac(cookie,env).slice(0,32),issuedAt:now,expiresAt:now+MAX_SESSION_MS,nonce:crypto.randomBytes(16).toString('hex')})).toString('base64url');
 return payload+'.'+hmac('omega-live-arm:'+payload,env);
}
function verifyArm(req,token,env,authenticator,now=Date.now()){
 const cookie=authenticator.getCookie(req);
 if(!cookie||typeof token!=='string'||token.length>1000||!token.includes('.')||!env.OMEGA_SESSION_SECRET)throw error(403,'Start Real autopilot again after signing in');
 const [payload,digest,...extra]=token.split('.');
 if(extra.length||!digest||!/^[a-f0-9]{64}$/.test(digest))throw error(403,'Invalid trading authorization');
 const expected=hmac('omega-live-arm:'+payload,env);
 if(!crypto.timingSafeEqual(Buffer.from(digest,'hex'),Buffer.from(expected,'hex')))throw error(403,'Trading authorization signature invalid');
 let value;try{value=JSON.parse(Buffer.from(payload,'base64url').toString())}catch{throw error(403,'Invalid trading authorization')}
 if(value.version!==3||!['futures','scalper'].includes(value.purpose)||value.tradeUsd!==AUTO_TRADE_USD||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.issuedAt>now||value.expiresAt-value.issuedAt!==MAX_SESSION_MS||value.session!==hmac(cookie,env).slice(0,32))throw error(403,'Trading authorization expired or belongs to another session');
 return value;
}
function guardAccount(snapshot){
 if(!snapshot||!Number.isFinite(snapshot.equity)||!Number.isFinite(snapshot.available)||!Number.isFinite(snapshot.pnlToday)||!Array.isArray(snapshot.positions)||!Array.isArray(snapshot.pending))throw error(409,'Broker account state is incomplete');
 if(snapshot.positions.length||snapshot.pending.length)throw error(409,'A live position or pending order is already present. Wait for its exchange-managed exit.');
 if(snapshot.equity<AUTO_MIN_EQUITY_USD||snapshot.available<AUTO_TRADE_USD||snapshot.equity*MAX_EXPOSURE_FRACTION<AUTO_TRADE_USD)throw error(409,'A $15 live position requires at least $75 equity and $15 available under the 20% exposure rule');
 if(snapshot.pnlToday<=-Math.min(1,snapshot.equity*.02))throw error(409,'Daily loss threshold reached; entries suspended');
}
function factory({env=process.env,broker=new LiveBroker({env}),analyze=async symbol=>decide(await collectEvidence(symbol,{fresh:true}),{mode:'live_small',now:Date.now(),notional:AUTO_TRADE_USD}),scalpValidate=ScalpEvidence.validate,authentication=auth,clock=()=>Date.now()}={}){
 const enabled=()=>env.OMEGA_SMALL_LIVE_ORDERS_ENABLED==='true'&&env.OMEGA_BROWSER_AUTOLIVE_ENABLED==='true';
 return async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET or POST required'});
  if(!authentication.isAuthed(req))return res.status(401).json({error:'Sign in to start real-money autopilot'});
  try{
   if(req.method==='GET')return res.status(200).json({mode:'BROWSER_CONTROLLED_LIVE',configured:broker.ready(),enabled:enabled(),maxPositionCount:1,minimumTradeUsd:AUTO_TRADE_USD,tradeBudget:AUTO_TRADE_USD,maxTradeUsd:AUTO_MAX_TRADE_USD,minimumEquityUsd:AUTO_MIN_EQUITY_USD,estimatedNetProfitTargetUsd:AUTO_NET_GOAL_USD,exchangeManagedExits:true,expiresInMinutes:60,runsOnlyInVisibleBrowser:true});
   authentication.assertOrigin(req);
   if(!req.body||JSON.stringify(req.body).length>2500)throw error(400,'Invalid trading request');
   if(!enabled()||!broker.ready())throw error(503,'Browser-controlled live trading is not enabled or credentials are missing');
   if(req.body.action==='arm'){
    const purpose=req.body.confirm==='START REAL $15 SCALPER'?'scalper':
     req.body.confirm==='START REAL $15 AUTOPILOT'?'futures':null;
    if(!purpose)throw error(400,'Confirm START REAL $15 AUTOPILOT or START REAL $15 SCALPER');
    guardAccount(await broker.snapshot());
    return res.status(200).json({armed:true,purpose,token:issueArm(req,env,authentication,clock(),purpose),expiresInMinutes:60,message:'Browser-armed only. No order has been placed. Exchange-managed TP/SL are requested for each eligible entry.'});
   }
   const scalper=req.body.action==='enter_scalp';
   if(req.body.action!=='enter'&&!scalper)throw error(400,'Unsupported live trading command');
   const authorization=verifyArm(req,req.body.token,env,authentication,clock());
   if(authorization.purpose!==(scalper?'scalper':'futures'))throw error(403,'Trade engine and trading authorization do not match');
   const symbol=String(req.body.symbol||'').toUpperCase();
   if(!SYMBOL.test(symbol))throw error(400,'Invalid Bybit USDT perpetual pair');
   const snapshot=await broker.snapshot();
   guardAccount(snapshot);
   // A browser scalp WATCH is never sufficient; independently request public
   // Bybit recent trades and 50-level depth immediately before any entry.
   const micro=scalper?await scalpValidate(broker,symbol,req.body.side,clock()):null;
   // Never trust browser candidates: strict live evidence is collected again.
   const plan=await analyze(symbol);
   if(!plan||plan.symbol!==symbol||plan.executionPolicy!=='LIVE_STRICT'||plan.eligible!==true||!['BUY','SELL'].includes(plan.side)||(scalper&&micro.side!==(plan.side==='BUY'?'Buy':'Sell'))||!Number.isSafeInteger(plan.barTime)||!Number.isFinite(plan.expiresAt)||clock()>plan.expiresAt||clock()-(plan.barTime+300000)>360000)throw error(409,'This pair does not have a fresh, qualified live entry');
   // Exchange TP is set at entry for at least $0.05 modeled net profit,
   // with a small buffer; actual net realized P&L is not guaranteed.
   const profitPlan={...plan,targetNet:AUTO_NET_GOAL_USD+.01};
   const ticket=await broker.ticket(symbol,plan.side==='BUY'?'Buy':'Sell',profitPlan,{notionalUsd:AUTO_TRADE_USD,maxNotionalUsd:AUTO_MAX_TRADE_USD});
   if(!Number.isFinite(ticket.estimatedTakeProfitNetUsd)||ticket.estimatedTakeProfitNetUsd<AUTO_NET_GOAL_USD)throw error(409,'Exchange ticket does not meet the $0.05 estimated net take-profit target');
   const recent=await broker.snapshot();
   guardAccount(recent);const limits=risk(recent,ticket);
   if(clock()>plan.expiresAt)throw error(409,'Signal expired during broker price and risk checks');
   // Futures uses one trade per 5m signal; scalping uses a separate 30s bucket.
   // In either case, account snapshot and orderLinkId reconciliation still apply.
   const link=scalper?'oms'+crypto.createHmac('sha256',env.OMEGA_SESSION_SECRET)
    .update('scalp:'+symbol+':'+plan.side+':'+Math.floor(clock()/30000)).digest('hex').slice(0,29):idForBar(plan.barTime,env);
   // Explicit replay check; never blindly retry an ambiguous submission.
   const prior=await broker.order(symbol,link);
   if(prior)throw error(409,'This five-minute signal has already been submitted to Bybit');
   if(clock()>plan.expiresAt)throw error(409,'Signal expired before entry');
   await broker.leverage(symbol);
   if(clock()>plan.expiresAt)throw error(409,'Signal expired during leverage setup');
   try{
    const result=await broker.enter(ticket,link);
    let orderStatus='PENDING VERIFICATION';
    try{const order=await broker.order(symbol,link);if(order?.orderStatus)orderStatus=order.orderStatus}catch{}
    return res.status(202).json({submitted:true,symbol,side:plan.side,notional:ticket.notional,orderId:result?.orderId||null,orderLinkId:link,orderStatus,stopLoss:ticket.stopLoss,takeProfit:ticket.takeProfit,estimatedNetProfitTargetUsd:AUTO_NET_GOAL_USD,estimatedTakeProfitNetUsd:ticket.estimatedTakeProfitNetUsd,estimatedStopRiskUsd:limits.stopRiskUsd,strategy:scalper?'SCALPER':'FUTURES',message:'Bybit accepted the order request. Verify the actual fill and exchange-side protection in Bybit.'});
   }catch(e){if(e.status)throw e;throw error(502,'Order outcome uncertain. STOP autopilot and inspect Bybit positions and order history before another entry. '+String(e.message||'').slice(0,80))}
  }catch(e){return res.status(e.status||502).json({error:e.status?e.message:'Live trade request failed. Check Bybit orders and positions before attempting again.'})}
 };
}
module.exports=factory();
module.exports._test={factory,issueArm,verifyArm,guardAccount};
