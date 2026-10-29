'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {decide,holdout,candles,resampleComplete,correlation}=require('../lib/advanced-decision');
const NOW=Date.UTC(2026,9,29,20,0,12);
// Artificial, deliberately well-covered market. It is not a real performance sample.
function series(n,duration,trend=.0006,amplitude=.008,period=16,phase=1,now=NOW){
 let previous;
 return Array.from({length:n},(_,i)=>{
  const timestamp=Math.floor(now/duration)*duration-(n-i)*duration,close=Math.exp(i*trend)*(1+amplitude*Math.sin((i-n+1+phase)*2*Math.PI/period)),open=previous||close;
  previous=close;return [timestamp,open,Math.max(open,close)+close*.0025,Math.min(open,close)-close*.0025,close,100000];
 });
}
function evidence(now=NOW){
 const five=series(1000,300000,.0006,.008,16,1,now),price=five.at(-1)[4],bid=price*.99995,ask=price*1.00005;
 return {symbol:'XRPUSDT',observedAt:now,sourceTimes:Object.fromEntries(['five','quarter','hour','fourHour','benchmarkFive','book','ticker','openInterest','fundingHistory','instrument'].map(k=>[k,now])),errors:[],five,
  quarter:series(300,900000,.001,.002,20,1,now),hour:series(200,3600000,.0015,.002,20,1,now),fourHour:series(100,14400000,.002,.002,20,1,now),benchmarkFive:series(200,300000,.0002,.0002,20,1,now),
  book:{ts:now,b:Array.from({length:10},(_,i)=>[String(bid*(1-i*.0001)),'10000']),a:Array.from({length:10},(_,i)=>[String(ask*(1+i*.0001)),'10000'])},
  ticker:{symbol:'XRPUSDT',bid1Price:String(bid),ask1Price:String(ask),lastPrice:String(price),turnover24h:'100000000',fundingRate:'.00001',nextFundingTime:String(now+4*3600000)},
  openInterest:Array.from({length:12},(_,i)=>({timestamp:String(now-(11-i)*300000),openInterest:String(100000+i*100)})),
  fundingHistory:Array.from({length:8},(_,i)=>({symbol:'XRPUSDT',fundingRate:'.00001',fundingRateTimestamp:String(now-(8-i)*8*3600000)})),
  instrument:{symbol:'XRPUSDT',status:'Trading',quoteCoin:'USDT',contractType:'LinearPerpetual',fundingInterval:'480',lotSizeFilter:{qtyStep:'.001',minOrderQty:'.001',maxMktOrderQty:'100000',minNotionalValue:'5'},priceFilter:{tickSize:'.00001'}}};
}
test('fully covered synthetic evidence may qualify, with no invented profit probability',()=>{
 const x=decide(evidence(),{now:NOW});
 assert.equal(x.eligible,true);assert.equal(x.decision,'BUY');assert.equal(x.notional,10);assert.equal(x.expiresAt,NOW+10000);assert.ok(x.checks.every(c=>c.pass));
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
 for(const mutate of [e=>{e.book.a[0][0]=e.book.b[0][0]},e=>{e.book.ts=NOW-16000},e=>{e.book.a=e.book.a.map(l=>[l[0],'.00001'])},e=>{e.instrument.lotSizeFilter.minNotionalValue='11'},e=>{e.ticker.turnover24h='100'},e=>{e.ticker.ask1Price=String(Number(e.ticker.ask1Price)*1.01)}]){
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
 const elevated=evidence();elevated.ticker.fundingRate='.0005';const decision=decide(elevated,{now:NOW});assert.ok(decision.validation.roundTripCostBps>=decision.metrics.estimatedRoundTripCostUsd/10*10000);
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
 // The first holdout signal occurs at bar600 for this fixed waveform.
 // Next bar visits both possible exit prices, with no observable intrabar order.
 e.five[601][2]*=1.1;e.five[601][3]*=.9;
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
 assert.ok(plan.executionPrice>plan.price);assert.equal(plan.maximumHoldMinutes,30);assert.ok(plan.executionPrice>=Number(e.book.a[0][0]));
});
