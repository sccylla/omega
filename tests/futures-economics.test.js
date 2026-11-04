'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {economics,minimumTarget}=require('../lib/futures-economics');
const {decide}=require('../lib/advanced-decision');
const {NOW,evidence,demoEvidence}=require('./fixtures/advanced-evidence');
const {LiveBroker}=require('../lib/live-broker');
test('a futures target covers modeled stop loss and costs, with the actual Demo minimum',()=>{
 const real=economics({notional:100,stopPct:.5,costRate:.0022});
 assert.ok(Math.abs(real.estimatedStopNetUsd-.72)<1e-12);
 assert.ok(Math.abs(real.targetNet-1.08)<1e-12);
 assert.ok(Math.abs(real.netRewardRisk-1.5)<1e-12);assert.equal(real.breakEvenWinRatePct,40);
 const demo=economics({notional:100,stopPct:.5,costRate:.0022,minimumTargetNet:minimumTarget('demo')});
 assert.equal(demo.targetNet,5);assert.equal(demo.grossTargetMovePct,5.22);
 for(const invalid of [{notional:0},{stopPct:NaN},{costRate:-1},{minimumTargetNet:Infinity}])
  assert.equal(economics({notional:100,stopPct:.5,costRate:.0022,...invalid}),null);
});
test('Demo cannot qualify using a small research target when its real exit floor requires a larger move',()=>{
 const quiet=decide(evidence(),{mode:'demo',now:NOW});
 assert.equal(quiet.targetNet,5);assert.equal(quiet.eligible,false);
 assert.ok(quiet.blockers.some(s=>s.includes('Costs fit modeled movement')));
 assert.equal(quiet.validation.minimumTargetNet,5);
 const wide=decide(demoEvidence(),{mode:'demo',now:NOW});
 assert.equal(wide.eligible,true);assert.equal(wide.targetNet,5);
 assert.equal(wide.economics.targetNet,5);assert.ok(wide.economics.netRewardRisk>=1.5);
 for(const mode of ['live','live_small']){const plan=decide(evidence(),{mode,now:NOW});assert.equal(plan.eligible,true);assert.equal(plan.minimumNetRewardRisk,1.5)}
});
test('exchange quantity and stop rounding cannot dilute the requested futures reward/risk',async()=>{
 for(const side of ['Buy','Sell']){
  const broker=new LiveBroker({env:{}});
  broker.request=async(_method,path)=>path.includes('instruments')?{list:[{
   symbol:'XRPUSDT',status:'Trading',quoteCoin:'USDT',contractType:'LinearPerpetual',
   lotSizeFilter:{qtyStep:'.01',minOrderQty:'.01',maxMktOrderQty:'100',minNotionalValue:'5'},priceFilter:{tickSize:'.1'}
  }]}:{list:[{symbol:'XRPUSDT',ask1Price:'100.01',bid1Price:'99.99',markPrice:'100'}]};
  const ticket=await broker.ticket('XRPUSDT',side,{price:100,stopPct:.31,targetNet:.06,minimumNetRewardRisk:1.5},{notionalUsd:100,maxNotionalUsd:102});
  const risk=Math.abs(ticket.price-Number(ticket.stopLoss))*Number(ticket.qty)+ticket.notional*ticket.estimatedRoundTripCostRate;
  assert.ok(ticket.estimatedTakeProfitNetUsd+1e-8>=risk*1.5);
  assert.ok(ticket.estimatedTakeProfitNetUsd>.06);
  assert.ok(ticket.notional>=100&&ticket.notional<=102);
  await assert.rejects(broker.ticket('XRPUSDT',side,{price:100,stopPct:.31,targetNet:.06,minimumNetRewardRisk:1.5,
   structure:{metrics:{nearestOpposingLevel:side==='Buy'?100.5:99.5}}},{notionalUsd:100,maxNotionalUsd:102}),/opposing price level/);
 }
});
