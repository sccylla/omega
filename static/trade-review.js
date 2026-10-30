'use strict';
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaTradeReview=api})(typeof window!=='undefined'?window:null,function(){
 const round=(n,d=3)=>Number(n.toFixed(d));
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
function summarizeClosedTrades(records,{label='DEMO',now=Date.now()}={}){
 const clean=Array.isArray(records)?records.filter(x=>
  x&&['BUY','SELL','Buy','Sell'].includes(x.side)&&typeof x.symbol==='string'&&
  /^[A-Z0-9]{2,24}(?:USDT)?$/.test(x.symbol)&&finite(x.net)&&
  finite(x.closedAt)&&x.closedAt<=now+60000&&x.closedAt>=Date.UTC(2020,0,1)
 ).sort((a,b)=>a.closedAt-b.closedAt).slice(-200):[];
 const byMarket=new Map(),bySide=new Map(),byCondition=new Map();
 let net=0,peak=0,trough=0,maxDrawdown=0,wins=0;
 for(const item of clean){
  net+=item.net;peak=Math.max(peak,net);trough=Math.min(trough,net-peak);
  maxDrawdown=Math.max(maxDrawdown,peak-net);wins+=Number(item.net>0);
  const e=item.entryEvidence||{};
  const condition=typeof e.regime==='string'&&['TREND','RANGE / TRANSITION','HIGH VOLATILITY'].includes(e.regime)?e.regime:'NOT RECORDED';
  for(const [map,key] of [[byMarket,item.symbol],[bySide,item.side.toUpperCase()],[byCondition,condition]]){
   const x=map.get(key)||{name:key,count:0,wins:0,net:0};
   x.count++;x.wins+=Number(item.net>0);x.net+=item.net;map.set(key,x);
  }
 }
 const group=map=>[...map.values()].sort((a,b)=>b.count-a.count).slice(0,15).map(x=>({...x,net:round(x.net),winRatePct:round(x.wins/x.count*100,1)}));
 return {
  mode:'CLOSED_TRADE_DIAGNOSTICS',source:label,sampleSize:clean.length,netUsd:round(net),
  winRatePct:clean.length?round(wins/clean.length*100,1):null,
  averageNetUsd:clean.length?round(net/clean.length,4):null,
  maxDrawdownUsd:round(maxDrawdown),
  byMarket:group(byMarket),bySide:group(bySide),byRegime:group(byCondition),
  recent:clean.slice(-8).reverse().map(x=>({symbol:x.symbol,side:x.side.toUpperCase(),net:round(x.net),closedAt:x.closedAt,reason:String(x.reason||'Exchange closed').slice(0,80)})),
  interpretation:clean.length<30?'Small sample: do not optimize or promote a live strategy from these outcomes.':'Descriptive completed-trade statistics, not a validated prediction of future profit.',
  limitations:label==='BYBIT'?'Bybit reports closed-position PnL; accounting may exclude some trading costs, funding, transfers or partial-fill details. Regime is not recorded for older fills. No broker orders are placed.':'Demo fills are simulated; historical performance is not evidence of live fill quality. Regimes not saved on past trades cannot be reconstructed from PnL alone.'
 };
}

 return {summarizeClosedTrades};
});
