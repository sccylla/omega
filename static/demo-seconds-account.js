'use strict';
// Independent demo-only $100 seconds-scalping wallet. Existing OMEGA Demo
// cloud/local ledger and all funded exchange orders are deliberately untouched.
(function(root,factory){const api=factory(typeof module!=='undefined'&&module.exports?require('./seconds-shadow'):root?.OmegaSecondsShadow);if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaDemoSeconds=api})(typeof window!=='undefined'?window:null,function(Shadow){
 if(!Shadow)throw Error('Seconds shadow execution engine unavailable');
 const VERSION=1,INITIAL_USD=100,TRADE_USD=90,DAILY_LOSS_FRACTION=.02;
 const SMALL_VERSION=2,SMALL_INITIAL_USD=88,SMALL_TRADE_USD=15,SMALL_TARGET_NET=.05,
  SMALL_STOP_NET=.08,SMALL_DAILY_LOSS_USD=1;
 const sizing=a=>a?.version===SMALL_VERSION?
  {notional:SMALL_TRADE_USD,targetNet:SMALL_TARGET_NET,stopNet:SMALL_STOP_NET}:
  {notional:TRADE_USD,targetNet:.50,stopNet:.75};
 const dailyCap=(a,start)=>a.version===SMALL_VERSION?Math.min(SMALL_DAILY_LOSS_USD,start*DAILY_LOSS_FRACTION):start*DAILY_LOSS_FRACTION;
 const round=(x,d=4)=>Number(x.toFixed(d));
 const day=now=>new Date(now).toISOString().slice(0,10);
 const initial=(now=Date.now())=>({version:VERSION,starting:INITIAL_USD,cash:INITIAL_USD,
  day:day(now),dayStartEquity:INITIAL_USD,closedTrades:0,wins:0,ledger:Shadow.init(),createdAt:now});
 const smallInitial=(now=Date.now())=>({...initial(now),version:SMALL_VERSION,
  starting:SMALL_INITIAL_USD,cash:SMALL_INITIAL_USD,dayStartEquity:SMALL_INITIAL_USD});
 function restore(raw,now=Date.now(),fallbackVersion=VERSION){
  const fallback=()=>fallbackVersion===SMALL_VERSION?smallInitial(now):initial(now);
  if(!raw||![VERSION,SMALL_VERSION].includes(raw.version)||
    raw.starting!==(raw.version===SMALL_VERSION?SMALL_INITIAL_USD:INITIAL_USD)||!Number.isFinite(raw.cash)||
    raw.cash<-10000||raw.cash>100000||!Number.isSafeInteger(raw.closedTrades)||raw.closedTrades<0||
    !Number.isSafeInteger(raw.wins)||raw.wins<0||raw.wins>raw.closedTrades||
    !Number.isFinite(raw.dayStartEquity)||raw.dayStartEquity<=0||
    typeof raw.day!=='string'||!/^20\d\d-\d\d-\d\d$/.test(raw.day)||
    !raw.ledger||!Array.isArray(raw.ledger.closed)||raw.ledger.closed.length>200)return fallback();
  const shadow=Shadow.restore(raw.ledger);
  // Never manufacture balance from a partially corrupted ledger.
  if(shadow.version!==1)return fallback();
  return {...raw,ledger:shadow};
 }
 function eligibility(account,now=Date.now()){
  const value=restore(account,now),fresh=day(now)!==value.day,
   start=fresh?value.cash:value.dayStartEquity;
  if(value.ledger.open)return {allowed:false,reason:'An existing seconds virtual position must close first'};
  const policy=sizing(value);
  if(value.cash+1e-8<policy.notional)return {allowed:false,reason:'Virtual equity below the $'+policy.notional+' position minimum'};
  if(value.cash<=start-dailyCap(value,start)+1e-8)
   return {allowed:false,reason:'2% demo daily loss limit reached'};
  return {allowed:true,reason:'Eligible for $'+policy.notional+' virtual research entries'};
 }
 function step(raw,{now=Date.now(),signals=[],quotes={},connected=true}={}){
  let account=restore(raw,now);
  if(day(now)!==account.day)account={...account,day:day(now),dayStartEquity:account.cash};
  const risk=eligibility(account,now);
  const policy=sizing(account);
  const result=Shadow.step(account.ledger,{now,signals:risk.allowed?signals:[],quotes,connected,maxHoldMs:null,cooldownMs:3000,...policy});
  if(!result.events.length)return {account:{...account,ledger:result.state},events:[],risk};
  const trades=result.events.filter(e=>e.type==='CLOSED').map(e=>e.trade);
  const net=trades.reduce((sum,t)=>sum+t.net,0);
  account={...account,ledger:result.state,cash:round(account.cash+net,6),
   closedTrades:account.closedTrades+trades.length,
   wins:account.wins+trades.filter(t=>t.net>0).length};
  return {account,events:result.events,risk:eligibility(account,now)};
 }
 function interrupt(raw,now=Date.now()){
  const account=restore(raw,now);
  return {...account,ledger:Shadow.interrupt(account.ledger)};
 }
 function stats(raw,now=Date.now(),quotes={}){
  const a=restore(raw,now),rawStats=Shadow.stats(a.ledger),
   risk=eligibility(a,now);
  const position=a.ledger.open,q=position&&quotes?.[position.symbol];
  const priced=Boolean(position&&q&&Number.isFinite(position.entry)&&position.entry>0&&
   Number.isFinite(q.bidVwap)&&q.bidVwap>0&&Number.isFinite(q.askVwap)&&q.askVwap>q.bidVwap&&
   Number.isFinite(q.observedAt)&&q.observedAt<=now+1000&&now-q.observedAt<=2300);
  const unrealized=priced?Shadow.pnl(position,q):null;
  return {wallet:round(a.cash,2),equity:round(a.cash,2),
   estimatedEquity:position?(Number.isFinite(unrealized)?round(a.cash+unrealized,2):null):round(a.cash,2),
   unrealizedNetUsd:Number.isFinite(unrealized)?round(unrealized,4):null,
   openMarkPriced:priced,
   totalNetUsd:round(a.cash-a.starting,2),
   tradeNotional:sizing(a).notional,targetNet:sizing(a).targetNet,stopNet:sizing(a).stopNet,
   todayNetUsd:round(a.cash-(a.day===day(now)?a.dayStartEquity:a.cash),2),
   closedTrades:a.closedTrades,wins:a.wins,
   winRatePct:a.closedTrades?round(a.wins/a.closedTrades*100,1):null,
   dailyMaxLossUsd:round(dailyCap(a,a.day===day(now)?a.dayStartEquity:a.cash),2),
   canEnter:risk.allowed,entryBlock:risk.allowed?null:risk.reason,
   open:a.ledger.open?{symbol:a.ledger.open.symbol,side:a.ledger.open.side,entry:a.ledger.open.entry,openedAt:a.ledger.open.openedAt}:null,
   recent:rawStats.last,incomplete:rawStats.incomplete,
   ledgerLocalOnly:true};
 }
 return {VERSION,INITIAL_USD,TRADE_USD,DAILY_LOSS_FRACTION,
  SMALL_VERSION,SMALL_INITIAL_USD,SMALL_TRADE_USD,SMALL_TARGET_NET,SMALL_STOP_NET,SMALL_DAILY_LOSS_USD,
  initial,smallInitial,restore,eligibility,step,interrupt,stats};
});
