'use strict';
// More responsive *Demo-only* research trigger. The full $0.50 modeled net
// exit target is NOT the minimum historical movement needed for entry.
// Never use these experimental signals to authorize a funded Bybit order.
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaDemoSecondsSignals=api})(typeof window!=='undefined'?window:null,function(){
 const finite=Number.isFinite,clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),round=x=>Number(x.toFixed(1));
 function evaluate(raw){
  if(!raw||raw.state==='NO_DATA'||raw.state==='UNKNOWN')return raw;
  const q={...raw,analysisMode:'DEMO_EXPLORATORY_RESEARCH',meaning:'Experimental Demo signal score, not probability of success or a profit guarantee'};
  const enough=['range30Bps','move5Bps','move15Bps','spreadBps','roundTripImpactBps','depthBid','depthAsk','matchedTrades15s','flowPressure','imbalance','requiredMoveBps'].every(k=>finite(raw[k]));
  if(!enough)return {...q,state:'WARMING',side:null,score:0,reason:'Collecting a valid 30-second trade-flow baseline',reasons:['Waiting for completed real-time book, trade and price samples']};
  const dir=Math.sign(raw.move15Bps),aligned5=dir*raw.move5Bps,aligned15=dir*raw.move15Bps,alignedFlow=dir*raw.flowPressure,alignedBook=dir*raw.imbalance;
  const checks=[
   [raw.range30Bps>=8,'30-second range below 8 bp exploratory entry requirement'],
   [dir!==0&&aligned15>=4.5&&aligned5>=1.5,'5s and 15s impulse not aligned or too weak'],
   [raw.matchedTrades15s>=12,'Fewer than 12 matched trades in 15 seconds'],
   [raw.spreadBps<=3,'Spread exceeds 3 bp'],
   [raw.roundTripImpactBps<=8,'Order-book execution impact exceeds 8 bp'],
   [raw.depthBid>=1000&&raw.depthAsk>=1000,'Insufficient $1,000 depth on both sides'],
   [dir!==0&&alignedFlow>=.15,'Buy/sell aggressor volume does not confirm the impulse'],
   [dir!==0&&alignedBook>=.02,'Top-book liquidity does not confirm the impulse'],
   [raw.range30Bps<=200,'Extreme volatility shock; high reversal risk']
  ];
  const reasons=checks.filter(x=>!x[0]).map(x=>x[1]);
  const score=round(
   25*clamp(raw.range30Bps/14,0,1)+
   20*clamp(aligned15/9,0,1)+
   10*clamp(aligned5/4,0,1)+
   15*clamp(alignedFlow/.6,0,1)+
   10*clamp(alignedBook/.25,0,1)+
   10*clamp(1-raw.roundTripImpactBps/8,0,1)+
   10*clamp(raw.matchedTrades15s/25,0,1)
  );
  if(score<65)reasons.push('Experimental entry quality '+score+'/100 is below 65');
  const ready=reasons.length===0;
  return {...q,state:ready?'WATCH':'WAIT',side:ready?(dir>0?'BUY':'SELL'):null,score,
   requiredMoveBps:raw.requiredMoveBps,entryMomentumBps:8,
   reason:ready?'Exploratory Demo impulse qualifies; $0.50 net exit is NOT guaranteed':reasons[0],reasons};
 }
 return {evaluate};
});
