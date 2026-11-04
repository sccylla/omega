'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyzeMovement}=require('../lib/market-movement');
const {NOW,evidence}=require('./fixtures/advanced-evidence');
const PERIOD=300000;
function series(moves=Array(60).fill(.001),{now=NOW,period=PERIOD}={}){
 let previous=100;
 return moves.map((move,i)=>{const open=previous,close=open*Math.exp(move);previous=close;return [Math.floor(now/period)*period-(moves.length-i)*period,open,Math.max(open,close)*1.0003,Math.min(open,close)*.9997,close,1000]});
}
const analyze=(rows,side='BUY',options={})=>analyzeMovement(rows,{side,now:NOW,...options});
const passing=result=>result.ready&&result.checks.every(x=>x.pass);
test('coherent rising and falling completed movement confirms only its own direction',()=>{
 for(const [side,move]of [['BUY',.001],['SELL',-.001]]){
  const result=analyze(series(Array(60).fill(move)),side);
  assert.equal(passing(result),true);assert.equal(result.regime,'DIRECTIONAL');
  assert.ok(result.metrics.efficiency>.999);
  assert.equal(passing(analyze(series(Array(60).fill(move)),side==='BUY'?'SELL':'BUY')),false);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
 }
});
test('a repeated whipsaw fails the movement filter despite frequent price changes',()=>{
 const result=analyze(series(Array.from({length:60},(_,i)=>i%2?.003:-.003)));
 assert.equal(result.ready,true);assert.equal(passing(result),false);
 assert.ok(result.metrics.efficiency<.01);
 assert.equal(result.regime,'CHOP');
 assert.equal(result.checks[0].pass,false);
});
test('a sudden oversized completed candle is identified relative to the preceding baseline',()=>{
 const rows=series();rows.at(-1)[2]*=1.025;
 const result=analyze(rows);
 assert.equal(result.regime,'VOLATILITY_SHOCK');
 assert.equal(result.checks.find(x=>x.label.includes('volatility')).pass,false);
 assert.ok(result.metrics.spikeRatio>4);
});
test('a material recent reversal blocks entry even while the 12-bar net remains positive',()=>{
 const moves=Array(60).fill(.0015);moves.splice(-3,3,-.002,-.002,-.002);
 const result=analyze(series(moves));
 assert.ok(result.metrics.net12Bps>0);
 assert.ok(result.metrics.momentum3Bps<0);
 assert.equal(result.regime,'REVERSAL');assert.equal(result.checks[1].pass,false);
});
test('deceleration is reported as context without inventing a reversal',()=>{
 const moves=Array(60).fill(.001);moves.splice(-3,3,.0002,.0002,.0002);
 const result=analyze(series(moves));
 assert.equal(result.regime,'DECELERATING');assert.equal(passing(result),true);
 assert.match(result.checks[1].detail,/slowing/);
});
test('uncompleted and future prices cannot change an analysis evaluated as of now',()=>{
 const rows=series(),before=analyze(rows),t=Math.floor(NOW/PERIOD)*PERIOD;
 rows.push([t,100,1e6,.001,1e5,1e12],[t+PERIOD,1e6,1e7,.001,1e6,1e12]);
 assert.deepEqual(analyze(rows),before);
 const historical=series(Array(60).fill(.001),{now:NOW-6*PERIOD});
 const result=analyze(historical,'BUY',{now:NOW-6*PERIOD});
 historical.push(...rows.filter(r=>r[0]+PERIOD>NOW-6*PERIOD));
 assert.deepEqual(analyze(historical,'BUY',{now:NOW-6*PERIOD}),result);
});
test('stale, insufficient, gapped, duplicated and malformed completed observations are unavailable',()=>{
 const cases=[[],series().slice(-20),series(Array(60).fill(.001),{now:NOW-2*PERIOD})];
 for(const mutate of [r=>r.splice(15,1),r=>r.reverse(),r=>r[20][0]=r[19][0],r=>r[25][2]=r[25][3],r=>r[25][4]=NaN,r=>r[25][5]=-1,r=>r[25][0]++]){
  const r=series();mutate(r);cases.push(r);
 }
 for(const rows of cases){const result=analyze(rows);assert.equal(result.ready,false);assert.equal(result.regime,'UNAVAILABLE');assert.ok(result.checks.some(c=>!c.pass));}
 assert.equal(analyzeMovement(series(),{side:'LONG',now:NOW}).ready,false);
 assert.equal(analyzeMovement(series(),{side:'BUY',now:NOW,period:0}).ready,false);
});
test('range and volume baselines never fabricate infinite ratios from flat or zero-volume data',()=>{
 const rows=series(Array(60).fill(0));for(const row of rows){row[2]=row[3]=row[4];row[5]=0}
 const result=analyze(rows);
 assert.equal(result.ready,true);assert.equal(passing(result),false);
 assert.equal(result.metrics.volatilityRatio,null);assert.equal(result.metrics.spikeRatio,null);assert.equal(result.metrics.volumeRatio,null);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
});
test('repository synthetic qualifying fixture remains compatible with the added movement checks',()=>{
 const result=analyze(evidence().five);
 assert.equal(passing(result),true,JSON.stringify(result));
});
test('extreme finite numbers fail safely if movement calculations overflow',()=>{
 const rows=series();rows.at(-2).splice(1,4,1e-308,1e-308,1e-308,1e-308);
 const result=analyze(rows);assert.equal(result.ready,false);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
});
test('the supplied candle period controls completion, freshness and timestamps',()=>{
 const period=60000,rows=series(Array(60).fill(-.001),{period});
 const result=analyze(rows,'SELL',{period});
 assert.equal(passing(result),true);assert.equal(result.metrics.period,period);
 assert.equal(result.metrics.lastClosedAt,Math.floor(NOW/period)*period);
});
