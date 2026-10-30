'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const guard=require('../static/demo-seconds-guard');
const now=Date.UTC(2026,9,30,15,0,0);
function history(rangeBps){
 const first=100,last=first*(1+rangeBps/10000);
 return Array.from({length:61},(_,i)=>({s:Math.floor(now/1000)-60+i,mid:first+(last-first)*i/60}));
}
function signal(needed=70){
 return {symbol:'BTCUSDT',state:'WATCH',side:'BUY',score:90,requiredMoveBps:needed,spreadBps:1.2,roundTripImpactBps:2,reasons:[]};
}
test('range that covers only a fraction of the modeled net target cannot open',()=>{
 const s=guard.filter(signal(70),history(30),now);
 assert.equal(s.state,'WAIT');
 assert.equal(s.side,null);
 assert.ok(s.reasons.some(x=>x.includes('70.0 bp')));
});
test('full-target feasibility clears this guard only; it does not predict winning',()=>{
 const s=guard.filter(signal(70),history(90),now);
 assert.equal(s.state,'WATCH');
 assert.equal(s.feasibilityThresholdBps,70);
 assert.match(s.meaning,/not a forward forecast/);
});
test('missing net-target economics vetoes the entry',()=>{
 const s=guard.filter(signal(undefined),history(90),now);
 // The fallback param above defaults to 70; explicitly remove the field.
 const missing=signal();delete missing.requiredMoveBps;
 const out=guard.filter(missing,history(90),now);
 assert.equal(out.state,'WAIT');
 assert.match(out.reason,/Cannot establish/);
});
test('wide spread veto remains in force even on volatile pairs',()=>{
 const s=signal(70);s.spreadBps=4;
 const out=guard.filter(s,history(150),now);
 assert.equal(out.state,'WAIT');
 assert.match(out.reasons.join(' '),/Spread too high/);
});
