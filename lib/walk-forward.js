'use strict';
// OMEGA walk-forward research. No trading, live switches, model persistence or
// automatic promotion. Time-order, label embargo and test-data isolation matter.
const intelligence=require('./omega-intelligence');
const Q=require('./quant-engine');
const FIVE_MIN=300000;
const THRESHOLDS=[{name:'Current directional filter',upper:.67,lower:.33},{name:'Selective directional filter',upper:.74,lower:.26}];
const round=(n,d=3)=>Number(n.toFixed(d));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function createSamples(rows){
 const out=[];
 for(let i=70;i<rows.length-2;i++){
  if(rows[i+1][0]-rows[i][0]!==FIVE_MIN||rows[i+2][0]-rows[i+1][0]!==FIVE_MIN)continue;
  out.push({i,x:intelligence.vector(rows,i),y:rows[i+2][4]>rows[i+1][1]?1:0});
 }
 return out;
}
function regime(rows,i){
 const f=Q.features(rows.slice(Math.max(0,i-110),i+1));
 if(!finite(f.adx)||!finite(f.atrPct))return 'UNKNOWN';
 if(f.atrPct>1.8)return 'HIGH VOLATILITY';
 if(f.adx>=25&&f.atrPct>=.08)return 'TREND';
 return 'RANGE / TRANSITION';
}
function evaluate(rows,samples,model,filter,{asset='BTC',equity=500}={}){
 const trades=[],byRegime=new Map();let cash=equity,peak=equity,drawdown=0,lastTraded=-Infinity;
 let brier=0,measured=0;
 for(const sample of samples){
  const guess=intelligence.infer(model,sample.x);
  if(!finite(guess))throw Error('Model inference returned an invalid output');
  brier+=(guess-sample.y)**2;measured++;
  if(sample.i<=lastTraded+2)continue; // One at a time; do not reuse an exit bar.
  const side=guess>=filter.upper?'BUY':guess<=filter.lower?'SELL':null;
  if(!side)continue;
  // These are deliberately illustrative 10-minute holds, NOT funded-live
  // strategy reproductions. Conservative modeled fees are deducted by trade().
  const outcome=intelligence.trade(rows,sample.i,side==='BUY'?.70:.30,{
   asset,equity:cash,riskPct:.25,spreadBps:2,extraCostBps:24
  });
  if(!outcome||!finite(outcome.pnl))continue;
  lastTraded=sample.i;
  cash+=outcome.pnl;peak=Math.max(peak,cash);
  drawdown=Math.max(drawdown,peak-cash);
  const condition=regime(rows,sample.i),entry={
   openedAt:rows[sample.i+1][0],closedAt:rows[sample.i+2][0]+FIVE_MIN,
   symbol:asset,side,net:round(outcome.pnl,5),reason:outcome.reason,
   regime:condition
  };
  trades.push(entry);
  if(!byRegime.has(condition))byRegime.set(condition,{regime:condition,trades:0,wins:0,net:0});
  const stat=byRegime.get(condition);stat.trades++;stat.wins+=Number(outcome.pnl>0);stat.net+=outcome.pnl;
 }
 const wins=trades.filter(x=>x.net>0),losses=trades.filter(x=>x.net<=0);
 const net=trades.reduce((n,x)=>n+x.net,0);
 return {
  trades:trades.length,wins:wins.length,losses:losses.length,winRatePct:trades.length?round(wins.length/trades.length*100,1):null,
  netUsd:round(net),avgNetUsd:trades.length?round(net/trades.length,4):null,
  maxDrawdownUsd:round(drawdown),brier:measured?round(brier/measured,5):null,
  regimeBreakdown:[...byRegime.values()].map(x=>({...x,net:round(x.net),winRatePct:round(x.wins/x.trades*100,1)})),
  recent:trades.slice(-8).reverse()
 };
}
function evaluateWalkForward(rows,{asset='BTC'}={}){
 intelligence.assertCandles(rows);
 if(!/^[A-Z0-9]{2,20}$/.test(asset))throw Error('Invalid research asset');
 const samples=createSamples(rows);
 const trainSize=250,validateSize=90,testSize=100,stride=100,maxFolds=5;
 if(samples.length<trainSize+validateSize+testSize)throw Error('At least 440 usable labeled historical bars required');
 const folds=[],decisions=[],allTrades=[],regimes=new Map();
 let evaluated=0,chosenNet=0,baselineNet=0,chosenTrades=0,baselineTrades=0;
 for(let start=trainSize+validateSize;start+testSize<=samples.length&&folds.length<maxFolds;start+=stride){
  const validate=samples.slice(start-validateSize,start);
  const test=samples.slice(start,start+testSize);
  // A label at i requires bars i+1 and i+2. Discard training rows
  // whose outcome would not have been known when validation/testing began.
  const beforeValidation=samples.slice(Math.max(0,start-validateSize-trainSize),start-validateSize)
   .filter(x=>x.i+2<validate[0].i);
  const beforeTest=samples.slice(Math.max(0,start-validateSize-trainSize),start)
   .filter(x=>x.i+2<test[0].i);
  if(beforeValidation.length<180||beforeTest.length<220)throw Error('Insufficient embargoed training history');
  const validationModel=intelligence.fit(beforeValidation);
  const baselineValidation=evaluate(rows,validate,validationModel,THRESHOLDS[0],{asset});
  const selectiveValidation=evaluate(rows,validate,validationModel,THRESHOLDS[1],{asset});
  // The candidate is selected using validation ONLY. No test statistics
  // are consulted before the choice. Require a minimum sample and
  // meaningful improvement; otherwise retain the published baseline.
  const promoteResearchCandidate=selectiveValidation.trades>=8&&
   selectiveValidation.avgNetUsd>0&&
   selectiveValidation.netUsd>baselineValidation.netUsd+0.10&&
   selectiveValidation.maxDrawdownUsd<=baselineValidation.maxDrawdownUsd;
  const selected=promoteResearchCandidate?THRESHOLDS[1]:THRESHOLDS[0];
  const evaluationModel=intelligence.fit(beforeTest);
  const heldBaseline=evaluate(rows,test,evaluationModel,THRESHOLDS[0],{asset});
  const heldSelected=evaluate(rows,test,evaluationModel,selected,{asset});
  folds.push({
   number:folds.length+1,
   trainExamples:beforeTest.length,validationExamples:validate.length,testExamples:test.length,
   trainLastSignalAt:rows[beforeTest.at(-1).i][0],
   validationStartAt:rows[validate[0].i][0],testStartAt:rows[test[0].i][0],
   testEndAt:rows[test.at(-1).i][0],
   chosenPolicy:selected.name,validationTrades:selectiveValidation.trades,
   validationNetUsd:selectiveValidation.netUsd,validationBaselineNetUsd:baselineValidation.netUsd,
   baseline:heldBaseline,selected:heldSelected
  });
  evaluated+=test.length;
  chosenNet+=heldSelected.netUsd;baselineNet+=heldBaseline.netUsd;
  chosenTrades+=heldSelected.trades;baselineTrades+=heldBaseline.trades;
  decisions.push(selected.name);
  allTrades.push(...heldSelected.recent);
  for(const r of heldSelected.regimeBreakdown){
   const stat=regimes.get(r.regime)||{regime:r.regime,trades:0,wins:0,netUsd:0};
   stat.trades+=r.trades;stat.wins+=r.wins;stat.netUsd+=r.net;regimes.set(r.regime,stat);
  }
 }
 if(folds.length<3)throw Error('At least three independent walk-forward folds required');
 const uniquePolicies=new Set(decisions);
 const improvement=chosenNet-baselineNet;
 return {
  mode:'WALK_FORWARD_RESEARCH_ONLY',asset,trainedOnRealOrders:false,liveExecutionAffected:false,
  independentTestWindows:folds.length,heldOutSignals:evaluated,
  researchComparison:{
   baselineNetUsd:round(baselineNet),candidateSelectedNetUsd:round(chosenNet),
   differenceUsd:round(improvement),baselineTrades,selectedTrades:chosenTrades,
   policyConsistency:uniquePolicies.size===1?'SAME_CHOICE':'VARIES_BY_WINDOW',
   status:chosenTrades>=30&&improvement>0&&uniquePolicies.size===1?'REQUIRES_MORE_VALIDATION':'INSUFFICIENT_EVIDENCE',
   recommendation:'No automatic promotion to live trading. Research findings need more independent periods, realistic broker fills and forward-tested closed trades.'
  },
  folds,regimes:[...regimes.values()].map(r=>({...r,netUsd:round(r.netUsd),winRatePct:r.trades?round(r.wins/r.trades*100,1):null})).sort((a,b)=>b.trades-a.trades),
  recentSimulatedTrades:allTrades.sort((a,b)=>b.closedAt-a.closedAt).slice(0,12),
  limitations:'Historical 5m OHLCV only. Refit on past data with a two-bar label embargo; validation selects a threshold and later test windows are untouched. Simulation uses fixed spread/fees, a short fixed holding window, and an approximate stop; it does not replay the actual OMEGA strict live strategy, real order-book conditions, funding, gaps, fills, liquidations or broker stop execution. No learned decision is automatically applied to demo or real orders.'
 };
}
const summarizeClosedTrades=require('../static/trade-review').summarizeClosedTrades;
module.exports={evaluateWalkForward,summarizeClosedTrades,createSamples,evaluate,regime,THRESHOLDS};
