'use strict';
// Public, strictly pre-outcome shadow forecast: never submits funded orders.
// The candidate threshold was preregistered at 0.72; historical results may not
// be used to change it within the same forward-observation series.
const crypto=require('node:crypto');
const I=require('./omega-intelligence'),Q=require('./quant-engine');
const {createSamples}=require('./walk-forward');
const {MIN_LIVE_ORDER_USD,AUTO_NET_PROFIT_TARGET_USD}=require('./live-policy');
const PERIOD=300000,VERSION='OMEGA_ADAPTIVE_SHADOW_V1';
const round=(v,d=6)=>Number(v.toFixed(d)),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function makeForecast(rows,{asset,quote,now=Date.now()}={}){
 if(!['BTC','ETH','SOL'].includes(asset)||!quote||quote.symbol!==asset+'USDT')throw Error('Unsupported or mismatched shadow market');
 I.assertCandles(rows);
 if(rows.length<1830)throw Error('Not enough historical candles for shadow model');
 const past=rows.slice(-1830),last=past.at(-1);
 for(let i=1;i<past.length;i++)if(past[i][0]-past[i-1][0]!==PERIOD)throw Error('Unverifiable gap in training history');
 if(!Number.isFinite(quote.observedAt)||now-quote.observedAt>10000||quote.observedAt>now+1000||quote.observedAt<last[0]+PERIOD||now-(last[0]+PERIOD)>PERIOD*1.5)throw Error('Stale shadow observation or unfinished candle');
 if(!(quote.ask>quote.bid&&quote.bid>0)||!Number.isFinite(quote.ask)||!Number.isFinite(quote.bid))throw Error('Invalid entry quote');
 const all=createSamples(rows).filter(s=>s.i+2<=rows.length-1);
 const train=all.slice(-1760);
 if(train.length<1760)throw Error('Not enough fully observed training labels');
 const model=I.fit(train),prob=I.infer(model,I.vector(rows,rows.length-1));
 if(!(prob>0&&prob<1))throw Error('Nonfinite model probability');
 const features=Q.features(rows.slice(-90)),stopPct=clamp(features.atrPct*1.8,.4,2);
 const policies=[{id:'BASELINE_067',limit:.67},{id:'ADAPTIVE_072',limit:.72}].map(policy=>{
  const dir=prob>=policy.limit?1:prob<=1-policy.limit?-1:0;
  if(!dir)return {id:policy.id,limit:policy.limit,side:'WAIT'};
  const entry=dir===1?quote.ask:quote.bid,notional=MIN_LIVE_ORDER_USD,costs=notional*.0026,stopRisk=notional*(stopPct/100+.0026);
  if(stopRisk>500*.0025)return {id:policy.id,limit:policy.limit,side:'WAIT',reason:'Paper risk exceeds 0.25% of $500 reference account'};
  const targetNet=AUTO_NET_PROFIT_TARGET_USD+.02,stop=entry*(1-dir*stopPct/100),target=entry*(1+dir*(targetNet+costs)/notional);
  return {id:policy.id,limit:policy.limit,side:dir===1?'BUY':'SELL',entry:round(entry,10),stop:round(stop,10),
   target:round(target,10),notional,estimatedCostsUsd:round(costs),estimatedStopRiskUsd:round(stopRisk),targetNetUsd:targetNet};
 });
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({version:VERSION,asset,trainEnd:rows[train.at(-1).i][0],weights:model.weights,means:model.means,std:model.std,thresholds:[.67,.72]})).digest('hex').slice(0,24);
 return {mode:'FORWARD_SHADOW_RESEARCH_ONLY',version:VERSION,symbol:asset+'USDT',
  id:VERSION+'-'+asset+'-'+last[0],forecastBarTime:last[0],observedAt:quote.observedAt,
  expiresAt:last[0]+PERIOD*2,modelFingerprint:fingerprint,
  upEstimate:round(prob,6),regime:features.atrPct>1.8?'HIGH VOLATILITY':features.adx>=25?'TREND':'RANGE / TRANSITION',
  policies,limitBars:2,
  note:'A pre-outcome, simulated research forecast. It is NOT a broker order, calibrated win rate, or proven trading edge. Collect and compare after subsequent closed candles.'};
}
module.exports={makeForecast,VERSION,PERIOD};
