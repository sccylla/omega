'use strict';
const {MIN_PROFIT_USD}=require('../static/paper-engine');
const MIN_REWARD_RISK=1.5;
function economics({notional,stopPct,costRate,minimumTargetNet=0}={}){
 if(![notional,stopPct,costRate,minimumTargetNet].every(Number.isFinite)||notional<=0||stopPct<=0||costRate<0||minimumTargetNet<0)return null;
 const estimatedCostsUsd=notional*costRate,estimatedStopNetUsd=notional*stopPct/100+estimatedCostsUsd;
 const targetNet=Math.max(minimumTargetNet,MIN_REWARD_RISK*estimatedStopNetUsd);
 if(!Number.isFinite(targetNet)||!Number.isFinite(estimatedStopNetUsd))return null;
 return {targetNet,estimatedStopNetUsd,estimatedCostsUsd,netRewardRisk:targetNet/estimatedStopNetUsd,
  breakEvenWinRatePct:estimatedStopNetUsd/(estimatedStopNetUsd+targetNet)*100,
  grossTargetMovePct:(targetNet+estimatedCostsUsd)/notional*100,
  meaning:'Modeled net payoff after estimated costs; not a forecast or measured win rate'};
}
function minimumTarget(mode){return mode==='demo'?MIN_PROFIT_USD:0}
module.exports={economics,minimumTarget,MIN_REWARD_RISK};
