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
  // The $0.50 target requires the *full* fee/spread-adjusted move; a small
  // fraction of that range is not evidence that the target is feasible.
  // Prior v1 accepted ~22bp ranges for trades needing ~70bp, a material
  // mismatch between entry feasibility and actual exit economics.
  const needed=Number(signal.requiredMoveBps);
  if(!Number.isFinite(needed)||needed<=0)reasons.push('Cannot establish after-cost $0.50 target requirements');
  const threshold=Number.isFinite(needed)&&needed>0?Math.max(22,needed):Infinity;
  if(!Number.isFinite(range)||range<threshold)reasons.push('Observed 60s range '+(Number.isFinite(range)?range.toFixed(1):'—')+' bp; require '+(Number.isFinite(threshold)?threshold.toFixed(1):'valid')+' bp for the modeled $0.50 net target');
  if(!Number.isFinite(signal.spreadBps)||signal.spreadBps>2.5)reasons.push('Spread too high for cost-sensitive Demo scalp');
  if(!Number.isFinite(signal.roundTripImpactBps)||signal.roundTripImpactBps>7)reasons.push('Book execution impact too expensive');
  if(reasons.length)return {...signal,state:'WAIT',side:null,feasibilityBps:range,feasibilityThresholdBps:threshold,
   reason:reasons[0],reasons:[...reasons,...(signal.reasons||[])]};
  return {...signal,feasibilityBps:range,feasibilityThresholdBps:threshold,
   meaning:'Demo-only full-target feasibility check; historical range is not a forecast of success and not a forward forecast, entry authorization or profitability validation'};
 }
 return {filter,MIN_LOOKBACK_SECONDS};
});
