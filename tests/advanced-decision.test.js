'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {decide,holdout,candles,resampleComplete,correlation,priceRules}=require('../lib/advanced-decision');
const {NOW,series,evidence}=require('./fixtures/advanced-evidence');
test('fully covered synthetic evidence may qualify, with no invented profit probability',()=>{
 const x=decide(evidence(),{now:NOW});
 assert.equal(x.eligible,true);assert.equal(x.decision,'BUY');assert.equal(x.notional,90);assert.equal(x.expiresAt,NOW+10000);assert.ok(x.checks.every(c=>c.pass));
 assert.ok(x.validation.tradeCount>=20);assert.equal(x.validation.side,'BUY');assert.equal(x.validation.kind,'PRICE_ONLY_HISTORICAL_SANITY_CHECK');assert.match(x.validation.limitations,/not a prediction/);assert.match(x.scoreMeaning,/not a win probability/);
 assert.ok(x.targetNet>0&&x.stopPct>0&&x.metrics.estimatedRoundTripCostUsd>0);assert.equal(Object.hasOwn(x,'winProbability'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(x)),x);
});
test('each missing feed, stale source timestamp or source error independently blocks entry',()=>{
 for(const key of ['five','quarter','hour','fourHour','benchmarkFive','book','ticker','openInterest','fundingHistory','instrument']){
  const e=evidence();e[key]=null;assert.equal(decide(e,{now:NOW}).eligible,false,key+' missing');
  const stale=evidence();stale.sourceTimes[key]=NOW-16000;assert.equal(decide(stale,{now:NOW}).eligible,false,key+' stale');
 }
 const errored=evidence();errored.errors=[{source:'book',code:'NETWORK_UNAVAILABLE'}];assert.ok(decide(errored,{now:NOW}).blockers.some(x=>x.includes('book: NETWORK_UNAVAILABLE')));
 const e=evidence();e.observedAt=NOW-10001;assert.equal(decide(e,{now:NOW}).eligible,false);
});
test('gaps, impossible OHLC, duplicate timestamps and future source data fail closed',()=>{
 for(const mutate of [e=>e.five.splice(100,1),e=>e.quarter.reverse(),e=>{e.hour[30][2]=e.hour[30][3]-1},e=>{e.fourHour[20][0]=e.fourHour[19][0]},e=>{e.sourceTimes.ticker=NOW+2000},e=>{e.book.ts=NOW+2000}]){
  const e=evidence();mutate(e);assert.equal(decide(e,{now:NOW}).eligible,false,mutate.toString());
 }
 assert.equal(decide(evidence(),{now:NOW,notional:20}).eligible,false);
});
test('uncompleted candles cannot change price-only decisions or holdout outcomes',()=>{
 const e=evidence(),before=decide(e,{now:NOW}),t=Math.floor(NOW/300000)*300000;
 e.five.push([t,e.five.at(-1)[4],10,.01,9,1e9]);
 const after=decide(e,{now:NOW});assert.equal(after.price,before.price);assert.equal(after.barTime,before.barTime);assert.equal(after.eligible,before.eligible);assert.deepEqual(after.validation,before.validation);
});
test('live order-book liquidity and exchange size restrictions are mandatory',()=>{
 for(const mutate of [e=>{e.book.a[0][0]=e.book.b[0][0]},e=>{e.book.ts=NOW-16000},e=>{e.book.a=e.book.a.map(l=>[l[0],'.00001'])},e=>{e.instrument.lotSizeFilter.minNotionalValue='92'},e=>{e.ticker.turnover24h='100'},e=>{e.ticker.ask1Price=String(Number(e.ticker.ask1Price)*1.01)}]){
  const e=evidence();mutate(e);assert.equal(decide(e,{now:NOW}).eligible,false,mutate.toString());
 }
});
test('crowded funding, imminent funding charges and unstable open interest block trades',()=>{
 for(const mutate of [e=>{e.ticker.fundingRate='.0008'},e=>{e.ticker.fundingRate='.0003';e.ticker.nextFundingTime=String(NOW+60000)},e=>{e.openInterest.at(-1).openInterest='50000'},e=>{e.openInterest.forEach(x=>x.timestamp=String(Number(x.timestamp)-3600000))},e=>{e.fundingHistory.at(-1).fundingRateTimestamp=String(NOW-4*86400000)}]){
  const e=evidence();mutate(e);assert.equal(decide(e,{now:NOW}).eligible,false,mutate.toString());
 }
});
test('benchmark shock and strongly opposing depth prevent otherwise qualified entries',()=>{
 const e=evidence();for(let j=1;j<=4;j++)e.benchmarkFive.at(-1)[j]*=1.04;
 assert.ok(decide(e,{now:NOW}).blockers.some(x=>x.includes('broad-market shock')));
 const opposing=evidence();opposing.book.b=opposing.book.b.map(l=>[l[0],'1']);assert.ok(decide(opposing,{now:NOW}).blockers.some(x=>x.includes('pressure')));
});
test('price-only holdout uses nonoverlapping next-open entries and reports limited coverage',()=>{
 const e=evidence(),v=holdout(e,{now:NOW,side:'BUY'});
 assert.ok(v.tradeCount>=20);assert.equal(v.nonOverlapping,true);assert.equal(v.entry,'Next candle open');assert.ok(v.recent.every(r=>r.enteredAt>=r.signalAt));
 for(let i=1;i<v.recent.length;i++)assert.ok(v.recent[i].enteredAt>=v.recent[i-1].closedAt);
 const sparse={...e,five:e.five.slice(-200)};assert.equal(holdout(sparse,{now:NOW,side:'BUY'}).passed,false);
 assert.match(v.limitations,/Historical order-book, open-interest/);
});
test('current execution-cost floor raises holdout stress and can reject a previously positive sample',()=>{
 const e=evidence(),base=holdout(e,{now:NOW,side:'BUY'}),expensive=holdout(e,{now:NOW,side:'BUY',costRate:.006});
 assert.equal(base.passed,true);assert.equal(expensive.passed,false);assert.equal(expensive.roundTripCostBps,60);assert.ok(expensive.netPnl<base.netPnl);
 const elevated=evidence();elevated.ticker.fundingRate='.0005';const decision=decide(elevated,{now:NOW});assert.ok(decision.validation.roundTripCostBps>=decision.metrics.estimatedRoundTripCostUsd/90*10000);
});
test('a profitable opposite-side history cannot qualify the requested losing or unsupported side',()=>{
 const e=evidence(),buy=holdout(e,{now:NOW,side:'BUY'}),sell=holdout(e,{now:NOW,side:'SELL'});
 assert.equal(buy.passed,true);assert.equal(sell.side,'SELL');assert.equal(sell.passed,false);assert.equal(sell.tradeCount,0);
 assert.equal(decide(e,{now:NOW,side:'SELL'}).eligible,false);
});
test('correlation uses aligned completed returns and never fabricates an unavailable value',()=>{
 const e=evidence(),same=e.five.slice(-200);assert.ok(Math.abs(correlation(e.five,same)-1)<1e-10);assert.equal(correlation(e.five,same.slice(-10)),null);
 const inverse=same.map(r=>[r[0],1/r[1],1/r[3],1/r[2],1/r[4],r[5]]);assert.ok(Math.abs(correlation(e.five,inverse)+1)<1e-10);
});
test('complete resampling does not fabricate missing or partial higher-timeframe buckets',()=>{
 const r=series(12,300000),complete=resampleComplete(r,900000);assert.equal(complete.length,4);r.splice(4,1);assert.equal(resampleComplete(r,900000).length,3);
 assert.equal(candles(series(50,14400000),14400000,40,NOW).ok,true);
});
test('stop-first stress handling does not count an ambiguous candle as a guaranteed win',()=>{
 const e=evidence(),baseline=holdout(e,{now:NOW,side:'BUY'});
 // Find a confirmed historical entry; its next bar touches both protective levels.
 let first=600;
 for(;first<e.five.length-1;first++){
  const cutoff=e.five[first][0]+300000,known={five:e.five.slice(0,first+1),quarter:e.quarter.filter(r=>r[0]+900000<=cutoff),hour:e.hour.filter(r=>r[0]+3600000<=cutoff),fourHour:e.fourHour.filter(r=>r[0]+14400000<=cutoff)};
  if(priceRules(known,'BUY').pass)break;
 }
 e.five[first+1][2]*=1.1;e.five[first+1][3]*=.9;
 const stressed=holdout(e,{now:NOW,side:'BUY'});
 assert.ok(stressed.ambiguousBars>=1);assert.ok(stressed.netPnl<baseline.netPnl);
});
test('higher-timeframe bars from after a historical entry are not visible to that entry',()=>{
 const e=evidence(),baseline=holdout(e,{now:NOW,side:'BUY'});
 for(const [key,duration]of [['quarter',900000],['hour',3600000],['fourHour',14400000]]){
  const r=e[key].at(-1),t=Math.floor(NOW/duration)*duration+duration;
  e[key].push([t,r[4],r[4]*100,r[4]*.01,r[4]*50,1e12]);
 }
 assert.deepEqual(holdout(e,{now:NOW,side:'BUY'}),baseline);
});
test('execution quote is distinct from the closed-candle signal and uses the inspected book',()=>{
 const e=evidence(),plan=decide(e,{now:NOW});
 assert.ok(plan.executionPrice>plan.price);assert.equal(plan.maximumHoldMinutes,null);assert.ok(plan.executionPrice>=Number(e.book.a[0][0]));
});
test('no-time-limit holdout keeps unresolved trades open instead of inventing sample-end exits',()=>{
 const e=evidence();
 // Preserve all preceding signals but leave the final entered trade between its stop and target.
 for(let i=970;i<e.five.length;i++){
  const previous=e.five[969][4];e.five[i]=[e.five[i][0],previous,previous*1.0001,previous*.9999,previous,100000];
 }
 const result=holdout(e,{now:NOW,side:'BUY'});
 assert.equal(result.maximumHoldMinutes,null);
 assert.equal(result.unresolvedTrades,1);assert.equal(result.passed,false);assert.ok(Number.isFinite(result.unresolvedMarkedNet));
 assert.ok(result.recent.every(r=>['Stop first','Profit target'].includes(r.reason)));
 assert.match(result.reason,/unresolved/);
});
test('demo can forward-test a current qualifying setup without twenty historical closed trades; live cannot',()=>{
 const e=evidence();e.five=e.five.slice(-500);
 const strict=decide(e,{now:NOW}),live=decide(e,{now:NOW,mode:'live'}),demo=decide(e,{now:NOW,mode:'demo'});
 assert.equal(strict.eligible,false);assert.equal(live.eligible,false);assert.match(strict.reason,/Insufficient closed holdout trades/);
 assert.equal(demo.eligible,true);assert.equal(demo.executionPolicy,'DEMO_FORWARD_TEST');assert.equal(demo.validation.entryGate,'ADVISORY_DEMO');
 assert.equal(demo.validation.passed,false);assert.equal(demo.validation.tradeCount,0);assert.equal(demo.blockers.length,0);assert.ok(demo.warnings.length);
 assert.ok(demo.checks.filter(c=>c.required!==false).every(c=>c.pass));assert.equal(demo.checks.filter(c=>c.required===false).length,2);
 assert.ok(Math.abs(demo.targetNet-(100/90)*strict.targetNet)<1e-10);assert.equal(demo.stopPct,strict.stopPct);assert.equal(demo.notional,100);
 assert.equal(decide(e,{now:NOW,mode:'unrecognized'}).eligible,false);
});
test('demo history advisory never bypasses current market data, direction, spread, funding or sizing rules',()=>{
 for(const mutate of [e=>e.book=null,e=>e.five.splice(100,1),e=>e.ticker.turnover24h='1',e=>e.ticker.fundingRate='.001',e=>e.instrument.lotSizeFilter.minNotionalValue='101',e=>e.sourceTimes.ticker=NOW-16000]){
  const e=evidence();e.five=e.five.slice(-500);mutate(e);const plan=decide(e,{now:NOW,mode:'demo'});
  assert.equal(plan.eligible,false);assert.ok(plan.blockers.length);assert.ok(plan.checks.some(c=>!c.pass&&c.required!==false));
 }
 const e=evidence();e.five=e.five.slice(-500);assert.equal(decide(e,{now:NOW,mode:'demo',side:'SELL'}).eligible,false);
});
test('an executable quote beyond the signal ATR blocks a late entry even with a coherent narrow book',()=>{
 const e=evidence(),scale=1.0049;
 e.book.b=e.book.b.map(([price,qty])=>[String(Number(price)*scale),qty]);e.book.a=e.book.a.map(([price,qty])=>[String(Number(price)*scale),qty]);
 e.ticker.bid1Price=e.book.b[0][0];e.ticker.ask1Price=e.book.a[0][0];
 const plan=decide(e,{now:NOW,mode:'demo'});assert.equal(plan.eligible,false);assert.ok(plan.blockers.some(x=>x.includes('Executable price still fits the signal')));
});

test('demo may forward-test four-hour trend disagreement but strict live entry is still blocked',()=>{
 const e=evidence();
 const dir=decide(e,{now:NOW,mode:'demo'}).side;
 e.fourHour=e.fourHour.map((bar,i)=>{
  const base=12*(1-i*.00045),open=base,close=base*(1-.0001);
  return [bar[0],open,open*1.0002,close*.9998,close,bar[5]];
 });
 const demo=decide(e,{now:NOW,mode:'demo'});
 const strict=decide(e,{now:NOW,mode:'live'});
 assert.equal(dir,'BUY');
 assert.equal(demo.eligible,true);
 assert.ok(demo.checks.some(c=>c.label.includes('4h trend')&&!c.pass&&c.required===false));
 assert.ok(demo.warnings.some(c=>c.includes('Four-hour trend conflicts')));
 assert.equal(strict.eligible,false);
 assert.ok(strict.blockers.some(c=>c.includes('4h trend')));
});
