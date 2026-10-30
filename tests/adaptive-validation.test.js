'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {readHistory,PERIOD,PAGE_SIZE}=require('../lib/bybit-history');
const {evaluateAdaptive,bootstrapFoldNet}=require('../lib/adaptive-validation');
const {evaluateForward}=require('../static/forward-validation');
function candles(n=6200){
 const start=Date.UTC(2026,8,1),out=[];let prev=100;
 for(let i=0;i<n;i++){
  const price=100+i*.002+Math.sin(i/18)*1.2+Math.sin(i/57)*1.8;
  const open=prev,close=price;
  out.push([start+i*PERIOD,open,Math.max(open,close)+.25,Math.min(open,close)-.25,close,1100+(i%13)*30]);
  prev=close;
 }
 return out;
}
test('56-day Bybit history is paginated and all completed candles have strict 5-minute coverage',async()=>{
 const now=Date.parse('2026-10-30T15:28:00Z'),calls=[];
 const fetcher=async url=>{
  const qs=new URL(url).searchParams;
  const start=Number(qs.get('start')),end=Number(qs.get('end')),limit=Number(qs.get('limit'));
  calls.push({start,end,limit});
  const list=[];
  for(let t=end;t>=start;t-=PERIOD)list.push([String(t),'100','101','99','100','1000']);
  return {ok:true,json:async()=>({retCode:0,result:{symbol:'BTCUSDT',list}})};
 };
 const full=await readHistory('BTCUSDT',{days:56,now,fetcher});
 assert.equal(full.count,16128);assert.equal(full.complete,true);
 assert.equal(full.pages,Math.ceil(16128/PAGE_SIZE));assert.equal(calls.length,full.pages);
 assert.ok(calls.every(x=>x.limit<=1000&&x.end>=x.start&&(x.end-x.start)/PERIOD<1000));
 assert.equal(full.bars.at(-1)[0]+PERIOD<=now,true);
 for(let i=1;i<full.bars.length;i++)assert.equal(full.bars[i][0]-full.bars[i-1][0],PERIOD);
});
test('truncated pages, missing candles and unfinished bars cannot be treated as complete',async()=>{
 const now=Date.parse('2026-10-30T15:28:00Z');
 const bad=async url=>{
  const qs=new URL(url).searchParams,start=Number(qs.get('start')),end=Number(qs.get('end'));
  const list=[];
  for(let t=end;t>start;t-=PERIOD)list.push([String(t),'100','101','99','100','1000']); // omit oldest
  return {ok:true,json:async()=>({retCode:0,result:{symbol:'BTCUSDT',list}})};
 };
 await assert.rejects(()=>readHistory('BTCUSDT',{days:28,now,fetcher:bad}),/coverage incomplete/);
 await assert.rejects(()=>readHistory('BTCUSDT',{days:7,now,fetcher:bad}),/Invalid Bybit history request/);
 await assert.rejects(()=>readHistory('BTC/USDT',{days:56,now,fetcher:bad}),/Invalid Bybit history request/);
});
test('adaptive model has nonoverlapping future tests, outcome embargo and no automatic live changes',()=>{
 const results=evaluateAdaptive(candles(),{asset:'BTC'});
 assert.equal(results.mode,'ADAPTIVE_WALK_FORWARD_RESEARCH');
 assert.equal(results.liveExecutionAffected,false);
 assert.equal(results.process.windows,12);
 assert.ok(results.folds.every(x=>x.trainLastSignalAt+2*PERIOD<x.validationFirstAt));
 assert.ok(results.folds.every(x=>x.validationLastAt+2*PERIOD<x.testStartAt));
 assert.ok(results.folds.every(x=>x.selected.count>=0));
 for(let i=1;i<results.folds.length;i++)assert.ok(results.folds[i].testStartAt-results.folds[i-1].testEndAt>48*PERIOD);
 assert.equal(results.summary.adaptiveTrades,results.folds.reduce((sum,f)=>sum+f.selected.count,0));
 assert.equal(results.summary.enoughHistoricalEvidence,results.summary.stage==='HISTORICAL_GATE_PASSED_REQUIRES_FORWARD_TRADES');
 assert.match(results.limitations,/does not include historical spread/);
});
test('later test candles cannot change the earlier validation selection',()=>{
 const prior=candles(),first=evaluateAdaptive(prior,{asset:'BTC'});
 const future=candles(),boundary=first.folds[0].testStartAt;
 for(const row of future)if(row[0]>=boundary){
  const mul=1+.0002*Math.sin(row[0]/PERIOD);
  row[1]*=mul;row[2]*=mul*1.005;row[3]*=mul*.995;row[4]*=mul;
 }
 const later=evaluateAdaptive(future,{asset:'BTC'});
 assert.equal(first.folds[0].chosenThreshold,later.folds[0].chosenThreshold);
 assert.equal(first.folds[0].validationBaselineNetUsd,later.folds[0].validationBaselineNetUsd);
 assert.equal(first.folds[0].validationChosenNetUsd,later.folds[0].validationChosenNetUsd);
});
test('reproducible fold bootstrap cannot be read as a calibrated forecast',()=>{
 const windows=[{selected:{netUsd:1}},{selected:{netUsd:-2}},{selected:{netUsd:4}}];
 const a=bootstrapFoldNet(windows),b=bootstrapFoldNet(windows);
 assert.deepEqual(a,b);
 assert.ok(a.lower5PctUsd<=a.medianUsd);
 assert.match(a.method,/NOT a calibrated predictive interval/);
});
function forwardFixture(size=65,{loss=false}={}){
 const first=Date.parse('2026-10-01T00:00:00Z');
 return Array.from({length:size},(_,i)=>{
  const closedAt=first+i*8*3600000;
  return {id:'paper-'+i,symbol:['BTC','ETH','SOL'][i%3],side:i%2?'SELL':'BUY',auto:true,
   openedAt:closedAt-1800000,closedAt,
   netRaw:loss?-1:i%6===0?-.15:.40,
   entryEvidence:{strategy:'evidence-v11',executionPolicy:'DEMO_FORWARD_TEST',
    forwardValidationVersion:'OMEGA_FORWARD_V1',qualityScore:75,regime:i%2?'TREND':'RANGE / TRANSITION'}};
 });
}
test('forward validation requires independent completed strategy-tagged Demo trades and positive results',()=>{
 const now=Date.parse('2026-11-10T00:00:00Z'),records=forwardFixture();
 const d=evaluateForward(records,{now});
 assert.equal(d.passed,true);
 assert.equal(d.retained,records.length);
 assert.equal(d.sample.distinctSymbols,3);
 assert.ok(d.conditions.every(x=>x.pass));
 assert.equal(d.stage,'FORWARD_DEMO_GATE_PASSED_RESEARCH_ONLY');
});
test('small, losing, future-dated, untagged and duplicate trades cannot satisfy the forward evidence gate',()=>{
 const now=Date.parse('2026-11-10T00:00:00Z');
 const small=evaluateForward(forwardFixture(20),{now});assert.equal(small.passed,false);
 const losses=evaluateForward(forwardFixture(65,{loss:true}),{now});assert.equal(losses.passed,false);
 const old=forwardFixture();old.forEach(x=>delete x.entryEvidence.forwardValidationVersion);
 assert.equal(evaluateForward(old,{now}).retained,0);
 const duplicates=forwardFixture();
 duplicates.push({...duplicates[0]});
 assert.equal(evaluateForward(duplicates,{now}).rejected.duplicates,1);
 const future=forwardFixture();future[0].closedAt=Date.parse('2026-12-30T00:00:00Z');
 assert.equal(evaluateForward(future,{now}).rejected.invalidRecord,1);
});
test('adaptive lab only requests public research and reads the Demo ledger; never places funded orders',()=>{
 const root=path.resolve(__dirname,'..');
 const api=fs.readFileSync(path.join(root,'api/intelligence.js'),'utf8');
 const client=fs.readFileSync(path.join(root,'static/adaptive-lab.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const paper=fs.readFileSync(path.join(root,'static/auto-v7.js'),'utf8');
 const policy=fs.readFileSync(path.join(root,'lib/live-policy.js'),'utf8');
 for(const id of ['adaptive-run','adaptive-days','adaptive-folds','forward-validate','forward-checks','adaptive-joint-status'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(api,/validation==='adaptive'/);
 assert.match(api,/history\.readHistory/);
 assert.match(client,/OmegaForwardValidation\.evaluateForward/);
 assert.match(client,/OmegaAccount\.read/);
 assert.ok(!client.includes("method:'POST'")&&!client.includes("action:'enter'"));
 assert.match(paper,/forwardValidationVersion:'OMEGA_FORWARD_V1'/);
 assert.match(policy,/MIN_LIVE_ORDER_USD=90/);
});
