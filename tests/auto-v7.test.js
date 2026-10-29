'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../lib/paper-engine'),S=require('../lib/market-signals');
const P=(side='BUY',atr=.003,notional=250)=>E.open(E.initial(),{XRP:1},{symbol:'XRP',side,notional,auto:true,atr});
const quote=(a,price,atr=.003,reversal=false)=>E.applyQuote(a,{XRP:price},Date.now(),{XRP:{atr,reversal}});
test('dynamic markets allowed; no fixed-dollar profit goal saved',()=>{const a=P();assert.equal(a.positions[0].symbol,'XRP');assert.equal(a.positions[0].auto,true);assert.equal('profitGoal' in a.positions[0],false);});
test('no automatic $1 exit: trend can continue beyond that amount',()=>{let a=P();a=quote(a,1.012);const net=E.markPnl(a.positions[0],1.012)-a.positions[0].entryFee-a.positions[0].qty*1.012*E.FEE_RATE;assert.ok(net>1);assert.equal(a.positions.length,1);assert.ok(a.positions[0].autoTrailArmed);});
test('adaptive long trailing exit locks net profit on pullback',()=>{let a=P();a=quote(a,1.02);const stop=a.positions[0].stop;assert.ok(stop>1);a=quote(a,1.016);assert.equal(a.positions.length,0);assert.ok(a.closed[0].net>0);assert.match(a.closed[0].reason,/Adaptive profit trail/);});
test('adaptive short trailing exit locks net profit on rebound',()=>{let a=P('SELL');a=quote(a,.98);assert.ok(a.positions[0].stop<1);a=quote(a,.984);assert.equal(a.positions.length,0);assert.ok(a.closed[0].net>0);});
test('auto trades do not close at legacy manual 3% target',()=>{let a=P();a=quote(a,1.04);assert.equal(a.positions.length,1);});
test('legacy auto positions with profitGoal are not closed at $1',()=>{let a=P();a.positions[0].profitGoal=1;a=quote(a,1.01);assert.equal(a.positions.length,1);});
test('profitable reversal can close armed auto trade',()=>{let a=P();a=quote(a,1.015);a=quote(a,1.016,.003,true);assert.equal(a.positions.length,0);assert.match(a.closed[0].reason,/reversal/);});
test('auto loss stop remains enforced',()=>{let a=P('SELL');a=quote(a,1.02);assert.equal(a.positions.length,0);assert.ok(a.closed[0].net<0);});
test('manual target remains independent of auto exit system',()=>{let a=E.open(E.initial(),{XRP:1},{symbol:'XRP',side:'BUY',notional:250});a=E.applyQuote(a,{XRP:1.04});assert.equal(a.positions.length,0);assert.equal(a.closed[0].reason,'Target simulated');});
test('invalid arbitrary market rejected',()=>{assert.throws(()=>E.entryPreview(E.initial(),{'../../':1},{symbol:'../../',side:'BUY',notional:250}));});
test('ATR indicator calculates real candle ranges and rejects insufficient history',()=>{const rows=Array.from({length:40},(_,i)=>[i*300000,100+i*.1,101+i*.1,99+i*.1,100+i*.1,1000]);assert.ok(S.atr(rows)>0);assert.ok(Number.isNaN(S.atr(rows.slice(0,5))));});
test('stale or unclosed candle history never permits entry',()=>{const now=Date.now(),rows=Array.from({length:70},(_,i)=>[now-70*300000+i*300000,100,101,99,100,100]);assert.equal(S.entrySetup(rows,'BUY',now),null);});
test('per-candle entry key is stable across scanner cycles, without a timed cooldown',()=>{const setup={barTime:300000};assert.equal(S.candleKey(setup,'XRP','BUY'),S.candleKey(setup,'XRP','BUY'));assert.notEqual(S.candleKey(setup,'XRP','BUY'),S.candleKey({barTime:600000},'XRP','BUY'));});
test('minimum $10 notional applies to auto trades',()=>{assert.throws(()=>E.open(E.initial(),{XRP:1},{symbol:'XRP',side:'BUY',notional:9.99,auto:true,atr:.003}),/at least \$10/);});
test('fresh historical uptrend can create a long candidate and not a short',()=>{
 const now=Date.now(),rows=[];
 for(let i=0;i<90;i++){const o=100*(1+0.0013*i),c=o*1.001;rows.push([now-(90-i)*300000,o,c*1.0008,o*.9992,c,1000+(i%5)*125]);}
 const long=S.entrySetup(rows,'BUY',now);
 assert.ok(long&&long.atr>0&&long.trend>0);assert.equal(S.entrySetup(rows,'SELL',now),null);
});
test('ATR profit trail never loosens an already tightened protective stop',()=>{
 let a=P();a=quote(a,1.02,.003);const before=a.positions[0].stop;a=quote(a,1.019,.1);
 assert.ok(a.positions[0].stop>=before);
});
