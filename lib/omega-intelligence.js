'use strict';
// OMEGA v4 — interpretable historical logistic classifier + strictly held-out simulation.
// Predicts two-bar direction, NOT trade success. No probability-of-profit promises.
const cryptoQuant=require('./quant-engine');
const PERIOD=300000;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const round=(v,d=2)=>Number(v.toFixed(d));
const mean=a=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sigmoid=x=>1/(1+Math.exp(-clamp(x,-24,24)));
function assertCandles(rows){cryptoQuant.validateCandles(rows,230);for(let i=1;i<rows.length;i++)if(rows[i][0]-rows[i-1][0]>PERIOD*900)throw Error('Historical price data has a substantial gap');return rows;}
function vector(rows,i){const from=Math.max(0,i-70),slice=rows.slice(from,i+1),close=slice.map(x=>x[4]),price=close.at(-1),e8=cryptoQuant.ema(close,8),e21=cryptoQuant.ema(close,21),e55=cryptoQuant.ema(close,55),a=cryptoQuant.atr(slice),r=cryptoQuant.rsi(close),v=rows[i][5],prevVol=mean(rows.slice(Math.max(0,i-20),i).map(x=>x[5]));if(!e55||!a||!Number.isFinite(r))throw Error('Insufficient features');const gap=(e8-e21)/a;return [clamp(gap,-3,3),clamp((e21-e55)/a,-3,3),clamp((r-50)/30,-2,2),clamp((price/close.at(-4)-1)*100,-2,2),clamp((price/close.at(-13)-1)*100,-3,3),clamp((rows[i][4]-rows[i][1])/a,-2,2),clamp(a/price*100,0,5),clamp(prevVol>0?v/prevVol-1:0,-2,3)];}
function label(rows,i){const entry=rows[i+1][1],exit=rows[i+2][4];return exit>entry?1:0;}
function fit(samples){if(samples.length<80)throw Error('Insufficient training examples');const n=samples[0].x.length,means=Array.from({length:n},(_,j)=>mean(samples.map(s=>s.x[j]))),std=Array.from({length:n},(_,j)=>Math.sqrt(mean(samples.map(s=>(s.x[j]-means[j])**2)))||1);const weights=Array(n+1).fill(0);for(let epoch=0;epoch<220;epoch++){const g=Array(n+1).fill(0);for(const {x,y} of samples){const z=weights[0]+x.reduce((a,v,j)=>a+weights[j+1]*(v-means[j])/std[j],0),err=sigmoid(z)-y;g[0]+=err;x.forEach((v,j)=>g[j+1]+=err*(v-means[j])/std[j]);}let step=0.22/(1+epoch*.008);weights[0]-=step*g[0]/samples.length;for(let j=1;j<weights.length;j++)weights[j]-=step*(g[j]/samples.length+.03*weights[j]);}return {weights,means,std};}
function infer(model,x){return sigmoid(model.weights[0]+x.reduce((a,v,j)=>a+model.weights[j+1]*(v-model.means[j])/model.std[j],0));}
function trade(rows,i,pUp,{asset,equity,riskPct,spreadBps,extraCostBps}={}){
 const dir=pUp>=.67?1:pUp<=.33?-1:0;if(!dir)return null;
 const entry=rows[i+1][1],vol=cryptoQuant.atr(rows.slice(Math.max(0,i-70),i+1)),stopDist=Math.max(vol*1.55,entry*.00025);
 // Stop exposure risk <= 0.25% of simulated current equity. Total notional <=20% of balance.
 const size=Math.min(equity*clamp(riskPct,.05,.25)/100/stopDist,equity*.2/entry),notional=size*entry;
 if(!Number.isFinite(size)||size<=0)return null;
 let exit=rows[i+2][4],reason='10m exit',stop=entry-dir*stopDist;
 for(let j=i+1;j<=i+2;j++){const bar=rows[j];if((dir===1&&bar[3]<=stop)||(dir===-1&&bar[2]>=stop)){exit=dir===1?Math.min(stop,bar[1]):Math.max(stop,bar[1]);reason='protective stop (simulated)';break;}}
 const quotePnL=dir*(exit-entry)*size;const usdConversion=asset==='USD_JPY'?Math.max(exit,1):1;const gross=quotePnL/usdConversion;
 const estimatedCosts=notional*(Math.max(0,spreadBps)+Math.max(0,extraCostBps))/10000;
 return {pnl:gross-estimatedCosts,reason,dir,entry,exit,notional,riskStopUsd:round(size*stopDist/usdConversion,4)};
}
function analyze(rows,{asset='BTC',market='futures',equity=10000,riskPct=.25,dailyRiskPct=2,spreadBps,extraCostBps}={}){
 assertCandles(rows);if(!Number.isFinite(equity)||equity<100||equity>1000000)throw Error('Invalid simulated equity');if(!Number.isFinite(riskPct)||riskPct<.05||riskPct>.25)throw Error('Per-trade risk must be 0.05%–0.25%');if(!Number.isFinite(dailyRiskPct)||dailyRiskPct<.5||dailyRiskPct>5)throw Error('Daily loss budget must be 0.5%–5%');
 const costs={spreadBps:spreadBps??(market==='forex'?asset==='USD_JPY'?1.7:1.2:1.5),extraCostBps:extraCostBps??(market==='forex'?1:20)};
 const pairs=[];for(let i=70;i<rows.length-2;i++){if(rows[i+1][0]-rows[i][0]!==PERIOD||rows[i+2][0]-rows[i+1][0]!==PERIOD)continue;pairs.push({i,x:vector(rows,i),y:label(rows,i)});}
 const cutoff=Math.floor(pairs.length*.60);const train=pairs.slice(0,cutoff),test=pairs.slice(cutoff);const heldoutModel=fit(train);
 let equityNow=equity,peak=equity,wins=0,losses=0,maxDD=0,targetHits=0;let count=0;const outcomes=[];let brier=0,guesses=0;const bins=Array.from({length:5},()=>({n:0,success:0}));
 for(let k=0;k<test.length;k++){
  const s=test[k],p=infer(heldoutModel,s.x),idx=clamp(Math.floor(p*5),0,4);bins[idx].n++;bins[idx].success+=s.y;brier+=(p-s.y)**2;guesses++;
  if(outcomes.length&&s.i<=outcomes.at(-1).i+2)continue;
  const t=trade(rows,s.i,p,{asset,equity:equityNow,riskPct,...costs});if(!t)continue;
  equityNow+=t.pnl;peak=Math.max(peak,equityNow);maxDD=Math.max(maxDD,(peak-equityNow)/peak*100);wins+=t.pnl>0?1:0;losses+=t.pnl<=0?1:0;count++;if(t.pnl>=1)targetHits++;outcomes.push({i:s.i,time:rows[s.i+2][0],pnl:round(t.pnl),direction:t.dir===1?'BUY':'SELL',reason:t.reason});
  // Conservative non-overlapping evaluation: skip signals whose holding windows overlap.
 }
 const finalModel=fit(pairs),last=rows.length-1,lastP=infer(finalModel,vector(rows,last));const f=cryptoQuant.features(rows.slice(-90));const age=Date.now()-(rows.at(-1)[0]+PERIOD);
 const weekend=market==='forex'&&((new Date().getUTCDay()===6)||(new Date().getUTCDay()===0&&new Date().getUTCHours()<21)||(new Date().getUTCDay()===5&&new Date().getUTCHours()>=21));
 const blocks=[];if(weekend)blocks.push('Forex market is closed over the weekend');if(age>PERIOD*3)blocks.push('Live 5-minute candle feed is stale');if(age<-(PERIOD+60000))blocks.push('Data clock is inconsistent');if(f.adx<17)blocks.push('Market is ranging: trend edge uncertain');if(f.atrPct>1.8)blocks.push('Volatility above safe research threshold');if(count<30)blocks.push('Too few independent test trades to evaluate strategy');
 const actualWin=count?wins/count*100:null;
 if(count>=30&&actualWin<55)blocks.push('Held-out strategy results do not support live entry');
 const side=lastP>=.67?'BUY':lastP<=.33?'SELL':'WAIT';if(side==='WAIT')blocks.push('Model does not show a sufficiently strong directional signal');
 const t=trade(rows,last-2,lastP,{asset,equity,riskPct,...costs}); // purely indicative size math, never an order
 return {market,asset,decision:blocks.length?'WAIT':side,modelDirection:side,modelUpEstimatePct:round(lastP*100,1),scoreMeaning:'Uncalibrated logistic-model estimate of next 10-minute UP direction, NOT the probability of profitable trading',regime:f.adx>=25?'TREND':'RANGE / TRANSITION',indicators:{rsi:round(f.rsi,1),adx:round(f.adx,1),atrPct:round(f.atrPct,3),ema21:round(f.ema21,5)},currentPrice:rows.at(-1)[4],timestamp:Date.now(),lastClosedBar:rows.at(-1)[0],blockers:blocks,tradeRiskPct:riskPct,dailyRiskBudgetPct:dailyRiskPct,maxAggregateRiskPct:Math.min(5,dailyRiskPct),modelType:'L2 regularized logistic regression · lagged OHLCV · chronological split',evaluation:{type:'Chronological held-out segment (not repeated walk-forward)',trainingExamples:train.length,testExamples:test.length,tradeCount:count,wins,losses,winRatePct:actualWin===null?null:round(actualWin,1),modelBrier:guesses?round(brier/guesses,4):null,netPnl:round(equityNow-equity),maxDrawdownPct:round(maxDD,2),targetHits,assumedRoundTripBps:round(costs.spreadBps+costs.extraCostBps,2),recent:outcomes.slice(-7).reverse(),warning:'Illustrative historical simulation only. Single chronological held-out segment; no realistic liquidity, partial fills, dynamic spread, latency, swap/funding or gap guarantee. Performance can fail in new market regimes.'},riskPreview:{estimatedNotional:round(t?.notional||0),estimatedStopRisk:round(t?.riskStopUsd||0),dailyBudgetUsd:round(equity*dailyRiskPct/100)},feed:{candles:rows.length,start:rows[0][0],end:rows.at(-1)[0]},orders:'DISABLED; research endpoint never sends orders'};
}
module.exports={analyze,fit,infer,vector,trade,assertCandles};
