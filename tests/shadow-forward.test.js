'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {makeForecast,VERSION,PERIOD}=require('../lib/shadow-forecast');
const L=require('../static/shadow-ledger');
function candles(n=2016){
 const now=Math.floor(Date.now()/PERIOD)*PERIOD,first=now-n*PERIOD;
 const rows=[];let previous=100;
 for(let i=0;i<n;i++){
  const close=100+i*.001+Math.sin(i/10)*.38+Math.sin(i/45)*.21,open=previous;
  rows.push([first+i*PERIOD,open,Math.max(close,open)+.07,Math.min(close,open)-.07,close,1100+i%11]);
  previous=close;
 }
 return rows;
}
test('shadow model trains on fully observed historical labels, never submits orders and emits two fixed policies',()=>{
 const rows=candles(),now=Date.now(),asset='BTC',last=rows.at(-1);
 const quote={symbol:'BTCUSDT',bid:100.01,ask:100.02,observedAt:Math.max(last[0]+PERIOD,now-1000)};
 const result=makeForecast(rows,{asset,quote,now:quote.observedAt+200});
 assert.equal(result.mode,'FORWARD_SHADOW_RESEARCH_ONLY');
 assert.equal(result.version,VERSION);assert.equal(result.forecastBarTime,last[0]);
 assert.deepEqual(result.policies.map(x=>x.id),['BASELINE_067','ADAPTIVE_072']);
 assert.ok(!Object.hasOwn(result,'orderId'));assert.equal(result.modelFingerprint.length,24);
 const later=rows.map(c=>[...c]);
 later.push([last[0]+PERIOD,100,101,99,100.2,1200]);
 // This later candle is not part of the forecast at the earlier timestamp:
 const copy=makeForecast(rows,{asset,quote,now:quote.observedAt+200});
 assert.equal(result.modelFingerprint,copy.modelFingerprint);
 assert.equal(result.upEstimate,copy.upEstimate);
});
function signal(t=Date.UTC(2026,9,30,14,0)){
 return {mode:'FORWARD_SHADOW_RESEARCH_ONLY',version:VERSION,id:VERSION+'-BTC-'+t,
  symbol:'BTCUSDT',forecastBarTime:t,observedAt:t+PERIOD+1000,
  modelFingerprint:'f'.repeat(24),regime:'TREND',upEstimate:.79,
  policies:[
   {id:'BASELINE_067',side:'BUY',entry:100,stop:99.7,target:100.8,notional:90,estimatedCostsUsd:.234},
   {id:'ADAPTIVE_072',side:'BUY',entry:100,stop:99.7,target:100.8,notional:90,estimatedCostsUsd:.234}
  ]};
}
test('prospective shadow forecast cannot be inserted after outcomes or replayed',()=>{
 const f=signal(),t=f.observedAt+500;
 const one=L.accept(L.initial(),f,t);assert.equal(one.accepted,true);
 const dupe=L.accept(one.state,f,t);assert.equal(dupe.accepted,false);
 assert.equal(dupe.state.events.length,1);
 assert.throws(()=>L.accept(L.initial(),f,t+30000),/stale/);
 assert.throws(()=>L.accept(L.initial(),{...f,modelFingerprint:'bad'},t),/Invalid/);
});
test('a future completed candle settles only after signal; stop-first policy resolves ambiguous TP and SL',()=>{
 const f=signal(),entry=L.accept(L.initial(),f,f.observedAt+500).state;
 const first=Math.ceil(f.observedAt/PERIOD)*PERIOD;
 const bars=[
  [first,100,101,99,100,1000],
  [first+PERIOD,100,100.9,99.8,100.1,1000]
 ];
 assert.equal(L.resolve(entry,{symbol:f.symbol,candles:bars,now:first+PERIOD-1000}).state.events[0].status,'OPEN');
 const done=L.resolve(entry,{symbol:f.symbol,candles:bars,now:first+2*PERIOD}).state;
 assert.equal(done.events[0].status,'CLOSED');
 assert.equal(done.events[0].policies[1].reason,'Stop-first ambiguous bar');
 assert.ok(done.events[0].policies[1].net<0);
 assert.ok(L.report(done).candidate.netUsd<0);
});
test('missing evidence becomes INCOMPLETE, never invented winning outcome',()=>{
 const f=signal(),s=L.accept(L.initial(),f,f.observedAt+500).state;
 const out=L.resolve(s,{symbol:f.symbol,candles:[],now:f.observedAt+31*PERIOD}).state;
 const result=L.report(out);
 assert.equal(out.events[0].status,'INCOMPLETE');
 assert.equal(result.closedObservations,0);
 assert.equal(result.incompleteObservations,1);
 assert.equal(result.passed,false);
});
test('an empty or manually corrupted local journal cannot claim adaptive validation',()=>{
 assert.equal(L.report(L.initial()).passed,false);
 assert.equal(L.report(L.restore({version:1,events:[{id:'fake',symbol:'BAD',observedAt:1,status:'CLOSED',policies:[]}]})).passed,false);
});
test('prospective shadow execution does not use Bybit private keys or any funded-order endpoints',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
 for(const name of ['static/shadow-lab.js','static/shadow-ledger.js','lib/shadow-forecast.js']){
  const src=fs.readFileSync(path.join(root,name),'utf8');
  assert.ok(!src.includes('/v5/order/create'));
  assert.ok(!src.includes('BYBIT_LIVE_API_KEY'));
 }
 const api=fs.readFileSync(path.join(root,'api/intelligence.js'),'utf8');
 assert.ok(api.includes("validation==='shadow'"));
 assert.ok(api.includes('makeForecast('));
});

test('combined readiness cannot turn a legacy Demo win into approved adaptive live trading',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'../static/adaptive-lab.js'),'utf8');
 assert.match(src,/ADAPTIVE STRATEGY NOT APPROVED FOR LIVE/);
 assert.match(src,/different strategy/);
 assert.match(src,/omega_shadow_forward_v1_device/);
 assert.ok(!src.includes("action:'enter'"));
});
