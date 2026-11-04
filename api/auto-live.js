'use strict';
// A user-armed browser controls each scan and entry. This function never schedules
// work, and the exchange (not the browser) holds attached TP/SL after a fill.
const crypto=require('node:crypto');
const auth=require('../lib/bybit-demo');
const {LiveBroker}=require('../lib/live-broker');
const {collectEvidence}=require('../lib/market-evidence');
const {decide}=require('../lib/advanced-decision');
const portfolio=require('../lib/live-portfolio');
const ScalpEvidence=require('../lib/scalp-evidence');
const {MIN_REWARD_RISK}=require('../lib/futures-economics');
const AUTO_TRADE_USD=100,AUTO_MAX_TRADE_USD=102,AUTO_MIN_EQUITY_USD=500,AUTO_NET_GOAL_USD=.05;
const {MAX_EXPOSURE_FRACTION}=require('../lib/live-policy');
const SYMBOL=/^[A-Z0-9]{2,24}USDT$/,MAX_SESSION_MS=60*60*1000;
const error=(status,message)=>Object.assign(new Error(message),{status});
const hmac=(message,env)=>crypto.createHmac('sha256',env.OMEGA_SESSION_SECRET).update(message).digest('hex');
function issueArm(req,env,authenticator,now=Date.now(),purpose='futures'){
 if(!['futures','scalper'].includes(purpose))throw error(400,'Invalid real-trading strategy');
 const cookie=authenticator.getCookie(req);
 if(typeof env.OMEGA_SESSION_SECRET!=='string'||env.OMEGA_SESSION_SECRET.length<32||!cookie)throw error(503,'Secure authenticated trading session unavailable');
 const payload=Buffer.from(JSON.stringify({version:4,purpose,tradeUsd:AUTO_TRADE_USD,session:hmac(cookie,env).slice(0,32),issuedAt:now,expiresAt:now+MAX_SESSION_MS,nonce:crypto.randomBytes(16).toString('hex')})).toString('base64url');
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
 if(value.version!==4||!['futures','scalper'].includes(value.purpose)||value.tradeUsd!==AUTO_TRADE_USD||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.issuedAt>now||value.expiresAt-value.issuedAt!==MAX_SESSION_MS||value.session!==hmac(cookie,env).slice(0,32))throw error(403,'Trading authorization expired or belongs to another session');
 return value;
}
function guardAccount(snapshot,options={}){
 try{return portfolio.validate(snapshot,options)}
 catch(e){throw error(409,e.message)}
}
function factory({env=process.env,broker=new LiveBroker({env}),analyze=async symbol=>decide(await collectEvidence(symbol,{fresh:true}),{mode:'live_small',now:Date.now(),notional:AUTO_TRADE_USD}),scalpValidate=ScalpEvidence.validate,authentication=auth,clock=()=>Date.now()}={}){
 const enabled=()=>env.OMEGA_SMALL_LIVE_ORDERS_ENABLED==='true'&&env.OMEGA_BROWSER_AUTOLIVE_ENABLED==='true';
 return async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET or POST required'});
  if(!authentication.isAuthed(req))return res.status(401).json({error:'Sign in to start real-money autopilot'});
  try{
   if(req.method==='GET')return res.status(200).json({mode:'BROWSER_CONTROLLED_LIVE',configured:broker.ready(),enabled:enabled(),maxPositionCount:portfolio.MAX_POSITIONS,portfolioExposureLimitPct:20,minimumTradeUsd:AUTO_TRADE_USD,tradeBudget:AUTO_TRADE_USD,maxTradeUsd:AUTO_MAX_TRADE_USD,minimumEquityUsd:AUTO_MIN_EQUITY_USD,estimatedNetProfitTargetUsd:null,futuresMinimumNetRewardRisk:MIN_REWARD_RISK,scalperMinimumNetTargetUsd:AUTO_NET_GOAL_USD,exchangeManagedExits:true,expiresInMinutes:60,runsOnlyInVisibleBrowser:true});
   authentication.assertOrigin(req);
   if(!req.body||JSON.stringify(req.body).length>2500)throw error(400,'Invalid trading request');
   if(!enabled()||!broker.ready())throw error(503,'Browser-controlled live trading is not enabled or credentials are missing');
   if(req.body.action==='arm'){
    const purpose=req.body.confirm==='START REAL $100 SCALPER'?'scalper':
     req.body.confirm==='START REAL $100 AUTOPILOT'?'futures':null;
    if(!purpose)throw error(400,'Confirm START REAL $100 AUTOPILOT or START REAL $100 SCALPER');
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
   guardAccount(snapshot,{symbol});
   // A browser scalp WATCH is never sufficient; independently request public
   // Bybit recent trades and 50-level depth immediately before any entry.
   const micro=scalper?await scalpValidate(broker,symbol,req.body.side,clock()):null;
   // Never trust browser candidates: strict live evidence is collected again.
   const plan=await analyze(symbol);
   if(!plan||plan.symbol!==symbol||plan.executionPolicy!=='LIVE_STRICT'||plan.eligible!==true||!['BUY','SELL'].includes(plan.side)||(scalper&&micro.side!==(plan.side==='BUY'?'Buy':'Sell'))||!Number.isSafeInteger(plan.barTime)||!Number.isFinite(plan.expiresAt)||clock()>plan.expiresAt||clock()-(plan.barTime+300000)>360000)throw error(409,'This pair does not have a fresh, qualified live entry');
   // Futures preserves its risk-aware target. The seconds scalper has its own
   // explicitly separate target policy; neither is a realized-profit promise.
   if(!scalper&&(!Number.isFinite(plan.targetNet)||plan.targetNet<=0))throw error(409,'Futures target is unavailable');
   const profitPlan=scalper?{...plan,targetNet:AUTO_NET_GOAL_USD+.01,minimumNetRewardRisk:undefined}:{...plan,minimumNetRewardRisk:MIN_REWARD_RISK};
   const ticket=await broker.ticket(symbol,plan.side==='BUY'?'Buy':'Sell',profitPlan,{notionalUsd:AUTO_TRADE_USD,maxNotionalUsd:AUTO_MAX_TRADE_USD});
   if(!Number.isFinite(ticket.estimatedTakeProfitNetUsd)||ticket.estimatedTakeProfitNetUsd<AUTO_NET_GOAL_USD)throw error(409,'Exchange ticket does not meet the $0.05 estimated net take-profit target');
   if(!scalper){
    const dir=ticket.side==='Buy'?1:ticket.side==='Sell'?-1:NaN,qty=Number(ticket.qty),stop=Number(ticket.stopLoss),tp=Number(ticket.takeProfit),costRate=Math.max(.0022,Number(ticket.estimatedRoundTripCostRate));
    const risk=dir*(ticket.price-stop)*qty+ticket.notional*costRate;
    const reward=Math.min(ticket.estimatedTakeProfitNetUsd,dir*(tp-ticket.price)*qty-ticket.notional*costRate);
    if(![risk,reward].every(Number.isFinite)||risk<=0||reward+1e-8<MIN_REWARD_RISK*risk||reward+1e-8<plan.targetNet)throw error(409,'Futures ticket does not preserve the required net reward/risk after rounding and costs');
   }
   const recent=await broker.snapshot();
   const limits=guardAccount(recent,{symbol,ticket});
   if(clock()>plan.expiresAt)throw error(409,'Signal expired during broker price and risk checks');
   // Futures uses one trade per 5m signal; scalping uses a separate 30s bucket.
   // In either case, account snapshot and orderLinkId reconciliation still apply.
   const link=(scalper?'oms':'omf')+crypto.createHmac('sha256',env.OMEGA_SESSION_SECRET)
    .update((scalper?'scalp:':'futures:')+symbol+':'+plan.side+':'+(scalper?Math.floor(clock()/30000):plan.barTime)).digest('hex').slice(0,29);
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
    return res.status(202).json({submitted:true,symbol,side:plan.side,notional:ticket.notional,orderId:result?.orderId||null,orderLinkId:link,orderStatus,stopLoss:ticket.stopLoss,takeProfit:ticket.takeProfit,estimatedNetProfitTargetUsd:scalper?AUTO_NET_GOAL_USD:ticket.estimatedTakeProfitNetUsd,estimatedTakeProfitNetUsd:ticket.estimatedTakeProfitNetUsd,estimatedStopRiskUsd:limits.estimatedStopRiskUsd,strategy:scalper?'SCALPER':'FUTURES',message:'Bybit accepted the order request. Verify the actual fill and exchange-side protection in Bybit.'});
   }catch(e){if(e.status)throw e;throw error(502,'Order outcome uncertain. STOP autopilot and inspect Bybit positions and order history before another entry. '+String(e.message||'').slice(0,80))}
  }catch(e){return res.status(e.status||502).json({error:e.status?e.message:'Live trade request failed. Check Bybit orders and positions before attempting again.'})}
 };
}
module.exports=(req,res)=>['preview_close','close_position'].includes(req.body?.action)?require('../lib/live-position-close')(req,res):factoryHandler(req,res);
const factoryHandler=factory();
module.exports._test={factory,issueArm,verifyArm,guardAccount};
