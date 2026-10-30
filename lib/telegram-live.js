'use strict';
// Telegram-accessible, explicitly confirmed, small-account REAL Bybit trading.
// IMPORTANT: this module never auto-arms, and cannot auto-submit orders.
// Each funded order needs /realtrade preview AND /confirmreal CODE in the
// authenticated owner's private Telegram chat. No API secrets in Telegram.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {LiveBroker}=require('./live-broker');
const SYMBOLS=new Set(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','BNBUSDT']);
const ORDER_USD=15,MAX_ORDER_USD=16,MAX_POSITION_FRACTION=.20;
const MAX_DAY_LOSS_USD=1,MAX_TRADE_RISK_USD=.15,TP_NET_USD=.05;
const ESTIMATED_COST_RATE=.0022,PREVIEW_TTL_MS=60000;
const MAX_PREVIEW_SPREAD_BPS=2.5;
const day=(t)=>new Date(t).toISOString().slice(0,10);
const format=n=>'$'+Number(n).toFixed(2);
function ensure(cond,reason){if(!cond)throw Error(reason)}
class TelegramLive{
 constructor({directory,env=process.env,broker=new LiveBroker({env}),now=()=>Date.now()}={}){
  ensure(directory,'Persistent live intent storage required');
  this.env=env;this.broker=broker;this.now=now;
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  this.file=path.join(directory,'telegram-live-manual.json');
  const data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,intent:null,preview:null,day:day(now()),dayEquity:null};
  ensure(data&&data.version===1&&data.intent!==undefined&&data.preview!==undefined&&
   typeof data.day==='string'&&(data.dayEquity===null||Number.isFinite(data.dayEquity)),
   'Live state damaged; manual recovery required. Funded orders blocked.');
  // Never restore preview authorization from a previous process: deliberate re-preview required.
  this.state={...data,preview:null};this.save();
 }
 save(){
  const temp=this.file+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(this.state),{mode:0o600});
  fs.renameSync(temp,this.file);
 }
 configured(){return this.broker.ready()}
 executionEnabled(){return this.env.OMEGA_TELEGRAM_REAL_ORDERS_ENABLED==='true'}
 assertConfigured(){
  ensure(this.configured(),'Live Bybit API credentials are not configured on the private server. Never send them in Telegram.');
 }
 rollDay(snapshot){
  if(this.state.day!==day(this.now())||this.state.dayEquity===null){
   this.state.day=day(this.now());this.state.dayEquity=snapshot.equity;this.save();
  }
 }
 assertRisk(snapshot){
  ensure(snapshot&&Number.isFinite(snapshot.equity)&&Number.isFinite(snapshot.available)&&
   Number.isFinite(snapshot.pnlToday)&&Array.isArray(snapshot.positions)&&Array.isArray(snapshot.pending),
   'Incomplete broker account snapshot');
  this.rollDay(snapshot);
  ensure(snapshot.equity>=ORDER_USD/MAX_POSITION_FRACTION,'Account equity below the $75 minimum for a $15 position at 20% exposure');
  ensure(snapshot.available>=ORDER_USD,'Less than $15 available. A new live trade is blocked.');
  ensure(snapshot.positions.length===0&&snapshot.pending.length===0,'Account has an existing position or pending entry; no new live trade');
  ensure(snapshot.pnlToday> -MAX_DAY_LOSS_USD&&snapshot.equity>this.state.dayEquity-MAX_DAY_LOSS_USD,
   '$1 daily live loss limit reached');
  ensure(this.state.intent===null,'A previous live order intent requires manual reconciliation before another trade.');
 }
 async balance(){
  this.assertConfigured();
  const s=await this.broker.snapshot();
  return {equity:s.equity,available:s.available,positions:s.positions,
   pending:s.pending,pnlToday:s.pnlToday};
 }
 async viewPositions(){
  const b=await this.balance();
  return b.positions.map(p=>({symbol:p.symbol,side:p.side,size:p.size,
   entry:p.avgPrice,stopLoss:p.stopLoss||null,takeProfit:p.takeProfit||null}));
 }
 async plan(symbol,side){
  ensure(SYMBOLS.has(symbol),'Pair not available for restricted $15 real trades');
  ensure(['Buy','Sell'].includes(side),'Invalid trade side');
  const tickerList=await this.broker.request('GET','/v5/market/tickers',{category:'linear',symbol},false);
  const ticker=tickerList.list?.[0];
  ensure(ticker?.symbol===symbol,'Missing public Bybit ticker');
  const bid=Number(ticker.bid1Price),ask=Number(ticker.ask1Price);
  ensure(Number.isFinite(bid)&&Number.isFinite(ask)&&bid>0&&ask>bid,'Invalid public bid/ask');
  const spread=10000*(ask-bid)/((ask+bid)/2);
  ensure(spread<=MAX_PREVIEW_SPREAD_BPS,'Spread exceeds the 2.5bp micro-trade cap');
  return {price:side==='Buy'?ask:bid,stopPct:.30,targetNet:TP_NET_USD,slippageBps:5};
 }
 checkTicket(ticket,snapshot){
  ensure(ticket&&Number.isFinite(ticket.notional)&&ticket.notional>=ORDER_USD-1e-8&&
   ticket.notional<=MAX_ORDER_USD&&ticket.notional<=snapshot.equity*MAX_POSITION_FRACTION&&
   ticket.notional<=snapshot.available,'Position exceeds $15–$16 limit, 20% exposure cap or available balance');
  ensure(Number.isFinite(Number(ticket.qty))&&Number(ticket.qty)>0&&
   Number.isFinite(ticket.price)&&ticket.price>0&&
   Number.isFinite(Number(ticket.stopLoss))&&Number(ticket.stopLoss)>0&&
   Number.isFinite(Number(ticket.takeProfit))&&Number(ticket.takeProfit)>0,
   'Missing exchange-sized position or attached stop and take-profit');
  ensure(Number.isFinite(ticket.estimatedTakeProfitNetUsd)&&ticket.estimatedTakeProfitNetUsd+1e-8>=TP_NET_USD,
   'Expected net TP is not attainable after modeled fees');
  const stopGross=Math.abs(ticket.price-Number(ticket.stopLoss))*Number(ticket.qty);
  const risk=stopGross+ticket.notional*ESTIMATED_COST_RATE;
  const budget=Math.min(MAX_TRADE_RISK_USD,snapshot.equity*.0025,
   MAX_DAY_LOSS_USD+Math.min(0,snapshot.pnlToday),
   MAX_DAY_LOSS_USD-Math.max(0,this.state.dayEquity-snapshot.equity));
  ensure(Number.isFinite(risk)&&risk>0&&budget>0&&risk<=budget,
   'Modeled stop + fees exceed small-account risk cap; choose another setup');
  return risk;
 }
 async preview(symbol,side){
  this.assertConfigured();
  ensure(!this.state.intent,'Previous live order must be reconciled first');
  const snap=await this.broker.snapshot();
  this.assertRisk(snap);
  const plan=await this.plan(symbol,side);
  const ticket=await this.broker.ticket(symbol,side,plan,{notionalUsd:ORDER_USD,maxNotionalUsd:MAX_ORDER_USD});
  const risk=this.checkTicket(ticket,snap);
  const code=crypto.randomBytes(5).toString('hex').toUpperCase();
  this.state.preview={code,symbol,side,price:ticket.price,notional:ticket.notional,
   risk,expiresAt:this.now()+PREVIEW_TTL_MS};
  this.save();
  return {ticket,risk,code,expiresAt:this.state.preview.expiresAt,
   warning:'Real-money Bybit USDT perpetual market order. Attached TP/SL triggers may slip, liquidate or lose more than modeled.'};
 }
 async execute(code){
  this.assertConfigured();
  ensure(this.executionEnabled(),'Real order switch is OFF on the private worker. No funded order was submitted.');
  const p=this.state.preview;
  ensure(p&&typeof code==='string'&&/^[0-9A-F]{10}$/.test(code)&&
   crypto.timingSafeEqual(Buffer.from(p.code),Buffer.from(code))&&
   this.now()<p.expiresAt,'Live preview code missing, invalid or expired. Start with /realtrade again.');
  // Consume preview BEFORE any broker call to defeat double-submissions/retries.
  this.state.preview=null;this.save();
  const snap=await this.broker.snapshot();
  this.assertRisk(snap);
  const plan=await this.plan(p.symbol,p.side);
  const ticket=await this.broker.ticket(p.symbol,p.side,plan,{notionalUsd:ORDER_USD,maxNotionalUsd:MAX_ORDER_USD});
  ensure(Math.abs(ticket.price/p.price-1)<.0015,'Market moved since preview; start a new preview');
  this.checkTicket(ticket,snap);
  // Idempotent intent is persisted before the private exchange operation.
  // On timeout/uncertain outcome, do not reissue a funded order.
  const link='omtgr_'+crypto.randomBytes(12).toString('hex');
  await this.broker.leverage(p.symbol); // 1x ONLY; fail closed on error
  this.state.intent={link,symbol:p.symbol,side:p.side,notional:ticket.notional,
   at:this.now(),state:'SUBMITTING'};
  this.save();
  try{
   const result=await this.broker.enter(ticket,link); // exchange-attached TP/SL
   this.state.intent.state='ACKNOWLEDGED';this.save();
   return {link,orderId:result.orderId||null,symbol:p.symbol,
    note:'Exchange acknowledged the entry request, NOT a verified fill. Check /realorders; TP/SL are exchange-attached only if accepted and active.'};
  }catch{
   this.state.intent.state='UNKNOWN';this.save();
   throw Error('Order result uncertain. No retry is allowed. Use /realorders and inspect your Bybit account directly.');
  }
 }
 async reconcile(){
  this.assertConfigured();
  const intent=this.state.intent;
  if(!intent)return {state:'NO_PENDING_INTENT'};
  // Reconciliation reads the recorded unique orderLinkId; never resends.
  const order=await this.broker.order(intent.symbol,intent.link);
  const snapshot=await this.broker.snapshot();
  const matching=snapshot.positions.filter(p=>p.symbol===intent.symbol);
  const result={state:order?.orderStatus||'NOT_FOUND',symbol:intent.symbol,
   orderLinkId:intent.link,positionOpen:matching.length>0,
   hasPositionProtection:matching.length===1&&
    Number(matching[0].stopLoss)>0&&Number(matching[0].takeProfit)>0,
   pendingOrders:snapshot.pending.length};
  if(order&&['Rejected','Cancelled','Deactivated','PartiallyFilledCanceled'].includes(order.orderStatus)
   &&matching.length===0&&snapshot.pending.length===0){
   this.state.intent=null;this.save();result.cleared=true;
  }
  if(order&&['Filled'].includes(order.orderStatus)&&matching.length===0&&snapshot.pending.length===0
   &&this.now()-intent.at>=60000){
   this.state.intent=null;this.save();result.cleared=true;
  }
  return result;
 }
 status(){return {configured:this.configured(),ordersEnabled:this.executionEnabled(),
  mode:'LIVE BYBIT / MANUAL CONFIRMATION ONLY',pendingIntent:!!this.state.intent,
  intentState:this.state.intent?.state||null,notional:ORDER_USD,dailyLimit:MAX_DAY_LOSS_USD}};
}
module.exports={TelegramLive,ORDER_USD,MAX_ORDER_USD,MAX_DAY_LOSS_USD,MAX_POSITION_FRACTION};
