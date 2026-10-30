'use strict';
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaDemoScalpGuard=api})(typeof window!=='undefined'?window:null,function(){
 const MIN_LOOKBACK_SECONDS=60;
 function filter(signal,history,now=Date.now()){
  if(!signal||signal.state!=='WATCH')return signal;
  const seconds=Math.floor(now/1000);
  const values=(Array.isArray(history)?history:[]).filter(x=>Number.isFinite(x?.s)&&Number.isFinite(x?.mid)&&x.mid>0&&x.s<=seconds&&x.s>=seconds-60);
  const last=values.at(-1),first=values[0],reasons=[];
  if(!last||!first||values.length<36||seconds-last.s>3||seconds-first.s<MIN_LOOKBACK_SECONDS-2)
   reasons.push('Need 60 seconds of fresh prices before entering a Demo scalp');
  const hi=values.length?Math.max(...values.map(x=>x.mid)):NaN,lo=values.length?Math.min(...values.map(x=>x.mid)):NaN;
  const range=last?.mid>0?10000*(hi-lo)/last.mid:NaN;
  // Cost economics and *past volatility* answer different questions. The
  // modeled required move is the FORWARD price move needed for +$0.50 net;
  // insisting that it already occurred in the last minute made entries
  // almost impossible and is not a statistically justified predictor.
  const needed=signal.requiredMoveBps;
  if(!Number.isFinite(needed)||needed<=0)reasons.push('Cannot establish after-cost net target requirements');
  // Demand a real volatility opportunity without confusing an observed
  // historical range with the future $0.50 take-profit distance.
  const threshold=Number.isFinite(needed)&&needed>0?Math.max(18,Math.min(30,needed*.35)):Infinity;
  if(!Number.isFinite(range)||range<threshold)reasons.push('Observed 60s range '+(Number.isFinite(range)?range.toFixed(1):'—')+' bp; require '+(Number.isFinite(threshold)?threshold.toFixed(1):'valid')+' bp of movement for entry screening (not the take-profit distance)');
  if(!Number.isFinite(signal.spreadBps)||signal.spreadBps>2.5)reasons.push('Spread too high for cost-sensitive Demo scalp');
  if(!Number.isFinite(signal.roundTripImpactBps)||signal.roundTripImpactBps>7)reasons.push('Book execution impact too expensive');
  if(reasons.length)return {...signal,state:'WAIT',side:null,feasibilityBps:range,feasibilityThresholdBps:threshold,
   reason:reasons[0],reasons:[...reasons,...(signal.reasons||[])]};
  return {...signal,feasibilityBps:range,feasibilityThresholdBps:threshold,
   meaning:'Demo-only recent volatility screening, not a forecast of success or a prediction that the full modeled net-profit target will be reached'};
 }
 return {filter,MIN_LOOKBACK_SECONDS};
});
