'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {evaluateWalkForward,summarizeClosedTrades}=require('../lib/walk-forward');
const {summarizeClosedTrades:browserReview}=require('../static/trade-review');
function history(n=1000){
 const ms=300000,start=Date.parse('2026-10-01T00:00:00Z'),out=[];
 let previous=100;
 for(let i=0;i<n;i++){
  const close=100+i*.018+Math.sin(i/13)*1.1+Math.sin(i/47)*2;
  const open=previous,high=Math.max(open,close)+.16,low=Math.min(open,close)-.16;
  out.push([start+i*ms,open,high,low,close,1100+(i%13)*23]);
  previous=close;
 }
 return out;
}
test('walk-forward uses at least three disjoint chronological held-out windows with a label embargo',()=>{
 const d=evaluateWalkForward(history(),{asset:'BTC'});
 assert.equal(d.mode,'WALK_FORWARD_RESEARCH_ONLY');
 assert.equal(d.liveExecutionAffected,false);
 assert.equal(d.trainedOnRealOrders,false);
 assert.ok(d.independentTestWindows>=3);
 assert.ok(d.heldOutSignals>=300);
 assert.ok(d.folds.every(f=>f.trainLastSignalAt+600000<f.testStartAt));
 for(let j=1;j<d.folds.length;j++)assert.ok(d.folds[j-1].testEndAt<d.folds[j].testStartAt);
 assert.equal(d.researchComparison.baselineTrades,d.folds.reduce((s,f)=>s+f.baseline.trades,0));
 assert.equal(d.researchComparison.selectedTrades,d.folds.reduce((s,f)=>s+f.selected.trades,0));
 assert.match(d.limitations,/does not replay the actual OMEGA strict live strategy/);
});
test('policy selection for the first fold cannot see or learn from its future test data',()=>{
 const original=history(),a=evaluateWalkForward(original,{asset:'BTC'});
 const later=history(),cut=a.folds[0].testStartAt;
 for(let i=0;i<later.length;i++){
  if(later[i][0]>=cut){const x=later[i],factor=1+.0008*Math.sin(i);x[1]*=factor;x[2]*=factor*1.01;x[3]*=factor*.99;x[4]*=factor}
 }
 // Mutating future market observations may change later results, but must not
 // alter the first fold's earlier validation choice or stats.
 const b=evaluateWalkForward(later,{asset:'BTC'});
 assert.equal(a.folds[0].chosenPolicy,b.folds[0].chosenPolicy);
 assert.equal(a.folds[0].validationNetUsd,b.folds[0].validationNetUsd);
 assert.equal(a.folds[0].validationBaselineNetUsd,b.folds[0].validationBaselineNetUsd);
});
test('insufficient market history and bad research inputs are rejected',()=>{
 assert.throws(()=>evaluateWalkForward(history(380),{asset:'BTC'}),/440 usable/);
 assert.throws(()=>evaluateWalkForward(history(1000),{asset:'../../'}),/Invalid research asset/);
});
test('completed Demo trades group known recorded regimes but never invent missing regime data',()=>{
 const now=Date.now();
 const records=[
  {symbol:'BTC',side:'BUY',net:.52,closedAt:now-40000,entryEvidence:{regime:'TREND'}},
  {symbol:'ETH',side:'SELL',net:-.25,closedAt:now-20000,entryEvidence:{}},
  {symbol:'ETH',side:'BUY',net:.18,closedAt:now-10000,entryEvidence:{regime:'RANGE / TRANSITION'}},
  {symbol:'BTC',side:'BUY',net:100,closedAt:now+86400000},
  {symbol:'../../',side:'BUY',net:5,closedAt:now-9000}
 ];
 const d=summarizeClosedTrades(records,{label:'DEMO',now});
 assert.equal(d.sampleSize,3);
 assert.equal(d.mode,'CLOSED_TRADE_DIAGNOSTICS');
 assert.equal(d.netUsd,.45);
 assert.equal(d.byMarket.find(x=>x.name==='ETH').count,2);
 assert.equal(d.byRegime.find(x=>x.name==='NOT RECORDED').count,1);
 assert.equal(d.winRatePct,66.7);
 assert.deepEqual(browserReview(records,{label:'DEMO',now}),d);
});
test('closed-trade report refuses to infer a credible profitable edge from tiny samples',()=>{
 const d=summarizeClosedTrades([{symbol:'BTCUSDT',side:'Sell',net:2,closedAt:Date.now()}],{label:'BYBIT'});
 assert.match(d.interpretation,/Small sample/);
 assert.match(d.limitations,/accounting may exclude/);
 assert.ok(d.maxDrawdownUsd>=0);
});
test('new research routes and browser controls cannot submit trades or change live thresholds',()=>{
 const root=path.resolve(__dirname,'..');
 const api=fs.readFileSync(path.join(root,'api/intelligence.js'),'utf8');
 const browser=fs.readFileSync(path.join(root,'static/wf-lab.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const live=fs.readFileSync(path.join(root,'api/live.js'),'utf8');
 for(const id of ['wf-run','wf-asset','wf-demo','wf-live','wf-fold-rows','wf-trade-regimes'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(api,/validation==='walkforward'/);
 assert.match(live,/action==='closed'/);
 assert.match(browser,/validation:'walkforward'/);
 assert.match(browser,/OmegaAccount\.read/);
 assert.ok(!browser.includes("method:'POST'")&&!browser.includes("action:'enter'")&&!browser.includes("action:'arm'"));
 assert.ok(!api.includes("'/v5/order/create'"));
});
