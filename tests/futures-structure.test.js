'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyzeStructure}=require('../lib/futures-structure');
const {NOW,evidence}=require('./fixtures/advanced-evidence');
const FIVE=300000,QUARTER=900000;
function rows(count,period,price=100){return Array.from({length:count},(_,i)=>[Math.floor(NOW/period)*period-(count-i)*period,price,price+.1,price-.1,price,1000])}
function fixture(level=104){
 const five=rows(48,FIVE),quarter=rows(30,QUARTER);
 quarter[8][2]=level;quarter[16][2]=level;
 return {five,quarter,side:'BUY',now:NOW,entry:100,atr:1,stopPct:.5,costRate:.002,targetNet:1.05,notional:100};
}
function mirror(x){
 const flip=bars=>bars.map(r=>[r[0],200-r[1],200-r[3],200-r[2],200-r[4],r[5]]);
 return {...x,five:flip(x.five),quarter:flip(x.quarter),entry:200-x.entry,side:'SELL'};
}
const passing=x=>x.ready&&x.checks.every(c=>c.pass);
function tail(x,offset,open,high,low,close,volume=1000){x.five.at(offset).splice(1,5,open,high,low,close,volume)}
test('continuation leaves adequate cost-adjusted room to repeated resistance or support',()=>{
 const x=fixture();
 for(const input of [x,mirror(x)]){
  const result=analyzeStructure(input);
  assert.equal(passing(result),true,JSON.stringify(result));assert.equal(result.setup,'CONTINUATION');
  assert.equal(result.metrics.opposingLevelTests,2);assert.ok(result.metrics.netHeadroomUsd>input.targetNet);
  assert.ok(result.metrics.headroomRiskRatio>1.1);
 }
});
test('entering just before repeatedly tested overhead resistance or underlying support is blocked',()=>{
 const x=fixture(101);
 for(const input of [x,mirror(x)]){
  const result=analyzeStructure(input);assert.equal(result.ready,true);assert.equal(passing(result),false);
  assert.equal(result.setup,'CONGESTED');assert.match(result.reason,/net room/);
  assert.ok(result.metrics.netHeadroomUsd<input.targetNet);
 }
});
test('a lone historical high is not automatically treated as an impassable ceiling',()=>{
 const x=fixture(101);x.quarter[16][2]=100.1;
 for(const input of [x,mirror(x)]){
  const result=analyzeStructure(input);assert.equal(passing(result),true);assert.equal(result.metrics.repeatedLevels,0);
 }
});
test('a fresh long rejection wick or mirrored short rejection fails at an already confirmed pivot',()=>{
 const x=fixture(102);tail(x,-1,100.6,102.3,100.4,100.55);x.entry=100.55;
 for(const input of [x,mirror(x)]){
  const result=analyzeStructure(input);assert.equal(result.ready,true);assert.equal(result.setup,'REJECTION');
  assert.equal(result.checks[0].pass,false);assert.match(result.reason,/rejected/);
 }
});
test('clearing a tested level requires a directional completed close and a volume expansion',()=>{
 const x=fixture(102);tail(x,-1,100,102.5,99.9,102.4,1500);x.entry=102.4;
 for(const input of [x,mirror(x)]){
  const result=analyzeStructure(input);assert.equal(passing(result),true,JSON.stringify(result));
  assert.equal(result.setup,'CONFIRMED_BREAKOUT');assert.ok(result.metrics.breakoutLevel);
 }
 const weak=structuredClone(x);weak.five.at(-1)[5]=1000;
 for(const input of [weak,mirror(weak)]){
  const result=analyzeStructure(input);assert.equal(passing(result),false);assert.equal(result.setup,'UNCONFIRMED_BREAKOUT');
  assert.equal(result.checks[1].pass,false);
 }
});
test('a breakout and completed retest that holds the old level remains eligible',()=>{
 const x=fixture(102);
 tail(x,-4,100,101.8,99.9,101.7);
 tail(x,-3,101.7,102.5,101.6,102.4,1500);
 tail(x,-2,102.4,102.45,101.95,102.3,900);
 tail(x,-1,102.3,102.6,102.2,102.5);x.entry=102.5;
 for(const input of [x,mirror(x)]){
  const result=analyzeStructure(input);assert.equal(passing(result),true,JSON.stringify(result));
  assert.equal(result.setup,'BREAKOUT_RETEST');
 }
});
test('an uncompleted quote crossing cannot replace completed breakout evidence',()=>{
 const x=fixture(101);tail(x,-1,100,100.95,99.9,100.8);x.entry=101.2;
 for(const input of [x,mirror(x)]){
  const result=analyzeStructure(input);assert.equal(passing(result),false);
  assert.equal(result.setup,'CONGESTED');assert.equal(result.metrics.distanceAtr,0);
 }
});
test('an old breakout that subsequently failed does not excuse a weak new crossing',()=>{
 const x=fixture(102);
 tail(x,-5,100,102.5,99.9,102.4,1500);
 tail(x,-4,102.4,102.5,101.95,102.3);
 tail(x,-3,102.3,102.4,101.3,101.4);
 tail(x,-2,101.4,102.5,101.3,102.4);tail(x,-1,102.4,102.6,102.3,102.5);x.entry=102.5;
 for(const input of [x,mirror(x)])assert.equal(analyzeStructure(input).checks[1].pass,false);
});
test('pivots need two later completed confirmation bars; partial and future OHLCV cannot leak in',()=>{
 const x=fixture(104),before=analyzeStructure(x),fiveStart=Math.floor(NOW/FIVE)*FIVE,quarterStart=Math.floor(NOW/QUARTER)*QUARTER;
 x.five.push([fiveStart,100,1e7,.001,1e6,1e10],[fiveStart+FIVE,100,1e7,.001,1e6,1e10]);
 x.quarter.push([quarterStart,100,1e7,.001,1e6,1e10]);
 assert.deepEqual(analyzeStructure(x),before);
 const unconfirmed=fixture(104);unconfirmed.quarter[8][2]=100.1;unconfirmed.quarter[16][2]=100.1;unconfirmed.quarter.at(-1)[2]=101;
 const result=analyzeStructure(unconfirmed);assert.equal(result.metrics.repeatedLevels,0);assert.equal(passing(result),true);
});
test('stale, gapped, malformed and insufficient series or invalid execution plans fail closed',()=>{
 for(const mutate of [x=>x.five.splice(20,1),x=>x.quarter.reverse(),x=>x.five.at(-1)[2]=99,x=>x.quarter[5][5]=-1,x=>x.five[5][0]++,x=>x.five.splice(0,30),x=>{x.now+=4*QUARTER},x=>x.costRate=NaN,x=>x.entry=0,x=>x.atr=0,x=>x.side='LONG']){
  const x=fixture();mutate(x);const result=analyzeStructure(x);assert.equal(result.ready,false);assert.equal(result.setup,'UNAVAILABLE');assert.ok(result.checks.some(c=>!c.pass));
 }
});
test('inputs remain unchanged and all returned metrics preserve JSON finite values',()=>{
 const x=fixture(),copy=structuredClone(x),result=analyzeStructure(x);
 assert.deepEqual(x,copy);assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
});
test('repository artificial qualifying market remains compatible with structure risk checks',()=>{
 const e=evidence(),{decide}=require('../lib/advanced-decision'),plan=decide(e,{mode:'demo',now:NOW});
 const result=analyzeStructure({...e,side:plan.side,now:NOW,entry:plan.executionPrice,atr:plan.atr,stopPct:plan.stopPct,costRate:plan.metrics.estimatedRoundTripCostUsd/100,targetNet:plan.targetNet,notional:100});
 assert.equal(passing(result),true,JSON.stringify(result));
});
