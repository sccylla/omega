'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{concentrated}=require('../static/portfolio-risk'),E=require('../lib/paper-engine');
const held=(side,correlation)=>({side,entryEvidence:{benchmarkCorrelation:correlation}});
test('concentration compares signed BTC exposure rather than trade-side labels',()=>{
 assert.equal(concentrated('SELL',-.9,[held('BUY',.9)]),true);
 assert.equal(concentrated('BUY',-.9,[held('BUY',.9)]),false);
 assert.equal(concentrated('SELL',.9,[held('BUY',.9)]),false);
 assert.equal(concentrated('BUY',.9,[held('BUY',.9)]),true);
});
test('unknown held or candidate correlation blocks an additional position',()=>{
 assert.equal(concentrated('BUY',null,[held('BUY',.8)]),true);
 assert.equal(concentrated('BUY',.9,[{side:'SELL'}]),true);
 assert.equal(concentrated('BUY',null,[]),false);
});
test('elapsed time never closes evidence positions, including saved legacy timer metadata',()=>{
 const start=Date.now(),ticket={symbol:'XRP',side:'BUY',notional:10,auto:true,targetNet:1,maximumHoldMinutes:30,entryEvidence:{strategy:'evidence-v11'}};
 for(const price of [1.001,.999]){
  let a=E.open(E.initial(),{XRP:1},ticket,start);
  a=E.applyQuote(a,{XRP:price},start+29*60000);assert.equal(a.positions.length,1);
  a.positions[0].maximumHoldMinutes=30;
  a=E.applyQuote(a,{XRP:price},start+24*60*60000);assert.equal(a.positions.length,1);assert.equal(a.closed.length,0);
  a=E.applyQuote(a,{XRP:1.2},start+25*60*60000);assert.equal(a.positions.length,0);assert.match(a.closed[0].reason,/profit target/);
 }
});
test('evidence policy uses its target/stop rule rather than a legacy adaptive exit',()=>{
 const start=Date.now();let a=E.open(E.initial(),{XRP:1},{symbol:'XRP',side:'BUY',notional:10,auto:true,atr:.003,targetNet:1,maximumHoldMinutes:30,entryEvidence:{strategy:'evidence-v11'}},start);
 a=E.applyQuote(a,{XRP:1.02},start+1000,{XRP:{atr:.003}});assert.equal(a.positions[0].autoTrailArmed,false);
 a=E.applyQuote(a,{XRP:1.01},start+2000,{XRP:{atr:.003,reversal:true}});assert.equal(a.positions.length,1);
});
