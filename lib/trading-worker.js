'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const scanner=require('./opportunity-scanner');
const {collectEvidence}=require('./market-evidence'),{decide}=require('./advanced-decision');
const analyzeMarket=async symbol=>decide(await collectEvidence(symbol,{fresh:true}),{now:Date.now(),notional:10});
const {LiveBroker}=require('./live-broker');
const {concentrated}=require('../static/portfolio-risk');
const {scanMarkets,explain}=require('../static/market-selection');
const today=()=>new Date().toISOString().slice(0,10);
const EXECUTION_COST_RATE=.0022; // Two taker fees plus a conservative slippage allowance; fills can be worse.
const finitePositive=n=>Number.isFinite(Number(n))&&Number(n)>0;
const validLink=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,36}$/.test(s);
function validTrade(t){return t&&/^[A-Z0-9]{2,24}USDT$/.test(t.symbol)&&['Buy','Sell'].includes(t.side)&&finitePositive(t.qty)&&finitePositive(t.price)&&finitePositive(t.stopLoss)&&finitePositive(t.takeProfit)&&finitePositive(t.notional)&&Number(t.notional)<=10+1e-8&&validLink(t.link)&&(!t.exitLink||validLink(t.exitLink))}
function validateState(s){
 if(!s||s.version!==1||typeof s.active!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(s.day)||!Number.isFinite(Date.parse(s.day))||!(s.dayEquity===null||finitePositive(s.dayEquity))||!Number.isFinite(s.dailyLimit)||s.dailyLimit<.1||s.dailyLimit>1||!Array.isArray(s.managed)||s.managed.length>2||!s.managed.every(validTrade)||!(s.intent===null||validTrade(s.intent))||!s.bars||typeof s.bars!=='object'||Array.isArray(s.bars)||Object.keys(s.bars).length>500||!Object.values(s.bars).every(t=>Number.isFinite(t)&&t>0)||!Array.isArray(s.events))throw Error('Worker state is invalid; manual recovery required');
}
function validateSnapshot(s){if(!s||!finitePositive(s.equity)||!Number.isFinite(s.available)||s.available<0||!Number.isFinite(s.pnlToday)||!Array.isArray(s.positions)||!Array.isArray(s.pending))throw Error('Account risk snapshot is invalid')}

