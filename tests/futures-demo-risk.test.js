'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Paper=require('../static/paper-engine');
const NOW=Date.UTC(2026,10,4,12);
const state=(cash=1500)=>({...Paper.initial(),cash,day:'2026-11-04',dayStartEquity:1500});
const ticket=(side='BUY',extra={})=>({symbol:'BTC',side,notional:100,stopPct:.4,auto:true,targetNet:5,
 entryEvidence:{strategy:'evidence-v11'},...extra});
test('automatic Demo cannot reserve a full new risk budget after almost all daily allowance was lost',()=>{
 for(const side of ['BUY','SELL']){
  assert.throws(()=>Paper.open(state(1470.5),{BTC:100},ticket(side,{slippageBps:5}),NOW),/Remaining daily Demo loss allowance/);
  const funded=Paper.open(state(1471),{BTC:100},ticket(side,{slippageBps:5}),NOW);
  assert.equal(funded.positions.length,1);
  const settled=Paper.applyQuote(funded,{BTC:funded.positions[0].stop},NOW+1000);
  assert.equal(settled.positions.length,0);assert.ok(settled.cash>=1470);
 }
});
test('existing stop liquidation and the next entry share one remaining daily allowance',()=>{
 let account=Paper.open(state(),{ETH:100},ticket('BUY',{symbol:'ETH',stopPct:1}),NOW-1000);
 account={...account,cash:1471.6};
 // Existing entry fee was already taken from cash. Remaining stop delta is
 // -1.0594; new entry + stop costs are -.51976, leaving 1470.02084.
 const allowed=Paper.open(account,{BTC:100},ticket(),NOW);
 assert.equal(allowed.positions.length,2);
 const stopped=Paper.applyQuote(allowed,{ETH:99,BTC:99.6},NOW+1000);
 assert.ok(Math.abs(stopped.cash-1470.02084)<1e-8);
 assert.throws(()=>Paper.open({...account,cash:1471.57},{BTC:100},ticket(),NOW),/Remaining daily Demo loss allowance/);
});
test('stop slippage and exit fees count, with entry slippage applied only once',()=>{
 assert.equal(Paper.open(state(1470.55),{BTC:100},ticket(),NOW).positions.length,1);
 assert.throws(()=>Paper.open(state(1470.55),{BTC:100},ticket('BUY',{slippageBps:5}),NOW),/Remaining daily Demo loss allowance/);
 for(const side of ['BUY','SELL']){
  const account=Paper.open(state(1470.7),{BTC:100},ticket(side,{slippageBps:10}),NOW);
  assert.ok(Math.abs(account.positions[0].entry-(side==='BUY'?100.1:99.9))<1e-10);
  const stopped=Paper.applyQuote(account,{BTC:account.positions[0].stop},NOW+1000);
  assert.ok(stopped.cash>=1470);
 }
});
test('risk reserve does not borrow future gains from tightened stops or rewrite manual/scalper policy',()=>{
 const existing={id:'held',symbol:'ETH',side:'BUY',entry:100,qty:1,stop:101,target:106,notional:100,entryFee:.06};
 assert.throws(()=>Paper.open({...state(1470.3),positions:[existing]},{BTC:100},ticket(),NOW),/Remaining daily Demo loss allowance/);
 assert.equal(Paper.open(state(1470.5),{BTC:100},{symbol:'BTC',side:'BUY',notional:100,stopPct:.4},NOW).positions.length,1);
 const untouched=state();assert.equal(Paper.open(untouched,{BTC:100},ticket(),NOW).positions.length,1);assert.equal(untouched.positions.length,0);
});
test('a new UTC day uses the same reset baseline as the stored account and old drawdown is not charged twice',()=>{
 const yesterday={...state(1470.5),day:'2026-11-03'};
 const opened=Paper.open(yesterday,{BTC:100},ticket(),NOW);
 assert.equal(opened.day,'2026-11-04');assert.equal(opened.dayStartEquity,1470.5);
 assert.equal(opened.positions.length,1);
});
