'use strict';
// Independent demo-only $100 seconds-scalping wallet. Existing OMEGA Demo
// cloud/local ledger and all funded exchange orders are deliberately untouched.
(function(root,factory){const api=factory(typeof module!=='undefined'&&module.exports?require('./seconds-shadow'):root?.OmegaSecondsShadow);if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaDemoSeconds=api})(typeof window!=='undefined'?window:null,function(Shadow){
 if(!Shadow)throw Error('Seconds shadow execution engine unavailable');
 const VERSION=1,INITIAL_USD=100,TRADE_USD=90,DAILY_LOSS_FRACTION=.02;
 const round=(x,d=4)=>Number(x.toFixed(d));
 const day=now=>new Date(now).toISOString().slice(0,10);
 const initial=(now=Date.now())=>({version:VERSION,starting:INITIAL_USD,cash:INITIAL_USD,
  day:day(now),dayStartEquity:INITIAL_USD,closedTrades:0,wins:0,ledger:Shadow.init(),createdAt:now});
 function restore(raw,now=Date.now()){
  if(!raw||raw.version!==VERSION||raw.starting!==INITIAL_USD||!Number.isFinite(raw.cash)||
    raw.cash<-10000||raw.cash>100000||!Number.isSafeInteger(raw.closedTrades)||raw.closedTrades<0||
    !Number.isSafeInteger(raw.wins)||raw.wins<0||raw.wins>raw.closedTrades||
    !Number.isFinite(raw.dayStartEquity)||raw.dayStartEquity<=0||
    typeof raw.day!=='string'||!/^20\d\d-\d\d-\d\d$/.test(raw.day)||
    !raw.ledger||!Array.isArray(raw.ledger.closed)||raw.ledger.closed.length>200)return initial(now);
  const shadow=Shadow.restore(raw.ledger);
  // Never manufacture balance from a partially corrupted ledger.
  if(shadow.version!==1)return initial(now);
  return {...raw,ledger:shadow};
 }
 function eligibility(account,now=Date.now()){
  const value=restore(account,now),fresh=day(now)!==value.day,
   start=fresh?value.cash:value.dayStartEquity;
  if(value.ledger.open)return {allowed:false,reason:'An existing seconds virtual position must close first'};
  if(value.cash+1e-8<TRADE_USD)return {allowed:false,reason:'Virtual equity below the $90 position minimum'};
  if(value.cash<=start*(1-DAILY_LOSS_FRACTION)+1e-8)
   return {allowed:false,reason:'2% demo daily loss limit reached'};
  return {allowed:true,reason:'Eligible for $90 virtual research entries'};
 }
 function step(raw,{now=Date.now(),signals=[],quotes={},connected=true}={}){
  let account=restore(raw,now);
  if(day(now)!==account.day)account={...account,day:day(now),dayStartEquity:account.cash};
  const risk=eligibility(account,now);
  const result=Shadow.step(account.ledger,{now,signals:risk.allowed?signals:[],quotes,connected});
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
 function stats(raw,now=Date.now()){
  const a=restore(raw,now),rawStats=Shadow.stats(a.ledger),
   risk=eligibility(a,now);
  return {wallet:round(a.cash,2),equity:round(a.cash,2),
   totalNetUsd:round(a.cash-INITIAL_USD,2),
   todayNetUsd:round(a.cash-(a.day===day(now)?a.dayStartEquity:a.cash),2),
   closedTrades:a.closedTrades,wins:a.wins,
   winRatePct:a.closedTrades?round(a.wins/a.closedTrades*100,1):null,
   dailyMaxLossUsd:round((a.day===day(now)?a.dayStartEquity:a.cash)*DAILY_LOSS_FRACTION,2),
   canEnter:risk.allowed,entryBlock:risk.allowed?null:risk.reason,
   open:a.ledger.open?{symbol:a.ledger.open.symbol,side:a.ledger.open.side,entry:a.ledger.open.entry,openedAt:a.ledger.open.openedAt}:null,
   recent:rawStats.last,incomplete:rawStats.incomplete,
   ledgerLocalOnly:true};
 }
 return {VERSION,INITIAL_USD,TRADE_USD,DAILY_LOSS_FRACTION,initial,restore,eligibility,step,interrupt,stats};
});