class TradingWorker{
 constructor({directory,broker=new LiveBroker(),env=process.env,analyze=analyzeMarket}={}){
  this.broker=broker;this.env=env;this.analyze=analyze;this.decisions=[];this.directory=directory;this.queue=Promise.resolve();this.cycling=false;
  fs.mkdirSync(directory,{recursive:true,mode:0o700});this.file=path.join(directory,'state.json');
  this.state=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,active:false,day:today(),dayEquity:null,managed:[],intent:null,bars:{},dailyLimit:1,events:[]};
  validateState(this.state);
  this.state.active=false;this.event('Worker started paused; existing protective orders remain at Bybit.');this.save();
 }
 event(message){this.state.message=message;this.state.events=[{at:Date.now(),message},...this.state.events].slice(0,50)}
 save(){
  const tmp=this.file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';let fd;
  try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(this.state));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,this.file);const dir=fs.openSync(this.directory,'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp)}
 }
 exclusive(fn){const next=this.queue.then(fn);this.queue=next.catch(()=>{});return next}
 recordDecision(symbol,plan){this.decisions=[{symbol,decision:plan.eligible?plan.side:'WAIT',reason:plan.reason,observedAt:plan.observedAt||null,checks:plan.checks||[],validation:plan.validation||null},...this.decisions.filter(x=>x.symbol!==symbol)].slice(0,8)}
 status(){return {strategy:'evidence-v11',decisions:this.decisions,coverage:this.coverage||null,mode:'BYBIT_LIVE',configured:this.broker.ready(),serverEnabled:this.env.OMEGA_LIVE_ORDERS_ENABLED==='true',active:this.state.active,notional:10,maxPositions:2,dailyLimit:this.state.dailyLimit,managed:this.state.managed.map(({symbol,side,targetNet})=>({symbol,side,targetNet})),pending:!!this.state.intent,message:this.state.message,lastCheck:this.state.lastCheck||null,events:this.state.events.slice(0,10)}}
 control(body){
  if(body.action==='scan'){if(!this.state.active)throw Error('Activate live trading explicitly before requesting an entry scan');queueMicrotask(()=>this.cycle());return Promise.resolve({...this.status(),message:this.cycling?'Full-market scan already running':'Full-market entry scan requested'})}
  if(body.action==='pause'){this.state.active=false;this.event('New live entries paused. Any in-flight submission may still complete; existing broker TP/SL remain active.');this.save();return Promise.resolve(this.status())}
  return this.exclusive(async()=>{
  if(body.action!=='start'||body.confirm!=='START REAL $10 BOT')throw Error('Type START REAL $10 BOT to activate live entries');
  if(this.env.OMEGA_LIVE_ORDERS_ENABLED!=='true'||!this.broker.ready())throw Error('Live server switch and Bybit trading credentials must be configured first');
  const limit=Number(body.dailyLimit);if(!Number.isFinite(limit)||limit<.1||limit>1)throw Error('Daily loss budget must be $0.10–$1.00');
  if(this.state.intent)throw Error('An unresolved broker order must be reconciled first');
  const s=await this.broker.snapshot();validateSnapshot(s);
  if(s.equity<50||s.available<10)throw Error('At least $50 equity and $10 available margin required');
  if(s.pending.length||s.positions.some(p=>!this.state.managed.some(x=>x.symbol===p.symbol)))throw Error('Use a dedicated account with no unmanaged positions or pending entry orders');
  this.rollDay(s);this.state.dailyLimit=limit;
  if(this.lossLimit(s))throw Error('Daily account loss limit reached; activation blocked');
  this.state.active=true;this.event('Live $10 entries explicitly activated. Limits: two positions, 1x leverage, $'+limit+' daily loss budget.');this.save();return this.status();
 })}
 rollDay(snapshot){if(this.state.day!==today()||!Number.isFinite(this.state.dayEquity)){this.state.day=today();this.state.dayEquity=snapshot.equity}}
 lossLimit(s){return s.pnlToday<=-this.state.dailyLimit||s.equity<=this.state.dayEquity-Math.min(this.state.dailyLimit,this.state.dayEquity*.02)}
 async reconcile(s){
  let resolved=true;
  if(this.state.intent){
   const intent=this.state.intent,pos=s.positions.find(p=>p.symbol===intent.symbol);
   let order=null;try{order=await this.broker.order(intent.symbol,intent.link)}catch{}
   // An unavailable order lookup never skips protection of a discoverable position.
   const terminal=order&&['Filled','PartiallyFilledCanceled','Cancelled','Rejected','Deactivated'].includes(order.orderStatus);
   const executed=order&&Number(order.cumExecQty);
   if(pos){
    if(pos.side!==intent.side||!finitePositive(pos.size)||Number(pos.size)>Number(intent.qty)+1e-9)throw Error('Position differs from recorded order; manual review required');
    // A discoverable partial fill needs protective checks even while the remainder is unresolved.
    let trade=this.state.managed.find(x=>x.link===intent.link);
    if(!trade){trade={...intent,qty:String(pos.size)};this.state.managed.push(trade)}else trade.qty=String(pos.size);
    if(terminal&&Number.isFinite(executed)&&executed>0&&executed+1e-9>=Number(pos.size)){
     this.state.intent=null;this.event('Reconciled terminal '+intent.symbol+' fill.');
    }else{
     this.state.active=false;resolved=false;this.event('Partial or uncertain '+intent.symbol+' entry; monitoring protection while remaining fill is reconciled.');
    }
    this.save();
   }else if(terminal&&['Cancelled','Rejected','Deactivated'].includes(order.orderStatus)&&Number.isFinite(executed)&&executed===0){
    this.state.intent=null;this.event('Entry cancelled or rejected without a fill.');this.save();
   }else{
    this.state.active=false;resolved=false;this.event('Entry outcome unresolved. New entries paused; inspect the order at Bybit.');this.save();
   }
  }
  for(const trade of [...this.state.managed]){
   const position=s.positions.find(p=>p.symbol===trade.symbol);
   if(!position){
    // Keep a partial-entry ledger until its remaining order is terminal, even if a fill already exited.
    if(this.state.intent?.link===trade.link)continue;
    this.state.managed=this.state.managed.filter(x=>x.link!==trade.link);this.event(trade.symbol+' is closed at the broker.');continue;
   }
   if(position.side!==trade.side||!finitePositive(position.size)||Math.abs(Number(position.size)-Number(trade.qty))>1e-9)throw Error('Managed position changed outside the bot; review at Bybit');
   const stop=Number(position.stopLoss),target=Number(position.takeProfit),entry=Number(position.avgPrice||trade.price),mark=Number(position.markPrice||entry),direction=trade.side==='Buy'?1:-1;
   const tolerance=Math.max(entry*1e-9,1e-10);
   const protectedPosition=[stop,target,entry,mark].every(finitePositive)&&direction*(target-entry)>0&&direction*(target-stop)>0&&direction*(mark-stop)>-tolerance&&direction*(stop-Number(trade.stopLoss))>=-tolerance;
   if(!protectedPosition||trade.exitLink){
    this.state.active=false;
    if(!trade.exitLink){
     trade.exitLink='omexit'+crypto.randomBytes(12).toString('hex');
     this.save(); // Fsynced intent precedes a potentially ambiguous emergency-close write.
     await this.broker.close(position,trade.exitLink);
     this.event('Protection missing or widened: reduce-only emergency close submitted for '+trade.symbol+'. Verify it filled at Bybit.');
    }else{
     const closeOrder=await this.broker.order(trade.symbol,trade.exitLink);
     this.event('Emergency close pending on '+trade.symbol+' ('+(closeOrder?.orderStatus||'unknown outcome')+'). Inspect at Bybit immediately.');
    }
    this.save();return false;
   }
   // Exchange TP/SL provide continuous exits, even when this worker is stopped.
  }
  this.save();return resolved;
 }
 cycle(){if(this.cycling)return Promise.resolve();this.cycling=true;return this.exclusive(async()=>{
  if(!this.broker.ready()||(!this.state.active&&!this.state.managed.length&&!this.state.intent))return;
  try{
   const s=await this.broker.snapshot();validateSnapshot(s);this.rollDay(s);this.state.lastCheck=Date.now();
   if(!await this.reconcile(s))return;
   if(this.lossLimit(s)){this.state.active=false;this.event('Daily loss budget reached. New entries locked; broker protective exits remain active.');this.save();return}
   if(!this.state.active)return;
   if(this.env.OMEGA_LIVE_ORDERS_ENABLED!=='true'){this.state.active=false;this.event('Server kill switch is off.');this.save();return}
   if(s.pending.length||s.positions.length>=2){this.event('Managing current exposure; no new entry.');this.save();return}
   if(s.positions.some(p=>!this.state.managed.some(x=>x.symbol===p.symbol)))throw Error('Unmanaged position detected; new entries paused');
   if(s.available<10||10>s.equity*.2)throw Error('Available balance or exposure limit blocks a $10 entry');
   const marketSnapshot=await this.broker.markets();
   const liquid=marketSnapshot.map(scanner.futuresScreen).filter(x=>x&&x.turnover24h>=10000000&&x.spreadBps<=8).sort((a,b)=>b.qualityScore-a.qualityScore);
   this.decisions=[];
   const held=s.positions.map(p=>({...p,entryEvidence:this.state.managed.find(t=>t.symbol===p.symbol)?.entryEvidence}));
   const {results,picks,coverage,summary}=await scanMarkets(marketSnapshot.map(scanner.futuresScreen).filter(Boolean),{
    analyze:this.analyze,
    isCancelled:()=>!this.state.active||this.env.OMEGA_LIVE_ORDERS_ENABLED!=='true',
    canEnter:plan=>!s.positions.some(p=>p.symbol===plan.symbol)&&!concentrated(plan.side,plan.metrics?.benchmarkCorrelation,held),
    onProgress:c=>{this.coverage={...c,snapshotMarkets:marketSnapshot.length,liquidMarkets:liquid.length};this.state.message='Full-market scan: '+c.checked+' / '+c.total+' screened'}
   });
   for(const result of results)this.recordDecision(result.symbol,result);
   if(!coverage.complete)return;
   for(const candidate of picks){
    if(!this.state.active||this.env.OMEGA_LIVE_ORDERS_ENABLED!=='true')return;
    const item={symbol:candidate.symbol};
    const plan=await this.analyze(item.symbol);this.recordDecision(item.symbol,plan);
    if(plan.executionPolicy==='DEMO_FORWARD_TEST')throw Error('Demo forward-test decisions cannot authorize real orders');
    if(!plan.eligible||!['BUY','SELL'].includes(plan.side))continue;
    const side=plan.side;
    if(concentrated(side,plan.metrics?.benchmarkCorrelation,held))continue;
    let ticket;try{ticket=await this.broker.ticket(item.symbol,side==='BUY'?'Buy':'Sell',plan)}catch{continue}
    // Recheck all account limits immediately before a write. No stale scan snapshot.
    const fresh=await this.broker.snapshot();validateSnapshot(fresh);
    if(this.lossLimit(fresh)||fresh.pending.length||fresh.positions.length>=2||fresh.positions.some(p=>p.symbol===item.symbol)||fresh.positions.some(p=>!this.state.managed.some(x=>x.symbol===p.symbol))||fresh.available<10||10>fresh.equity*.2)throw Error('Account risk changed while scanning; entry blocked');
    const executionCost=Math.max(EXECUTION_COST_RATE,Number(ticket.estimatedRoundTripCostRate)||0);
    const newRisk=Math.abs(ticket.price-Number(ticket.stopLoss))*Number(ticket.qty)+ticket.notional*executionCost;
    if(!Number.isFinite(newRisk)||newRisk<=0)throw Error('Proposed stop risk is invalid');
    const openRisk=fresh.positions.reduce((sum,p)=>{
     const price=Number(p.markPrice),stop=Number(p.stopLoss),size=Number(p.size);
     if(!(price>0&&stop>0&&size>0))throw Error('Open-position stop risk is unverifiable');
     return sum+Math.max(0,(p.side==='Buy'?price-stop:stop-price)*size)+price*size*EXECUTION_COST_RATE;
    },0);
    const remaining=Math.min(this.state.dailyLimit+Math.min(0,fresh.pnlToday),this.state.dailyLimit-Math.max(0,this.state.dayEquity-fresh.equity));
    if(newRisk>fresh.equity*.0025||newRisk+openRisk>remaining)throw Error('Proposed stop risk exceeds per-trade or remaining daily budget');
    if(!Number.isFinite(plan.expiresAt)||Date.now()>plan.expiresAt||Date.now()-(plan.barTime+300000)>360000)throw Error('Market evidence expired before entry');
    if(!this.state.active||this.env.OMEGA_LIVE_ORDERS_ENABLED!=='true')return;
    await this.broker.leverage(item.symbol);
    if(!this.state.active||this.env.OMEGA_LIVE_ORDERS_ENABLED!=='true')return;
    if(Date.now()>plan.expiresAt)throw Error('Market evidence expired while preparing the order');
    const link='om10'+crypto.randomBytes(12).toString('hex');
    this.state.intent={...ticket,link,barTime:plan.barTime,targetNet:plan.targetNet,entryEvidence:{strategy:'evidence-v11',observedAt:plan.observedAt,checksPassed:plan.checks?.filter(x=>x.pass).length||0,validationTrades:plan.validation?.tradeCount||0,benchmarkCorrelation:plan.metrics?.benchmarkCorrelation??null},openedAt:Date.now()};
    // Durable intent precedes order submission. An ambiguous request is never retried blindly.
    this.save();
    await this.broker.enter(ticket,link);
    this.event('Entry submitted for '+item.symbol+'; waiting for broker fill and protective-order reconciliation.');this.save();return;
   }
   this.event(picks.length?'No entry: ranked setups failed fresh evidence, portfolio or exchange sizing checks.':'No entry: '+explain(summary));this.save();
  }catch(e){this.state.active=false;this.event(this.state.intent?'Broker outcome uncertain. Entries paused pending reconciliation.':'Entries paused: '+String(e.message||'Broker/data/risk check failed').slice(0,180));this.save()}
 }).finally(()=>{this.cycling=false})}
}
let controller=null;
module.exports={TradingWorker,getController:()=>controller,setController:value=>{controller=value}};
