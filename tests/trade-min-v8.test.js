const test=require('node:test'),assert=require('node:assert/strict');
const demo=require('../lib/paper-engine'),real=require('../lib/trade-limits');
test('demo minimum order is exactly $10 notional',()=>{const s=demo.open(demo.initial(),{XRP:1},{symbol:'XRP',side:'BUY',notional:10});assert.equal(s.positions[0].notional,10);assert.equal(s.cash,9999.994);});
test('demo cannot open $9.99 or invalid value',()=>{for(const notional of [9.99,0,-1,NaN,Infinity])assert.throws(()=>demo.entryPreview(demo.initial(),{XRP:1},{symbol:'XRP',side:'BUY',notional}),/at least|at least|20%/);});
test('minimum also applies to automatically entered virtual positions',()=>{assert.throws(()=>demo.open(demo.initial(),{XRP:1},{symbol:'XRP',side:'BUY',notional:8,auto:true,profitGoal:1}),/\$10/);});
test('future live policy minimum $10, exchange can require more',()=>{assert.equal(real.validateNotional(10).minimumUsd,10);assert.equal(real.orderMinimum(15),15);assert.throws(()=>real.validateNotional(10,15),/\$15/);assert.throws(()=>real.validateNotional(9.99),/\$10/);});
test('funded order helper cannot place or sign broker orders',()=>{assert.equal(typeof real.placeOrder,'undefined');assert.equal(typeof demo.submitLiveOrder,'undefined');});
