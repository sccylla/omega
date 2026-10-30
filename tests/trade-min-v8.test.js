const test=require('node:test'),assert=require('node:assert/strict');
const demo=require('../lib/paper-engine'),real=require('../lib/trade-limits');
test('demo minimum order is exactly $100 notional',()=>{const s=demo.open(demo.initial(),{XRP:1},{symbol:'XRP',side:'BUY',notional:100});assert.equal(s.positions[0].notional,100);assert.equal(s.cash,99.94);});
test('demo cannot open $99.99 or invalid value',()=>{for(const notional of [99.99,0,-1,NaN,Infinity])assert.throws(()=>demo.entryPreview(demo.initial(),{XRP:1},{symbol:'XRP',side:'BUY',notional}),/at least|at least|20%/);});
test('minimum also applies to automatically entered virtual positions',()=>{assert.throws(()=>demo.open(demo.initial(),{XRP:1},{symbol:'XRP',side:'BUY',notional:8,auto:true,profitGoal:1}),/\$100/);});
test('future live policy minimum $90, exchange can require more',()=>{assert.equal(real.validateNotional(90).minimumUsd,90);assert.equal(real.orderMinimum(95),95);assert.throws(()=>real.validateNotional(90,95),/\$95/);assert.throws(()=>real.validateNotional(89.99),/\$90/);});
test('funded order helper cannot place or sign broker orders',()=>{assert.equal(typeof real.placeOrder,'undefined');assert.equal(typeof demo.submitLiveOrder,'undefined');});
