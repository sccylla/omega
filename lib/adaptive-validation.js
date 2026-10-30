'use strict';
// Chronological nested walk-forward research, never a funded-order strategy.
// A model predicts a *next-10m direction*, while the barrier test examines
// exchange-style TP/SL over up to 4 hours: this is a research surrogate, not
// a recreation of OMEGA's full LIVE_STRICT order strategy.
const I=require('./omega-intelligence'),Q=require('./quant-engine');
const {createSamples}=require('./walk-forward');
const {MIN_LIVE_ORDER_USD,AUTO_NET_PROFIT_TARGET_USD}=require('./live-policy');
const THRESHOLDS=[.67,.72,.77];
const FIVE=300000,ROUND_TRIP_RATE=.0026,TEST_HORIZON_BARS=48;
const MAX_FOLDS=12,TRAIN_SIZE=1400,VALIDATE_SIZE=360,TEST_SIZE=280,EMBARGO=3;
const round=(n,d=3)=>Number(n.toFixed(d));
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
function percentile(xs,p){const v=[...xs].sort((a,b)=>a-b);return v[Math.max(0,Math.min(v.length-1,Math.floor((v.length-1)*p)))]}
function modelTrades(rows,samples,model,threshold,{minEquity=500}={}){
 let available=minEquity,peak=minEquity,maxDrawdown=0,wins=0,grossWins=0,grossLosses=0,unresolved=0,rejectedRisk=0;
 let nextFree=-Infinity;const trades=[],byRegime=new Map();
 for(const sample of samples){
  if(sample.i<nextFree)continue;
  const up=I.infer(model,sample.x);
  if(!Number.isFinite(up))throw Error('Invalid model inference');
  const dir=up>=threshold?1:up<=1-threshold?-1:0;
  if(!dir)continue;
  const entryIndex=sample.i+1,entry=rows[entryIndex]?.[1],size=MIN_LIVE_ORDER_USD;
  if(!(entry>0))continue;
  const f=Q.features(rows.slice(Math.max(0,sample.i-90),sample.i+1));
  const stopPct=clamp(f.atrPct*1.8,.4,2),stopRisk=size*(stopPct/100+ROUND_TRIP_RATE);
  if(!(Number.isFinite(stopRisk)&&stopRisk<=available*.0025&&available>=size/.2)){rejectedRisk++;continue}
  const costs=size*ROUND_TRIP_RATE,targetNet=AUTO_NET_PROFIT_TARGET_USD+.02;
  const takeProfit=entry*(1+dir*(targetNet+costs)/size),stopLoss=entry*(1-dir*stopPct/100);
  if(!(takeProfit>0&&stopLoss>0))continue;
  const lastAvailable=Math.min(rows.length-1,entryIndex+TEST_HORIZON_BARS);
  let exitIndex=null,exit=null,reason=null,ambiguous=false;
  for(let j=entryIndex;j<=lastAvailable;j++){
   const bar=rows[j],stopHit=dir===1?bar[3]<=stopLoss:bar[2]>=stopLoss,profitHit=dir===1?bar[2]>=takeProfit:bar[3]<=takeProfit;
   if(stopHit){exitIndex=j;exit=dir===1?Math.min(stopLoss,bar[1]):Math.max(stopLoss,bar[1]);reason='Protective stop (stop-first model)';ambiguous=profitHit;break}
   if(profitHit){exitIndex=j;exit=takeProfit;reason='Price reached estimated net TP';break}
  }
  if(exitIndex===null){
   unresolved++;nextFree=lastAvailable+1;continue;
  }
  nextFree=exitIndex+1;
  const pnl=dir*(exit-entry)*size/entry-costs;
  if(!Number.isFinite(pnl))throw Error('Nonfinite modeled PnL');
  available+=pnl;
  peak=Math.max(peak,available);maxDrawdown=Math.max(maxDrawdown,peak-available);
  const win=pnl>0;wins+=Number(win);if(win)grossWins+=pnl;else grossLosses-=pnl;
  const regime=f.atrPct>1.8?'HIGH VOLATILITY':f.adx>=25?'TREND':'RANGE / TRANSITION';
  const record={signalAt:rows[sample.i][0],openedAt:rows[entryIndex][0],closedAt:rows[exitIndex][0]+FIVE,symbol:rows.symbol||null,
   side:dir===1?'BUY':'SELL',regime,net:round(pnl,5),reason,ambiguous};
  trades.push(record);
  const stat=byRegime.get(regime)||{regime,count:0,wins:0,netUsd:0};
  stat.count++;stat.wins+=Number(win);stat.netUsd+=pnl;byRegime.set(regime,stat);
 }
 const net=trades.reduce((sum,t)=>sum+t.net,0),count=trades.length;
 return {count,wins,losses:count-wins,unresolved,rejectedRisk,netUsd:round(net),meanNetUsd:count?round(net/count,4):null,
  winRatePct:count?round(wins/count*100,1):null,profitFactor:grossLosses>0?round(grossWins/grossLosses):null,
  maxDrawdownUsd:round(maxDrawdown),byRegime:[...byRegime.values()].map(x=>({...x,netUsd:round(x.netUsd)})),
  recent:trades.slice(-5).reverse()
 };
}
function random(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296}}
function bootstrapFoldNet(folds,{replications=1200,seed=743129}={}){
 if(!Array.isArray(folds)||folds.length<3)throw Error('At least three independent folds required');
 const rnd=random(seed),totals=[];
 for(let b=0;b<replications;b++){let sum=0;for(let i=0;i<folds.length;i++)sum+=folds[Math.floor(rnd()*folds.length)].selected.netUsd;totals.push(sum)}
 return {lower5PctUsd:round(percentile(totals,.05)),medianUsd:round(percentile(totals,.5)),upper95PctUsd:round(percentile(totals,.95)),
  method:'Deterministic resampling of disjoint test-window net results. A rough sensitivity check, NOT a calibrated predictive interval.'};
}
function evaluateAdaptive(rows,{asset='BTC',history=null}={}){
 I.assertCandles(rows);
 if(!/^[A-Z0-9]{2,20}$/.test(asset))throw Error('Invalid asset');
 const samples=createSamples(rows),minimum=TRAIN_SIZE+VALIDATE_SIZE+EMBARGO+TEST_SIZE+TEST_HORIZON_BARS+100;
 if(samples.length<minimum)throw Error('Long-history research requires at least '+minimum+' labeled observations');
 const earliest=TRAIN_SIZE+VALIDATE_SIZE+2*EMBARGO;
 const latest=samples.length-TEST_SIZE-TEST_HORIZON_BARS;
 const span=latest-earliest;
 if(span<(MAX_FOLDS-1)*(TEST_SIZE+TEST_HORIZON_BARS))throw Error('Not enough continuous history for 12 nonoverlapping test windows');
 const folds=[],policyVotes=new Map(),regimes=new Map();
 let baselineNet=0,selectedNet=0,baselineTrades=0,selectedTrades=0,positive=0,selectedUnresolved=0;
 for(let k=0;k<MAX_FOLDS;k++){
  const start=earliest+Math.floor(span*k/(MAX_FOLDS-1));
  const test=samples.slice(start,start+TEST_SIZE);
  const validation=samples.slice(start-EMBARGO-VALIDATE_SIZE,start-EMBARGO);
  const training=samples.slice(start-EMBARGO-VALIDATE_SIZE-EMBARGO-TRAIN_SIZE,start-EMBARGO-VALIDATE_SIZE-EMBARGO);
  if(training.length!==TRAIN_SIZE||validation.length!==VALIDATE_SIZE||test.length!==TEST_SIZE||
     training.at(-1).i+2>=validation[0].i||validation.at(-1).i+2>=test[0].i)throw Error('Chronological sample isolation failed');
  const validationModel=I.fit(training);
  const baselineValidation=modelTrades(rows,validation,validationModel,THRESHOLDS[0]);
  const alternativeResults=THRESHOLDS.slice(1).map(t=>({threshold:t,result:modelTrades(rows,validation,validationModel,t)}));
  const eligible=alternativeResults.filter(x=>x.result.count>=12&&x.result.meanNetUsd>0&&
    x.result.netUsd>baselineValidation.netUsd+.25&&x.result.maxDrawdownUsd<=baselineValidation.maxDrawdownUsd&&
    x.result.unresolved<=baselineValidation.unresolved);
  eligible.sort((a,b)=>b.result.netUsd-a.result.netUsd||b.result.count-a.result.count||a.threshold-b.threshold);
  const chosen=eligible[0]?.threshold||THRESHOLDS[0];
  // Every label used to fit this final model was observable BEFORE the test.
  const testTraining=samples.slice(start-EMBARGO-TRAIN_SIZE-VALIDATE_SIZE,start-EMBARGO);
  if(testTraining.at(-1).i+2>=test[0].i)throw Error('Test training label leakage');
  const model=I.fit(testTraining);
  const baseline=modelTrades(rows,test,model,THRESHOLDS[0]);
  const selected=chosen===THRESHOLDS[0]?baseline:modelTrades(rows,test,model,chosen);
  baselineNet+=baseline.netUsd;selectedNet+=selected.netUsd;baselineTrades+=baseline.count;selectedTrades+=selected.count;
  selectedUnresolved+=selected.unresolved;positive+=Number(selected.netUsd>0);
  policyVotes.set(chosen,(policyVotes.get(chosen)||0)+1);
  for(const r of selected.byRegime){
   const x=regimes.get(r.regime)||{regime:r.regime,count:0,wins:0,netUsd:0};
   x.count+=r.count;x.wins+=r.wins;x.netUsd+=r.netUsd;regimes.set(r.regime,x);
  }
  folds.push({number:k+1,trainLastSignalAt:rows[testTraining.at(-1).i][0],
   validationFirstAt:rows[validation[0].i][0],validationLastAt:rows[validation.at(-1).i][0],
   testStartAt:rows[test[0].i][0],testEndAt:rows[test.at(-1).i][0],
   historyTrainingSignals:testTraining.length,validationSignals:validation.length,testSignals:test.length,
   chosenThreshold:chosen,validationBaselineNetUsd:baselineValidation.netUsd,
   validationChosenNetUsd:chosen===THRESHOLDS[0]?baselineValidation.netUsd:eligible[0].result.netUsd,
   baseline,selected});
 }
 const boots=bootstrapFoldNet(folds);
 const consistent=positive>=Math.ceil(.75*folds.length);
 const pnlPositive=selectedNet>0&&boots.lower5PctUsd>0;
 const sufficient=selectedTrades>=60&&selectedUnresolved<=Math.floor(selectedTrades*.2);
 const stable=policyVotes.size<=2;
 const researchPass=pnlPositive&&consistent&&sufficient&&stable;
 return {
  mode:'ADAPTIVE_WALK_FORWARD_RESEARCH',asset,liveExecutionAffected:false,
  model:'L2-regularized logistic regression retrained on past OHLCV only',
  history:{days:history?.days??null,bars:rows.length,pages:history?.pages??null,complete:history?.complete??false,
   start:rows[0][0],end:rows.at(-1)[0]},
  process:{windows:folds.length,trainSignals:TRAIN_SIZE,validationSignals:VALIDATE_SIZE,testSignals:TEST_SIZE,labelEmbargoBars:EMBARGO,
   simulator:'90 USDT notional; fixed 26bps round-trip costs; ATR stop; $0.52 modeled net TP; <=4h exit observation, unresolved positions excluded from wins',
   thresholds:THRESHOLDS},
  summary:{baselineNetUsd:round(baselineNet),adaptiveNetUsd:round(selectedNet),differenceUsd:round(selectedNet-baselineNet),
   baselineTrades,adaptiveTrades:selectedTrades,unresolved:selectedUnresolved,positiveWindows:positive,policyVotes:Object.fromEntries(policyVotes),
   sensitivity:boots,stage:researchPass?'HISTORICAL_GATE_PASSED_REQUIRES_FORWARD_TRADES':'HISTORICAL_GATE_FAILED',
   enoughHistoricalEvidence:researchPass,
   next:'Requires 60+ independent completed, strategy-tagged forward Demo trades across at least 14 days, multiple assets and positive outcomes. Never auto-promotes to funded orders.'},
  byRegime:[...regimes.values()].map(x=>({...x,netUsd:round(x.netUsd),winRatePct:x.count?round(x.wins/x.count*100,1):null})),
  folds,
  limitations:'A forward-looking real-money win rate is NOT established. Rolling 5m OHLCV does not include historical spread/depth, liquidation, order queue, fills, broker TP/SL placement or true exchange execution. Simulated 4h observation may leave positions unresolved; these never count as wins. The model predicts next-10m direction, which does not match a 4h barrier exactly. Validation and test periods are time-separated with an outcome embargo, but repeated strategy testing can still overfit. Neither parameter selection nor this report modifies Demo or Real trading.'
 };
}
module.exports={evaluateAdaptive,modelTrades,bootstrapFoldNet,THRESHOLDS};
