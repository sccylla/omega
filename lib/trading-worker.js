'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const T=require('../static/pro-trader'),scanner=require('./opportunity-scanner');
const {LiveBroker}=require('./live-broker');
const today=()=>new Date().toISOString().slice(0,10);
class TradingWorker{
 constructor({directory,broker=new LiveBroker(),env=process.env}={}){
  this.broker=broker;this.env=env;this.directory=directory;this.queue=Promise.resolve();this.cycling=false;
  fs.mkdirSync(directory,{recursive:true,mode:0o700});this.file=path.join(directory,'state.json');
  this.state=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,active:false,day:today(),dayEquity:null,managed:[],intent:null,bars:{},dailyLimit:1,events:[]};
  if(this.state.version!==1||!Array.isArray(this.state.managed)||!Array.isArray(this.state.events)||!this.state.bars)throw Error('Worker state is invalid; manual recovery required');
  this.state.active=false;this.event('Worker started paused; existing protective orders remain at Bybit.');this.save();
 }
 event(message){this.state.message=message;this.state.events=[{at:Date.now(),message},...this.state.events].slice(0,50)}
 save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.state),{mode:0o600});fs.renameSync(tmp,this.file)}
 exclusive(fn){const next=this.queue.then(fn);this.queue=next.catch(()=>{});return next}
 status(){return {mode:'BYBIT_LIVE',configured:this.broker.ready(),serverEnabled:this.env.OMEGA_LIVE_ORDERS_ENABLED==='true',active:this.state.active,notional:10,maxPositions:2,dailyLimit:this.state.dailyLimit,managed:this.state.managed.map(({symbol,side,targetNet})=>({symbol,side,targetNet})),pending:!!this.state.intent,message:this.state.message,lastCheck:this.state.lastCheck||null,events:this.state.events.slice(0,10)}}
 control(body){
  if(body.action==='pause'){this.state.active=false;this.event('New live entries paused. Any in-flight submission may still complete; existing broker TP/SL remain active.');this.save();return Promise.resolve(this.status())}
  return this.exclusive(async()=>{
  if(body.action!=='start'||body.confirm!=='START REAL $10 BOT')throw Error('Type START REAL $10 BOT to activate live entries');
  if(this.env.OMEGA_LIVE_ORDERS_ENABLED!=='true'||!this.broker.ready())throw Error('Live server switch and Bybit trading credentials must be configured first');
  const limit=Number(body.dailyLimit);if(!Number.isFinite(limit)||limit<.1||limit>1)throw Error('Daily loss budget must be $0.10–$1.00');
  if(this.state.intent)throw Error('An unresolved broker order must be reconciled first');
  const s=await this.broker.snapshot();
  if(s.equity<50||s.available<10)throw Error('At least $50 equity and $10 available margin required');
  if(s.pending.length||s.positions.some(p=>!this.state.managed.some(x=>x.symbol===p.symbol)))throw Error('Use a dedicated account with no unmanaged positions or pending entry orders');
  this.rollDay(s);this.state.dailyLimit=limit;
  if(this.lossLimit(s))throw Error('Daily account loss limit reached; activation blocked');
  this.state.active=true;this.event('Live $10 entries explicitly activated. Limits: two positions, 1x leverage, $'+limit+' daily loss budget.');this.save();return this.status();
 })}
 rollDay(snapshot){if(this.state.day!==today()||!Number.isFinite(this.state.dayEquity)){this.state.day=today();this.state.dayEquity=snapshot.equity}}
 lossLimit(s){return s.pnlToday<=-this.state.dailyLimit||s.equity<=this.state.dayEquity-Math.min(this.state.dailyLimit,this.state.dayEquity*.02)}
 async reconcile(s){
  if(this.state.intent){
   const intent=this.state.intent,order=await this.broker.order(intent.symbol,intent.link),pos=s.positions.find(p=>p.symbol===intent.symbol);
   if(pos&&order&&['Filled','PartiallyFilledCanceled','PartiallyFilled'].includes(order.orderStatus)){
    if(pos.side!==intent.side||Number(pos.size)>Number(intent.qty)+1e-9)throw Error('Position differs from recorded order; manual review required');
    this.state.managed.push({...intent,qty:String(pos.size)});this.state.intent=null;this.event('Reconciled '+intent.symbol+' fill.');this.save();
   }else if(order&&['Cancelled','Rejected','Deactivated'].includes(order.orderStatus)&&!pos){this.state.intent=null;this.event('Entry cancelled or rejected by exchange.');this.save()}
   else {this.state.active=false;this.event('Entry outcome unresolved. New entries paused; inspect the order at Bybit.');this.save();return false}
  }
  for(const trade of [...this.state.managed]){
   const position=s.positions.find(p=>p.symbol===trade.symbol);
   if(!position){this.state.managed=this.state.managed.filter(x=>x.link!==trade.link);this.event(trade.symbol+' is closed at the broker.');continue}
   if(position.side!==trade.side||Math.abs(Number(position.size)-Number(trade.qty))>1e-9)throw Error('Managed position changed outside the bot; review at Bybit');
   if(!(Number(position.stopLoss)>0&&Number(position.takeProfit)>0)){
    this.state.active=false;
    if(!trade.exitLink){
     trade.exitLink='omexit'+crypto.randomBytes(12).toString('hex');
     this.save(); // Persist before a potentially ambiguous emergency-close write.
     await this.broker.close(position,trade.exitLink);
     this.event('Protection missing: reduce-only emergency close submitted for '+trade.symbol+'. Verify it filled at Bybit.');
    }else{
     const closeOrder=await this.broker.order(trade.symbol,trade.exitLink);
     this.event('Emergency close pending on '+trade.symbol+' ('+(closeOrder?.orderStatus||'unknown outcome')+'). Inspect at Bybit immediately.');
    }
    this.save();return false;
   }
   // Exchange TP/SL provide continuous exits, even when this worker is stopped.
   // Do not submit duplicate closes; the exchange owns the protective order lifecycle.
  }
  this.save();return true;
 }
 cycle(){if(this.cycling)return Promise.resolve();this.cycling=true;return this.exclusive(async()=>{
  if(!this.broker.ready()||(!this.state.active&&!this.state.managed.length&&!this.state.intent))return;
  try{
   const s=await this.broker.snapshot();this.rollDay(s);this.state.lastCheck=Date.now();
   if(!await this.reconcile(s))return;
   if(this.lossLimit(s)){this.state.active=false;this.event('Daily loss budget reached. New entries locked; broker protective exits remain active.');this.save();return}
   if(!this.state.active)return;
   if(this.env.OMEGA_LIVE_ORDERS_ENABLED!=='true'){this.state.active=false;this.event('Server kill switch is off.');this.save();return}
   if(s.pending.length||s.positions.length>=2){this.event('Managing current exposure; no new entry.');this.save();return}
   if(s.positions.some(p=>!this.state.managed.some(x=>x.symbol===p.symbol)))throw Error('Unmanaged position detected; new entries paused');
   if(s.available<10||10>s.equity*.2)throw Error('Available balance or exposure limit blocks a $10 entry');
   const picks=(await this.broker.markets()).map(scanner.futuresScreen).filter(x=>x&&['BUY WATCH','SELL WATCH'].includes(x.status)&&x.turnover24h>=10000000&&x.spreadBps<=8).slice(0,8);
   for(const item of picks){
    if(s.positions.some(p=>p.symbol===item.symbol))continue;
    const side=item.status==='BUY WATCH'?'BUY':'SELL',plan=T.evaluate(await this.broker.candles(item.symbol),item,side);
    const key=item.symbol+':'+side;
    if(!plan.eligible||this.state.bars[key]===plan.barTime)continue;
    let ticket;try{ticket=await this.broker.ticket(item.symbol,side==='BUY'?'Buy':'Sell',plan)}catch{continue}
    // Recheck all account limits immediately before a write. No stale scan snapshot.
    const fresh=await this.broker.snapshot();
    if(this.lossLimit(fresh)||fresh.pending.length||fresh.positions.length>=2||fresh.positions.some(p=>p.symbol===item.symbol)||fresh.positions.some(p=>!this.state.managed.some(x=>x.symbol===p.symbol))||fresh.available<10||10>fresh.equity*.2)throw Error('Account risk changed while scanning; entry blocked');
    const newRisk=Math.abs(ticket.price-Number(ticket.stopLoss))*Number(ticket.qty)+ticket.notional*.0016;
    const openRisk=fresh.positions.reduce((sum,p)=>{
     const price=Number(p.markPrice),stop=Number(p.stopLoss),size=Number(p.size);
     if(!(price>0&&stop>0&&size>0))throw Error('Open-position stop risk is unverifiable');
     return sum+Math.max(0,(p.side==='Buy'?price-stop:stop-price)*size)+price*size*.0016;
    },0);
    const remaining=Math.min(this.state.dailyLimit+Math.min(0,fresh.pnlToday),this.state.dailyLimit-Math.max(0,this.state.dayEquity-fresh.equity));
    if(newRisk>fresh.equity*.0025||newRisk+openRisk>remaining)throw Error('Proposed stop risk exceeds per-trade or remaining daily budget');
    if(Date.now()-(plan.barTime+300000)>360000)throw Error('Candle setup expired before entry');
    if(!this.state.active||this.env.OMEGA_LIVE_ORDERS_ENABLED!=='true')return;
    await this.broker.leverage(item.symbol);
    if(!this.state.active||this.env.OMEGA_LIVE_ORDERS_ENABLED!=='true')return;
    const link='om10'+crypto.randomBytes(12).toString('hex');
    this.state.intent={...ticket,link,barTime:plan.barTime,targetNet:plan.targetNet};
    this.state.bars[key]=plan.barTime;this.state.bars=Object.fromEntries(Object.entries(this.state.bars).slice(-500));
    // Durable intent precedes order submission. An ambiguous request is never retried blindly.
    this.save();
    await this.broker.enter(ticket,link);
    this.event('Entry submitted for '+item.symbol+'; waiting for broker fill and protective-order reconciliation.');this.save();return;
   }
   this.event('Waiting: no new setup fits strategy, exchange minimums and $10 budget.');this.save();
  }catch(e){this.state.active=false;this.event(this.state.intent?'Broker outcome uncertain. Entries paused pending reconciliation.':'Entries paused: '+String(e.message||'Broker/data/risk check failed').slice(0,180));this.save()}
 }).finally(()=>{this.cycling=false})}
}
let controller=null;
module.exports={TradingWorker,getController:()=>controller,setController:value=>{controller=value}};
