const test=require('node:test'),assert=require('node:assert/strict'),P=require('../lib/paper-engine');
test('new virtual balance is $100 with no positions or history',()=>{const s=P.initial();assert.equal(P.equity(s,{}),100);assert.equal(s.starting,100);assert.deepEqual(s.positions,[]);assert.deepEqual(s.closed,[])});
test('no live broker methods or credentials in paper engine',()=>{assert.equal(typeof P.submitLiveOrder,'undefined');assert.equal(typeof P.open,'function')});
test('one $100 position opens against the $100 virtual account and charges its fee',()=>{const s=P.open(P.initial(),{BTC:100},{symbol:'BTC',side:'BUY',notional:100});assert.equal(s.positions.length,1);assert.equal(s.cash,99.94);assert.equal(P.equity(s,{BTC:100}),99.94)});
test('short position realizes gains on lower price and deducts closing fees',()=>{let s=P.open(P.initial(),{ETH:200},{symbol:'ETH',side:'SELL',notional:100});s=P.close(s,s.positions[0].id,180);assert.equal(s.positions.length,0);assert.ok(s.cash>109.8);assert.ok(s.closed[0].net>9.8)});
test('a position cannot exceed virtual equity or borrow to meet the minimum',()=>{assert.throws(()=>P.entryPreview(P.initial(),{BTC:100},{symbol:'BTC',side:'BUY',notional:101}),/equity/);assert.throws(()=>P.entryPreview({...P.initial(),cash:99.99},{BTC:100},{symbol:'BTC',side:'BUY',notional:100}),/minimum requires/)});
test('estimated stop risk stays within the 2 percent demo budget',()=>assert.throws(()=>P.entryPreview(P.initial(),{BTC:100},{symbol:'BTC',side:'BUY',notional:100,stopPct:3}),/2%/));
test('missing price cannot create an order',()=>assert.throws(()=>P.open(P.initial(),{},{symbol:'ETH',side:'BUY',notional:100}),/unavailable/));
test('one demo position at a time applies to manual and automatic entries',()=>{const s=P.open(P.initial(),{BTC:100},{symbol:'BTC',side:'BUY',notional:100});for(const auto of [false,true])assert.throws(()=>P.open(s,{BTC:100,ETH:100},{symbol:'ETH',side:'SELL',notional:100,auto}),/One demo trade/)});
test('simulated stop triggers only after a quote check',()=>{let s=P.open(P.initial(),{BTC:100},{symbol:'BTC',side:'BUY',notional:100});s=P.applyQuote(s,{BTC:98});assert.equal(s.positions.length,0);assert.equal(s.closed[0].reason,'Stop simulated')});
test('manual take profit remains separate from automatic positive-profit exits',()=>{let s=P.open(P.initial(),{BTC:100},{symbol:'BTC',side:'BUY',notional:100});s=P.applyQuote(s,{BTC:100.5});assert.equal(s.positions.length,1);s=P.applyQuote(s,{BTC:104});assert.equal(s.closed[0].reason,'Target simulated')});
test('daily 2% loss lock blocks a new trade',()=>{const s={...P.initial(),cash:97.9};assert.throws(()=>P.open(s,{BTC:100},{symbol:'BTC',side:'BUY',notional:100}),/daily virtual loss limit/i)});
test('old demo versions and corrupted storage reset to $100',()=>{for(const saved of [{version:4,cash:-1},{...P.initial(),version:6,cash:10000}])assert.equal(P.restore(saved).cash,100)});
test('positive-profit exits wait for fees and slippage to be covered in both directions',()=>{
 for(const side of ['BUY','SELL']){
  let s=P.open(P.initial(),{XRP:1},{symbol:'XRP',side,notional:100,auto:true,closeOnProfit:true,targetNet:5,slippageBps:4,entryEvidence:{strategy:'evidence-v11'}});
  s=P.applyQuote(s,{XRP:side==='BUY'?1.001:.999});assert.equal(s.positions.length,1);
  s=P.applyQuote(s,{XRP:side==='BUY'?1.003:.997});assert.equal(s.positions.length,0);assert.ok(s.closed[0].netRaw>=.01);assert.match(s.closed[0].reason,/Positive net profit/);assert.ok(s.cash>100);
  s=P.open(s,{XRP:1},{symbol:'XRP',side,notional:100,auto:true,closeOnProfit:true});assert.equal(s.positions.length,1);
 }
});
test('a saved profitable-close policy survives restore and never bypasses a losing stop',()=>{
 let s=P.open(P.initial(),{BTC:100},{symbol:'BTC',side:'BUY',notional:100,auto:true,closeOnProfit:true,entryEvidence:{strategy:'evidence-v11'}});
 s=P.restore(JSON.parse(JSON.stringify(s)));assert.equal(s.positions[0].closeOnProfit,true);
 s=P.applyQuote(s,{BTC:98});assert.equal(s.positions.length,0);assert.ok(s.closed[0].netRaw<0);assert.equal(s.closed[0].reason,'Stop simulated');
});
