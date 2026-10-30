'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const guard=require('../static/demo-seconds-guard');
const now=Date.UTC(2026,9,30,15,0,0);
function history(rangeBps){
 const first=100,last=first*(1+rangeBps/10000);
 return Array.from({length:61},(_,i)=>({s:Math.floor(now/1000)-60+i,mid:first+(last-first)*i/60}));
}
function signal(needed=70){
 return {symbol:'BTCUSDT',state:'WATCH',side:'BUY',score:90,requiredMoveBps:needed,spreadBps:1.2,roundTripImpactBps:2,reasons:[]};
}
test('genuinely low volatility blocks a seconds scalp',()=>{
 const s=guard.filter(signal(70),history(10),now);
 assert.equal(s.state,'WAIT');
 assert.equal(s.side,null);
 assert.ok(s.reasons.some(x=>x.includes('Observed 60s range')));
});
test('past movement below future net target is NOT an absolute blocker',()=>{
 const s=guard.filter(signal(70),history(30),now);
 assert.equal(s.state,'WATCH');
 assert.ok(s.feasibilityThresholdBps>18&&s.feasibilityThresholdBps<70);
 assert.match(s.meaning,/not a forecast/);
});
test('missing or invalid cost economics vetoes entries',()=>{
 for(const value of [undefined,NaN,0,-5,Infinity]){
  const s=signal();s.requiredMoveBps=value;
  const out=guard.filter(s,history(90),now);
  assert.equal(out.state,'WAIT');
  assert.match(out.reason,/Cannot establish/);
 }
});
test('wide spread and book impact still block volatile pair entries',()=>{
 const s=signal(70);s.spreadBps=4;
 const out=guard.filter(s,history(150),now);
 assert.equal(out.state,'WAIT');
 assert.match(out.reasons.join(' '),/Spread too high/);
 const impact=signal(70);impact.roundTripImpactBps=12;
 assert.equal(guard.filter(impact,history(150),now).state,'WAIT');
});
