'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const I=require('../static/demo-scalp-intelligence'),A=require('../static/demo-seconds-account');
const fs=require('node:fs'),path=require('node:path');
const start=Date.UTC(2026,9,30,15,30),symbol='BTCUSDT';
const tr=(n,net,symbol='BTCUSDT')=>({symbol,side:'BUY',openedAt:start-9000,closedAt:start+n*1000,net,fees:.10,slippage:.036});
const signal=(symbol='BTCUSDT',side='BUY')=>({symbol,side,state:'WATCH',score:88,requiredMoveBps:71,
 move5Bps:4,move15Bps:10,spreadBps:1,flowPressure:.5,imbalance:.2,feasibilityBps:34,range30Bps:20});
function history(t,up=true){
 const secs=Math.floor(t/1000);
 return Array.from({length:61},(_,i)=>{
  const position=i<=56?i/56:(56-(i-56)*2)/56;
  return {s:secs-60+i,mid:100+position*.4};
 });
}
test('Three consecutive confirmed seconds are needed before a Demo candidate can open',()=>{
 const gate=I.create(),seen=[];
 for(let i=0;i<3;i++){
  const now=start+i*1000;
  const res=gate.update([signal()],{BTCUSDT:history(now)},[],now).signals[0];
  seen.push({state:res.state,confirmed:res.confirmationSeconds||0,reason:res.reason});
 }
 assert.deepEqual(seen.map(x=>x.state),['WAIT','WAIT','WATCH']);
 assert.equal(seen[2].confirmed,3);
});
test('A stale/one-second candidate cannot reopen right after its confirmation is lost',()=>{
 const gate=I.create();
 for(let i=0;i<3;i++)gate.update([signal()],{BTCUSDT:history(start+i*1000)},[],start+i*1000);
 const none=gate.update([{...signal(),state:'WAIT'}],{BTCUSDT:history(start+3000)},[],start+3000);
 assert.equal(none.signals[0].state,'WAIT');
 const next=gate.update([signal()],{BTCUSDT:history(start+4000)},[],start+4000);
 assert.equal(next.signals[0].state,'WAIT');
});
test('Three consecutive losing virtual positions pause new entries and remain in the audit',()=>{
 const closed=[tr(1,-.79),tr(2,-.85),tr(3,-.81)],now=start+10000;
 const report=I.audit(closed,now);
 assert.equal(report.latest20,3);assert.equal(report.latestWins,0);
 assert.equal(report.lossStreak,3);assert.ok(report.globalPauseUntil>now);
 assert.equal(report.trailingWinRatePct,0);
 const res=I.create().update([signal()],{BTCUSDT:history(now)},closed,now);
 assert.equal(res.signals[0].state,'WAIT');
 assert.match(res.signals[0].reason,/consecutive losing/);
});
test('Two losing trades quarantine one pair but do not prevent independent pairs from being assessed',()=>{
 const closed=[tr(1,-.78),tr(2,-.76)],now=start+9000;
 const report=I.audit(closed,now);
 assert.ok(report.markets[0].quarantineUntil>now);
 const gate=I.create();
 const res=gate.update([signal('BTCUSDT'),signal('ETHUSDT')],{BTCUSDT:history(now),ETHUSDT:history(now)},closed,now);
 assert.match(res.signals[0].reason,/quarantine/);
 assert.match(res.signals[1].reason,/Confirming order flow/);
});
test('Audit reports estimated fees, a baseline break-even threshold and observed, not projected returns',()=>{
 const rows=[tr(1,.50),tr(2,-.75),tr(3,.52),tr(4,-.82)];
 const r=I.audit(rows,start+9000);
 assert.equal(r.recordsWithCosts,4);
 assert.equal(r.observedCostsUsd,.544);
 assert.ok(r.breakEvenWinPct>50);
 assert.equal(r.validatedEdge,false);
 assert.equal(r.recentNetUsd,-.55);
 assert.equal(r.markets[0].trades,4);
});
test('An overextended upward extreme blocks chase entries without fabricating shorts',()=>{
 const now=start+60000,trend=Array.from({length:61},(_,i)=>({s:Math.floor(now/1000)-60+i,mid:100+i*.02}));
 const res=I.create().update([{...signal(),move5Bps:12}],{BTCUSDT:trend},[],now);
 assert.equal(res.signals[0].state,'WAIT');
 assert.match(res.signals[0].reason,/Late long/);
 assert.equal(res.signals[0].side,null);
});
test('Entry metadata follows a new virtual trade through to its exit without changing actual net accounting',()=>{
 const now=start+100000,good={...signal(),qualityVeto:'DEMO_INTELLIGENCE_V1',confirmationSeconds:3};
 const q=(t,bid=99.99,ask=100.01)=>({symbol:'BTCUSDT',bidVwap:bid,askVwap:ask,observedAt:t,notional:90,requiredMoveBps:72});
 const first=A.step(A.initial(now),{now,signals:[good],quotes:{BTCUSDT:q(now)},connected:true});
 assert.equal(first.events[0].type,'OPEN');
 const last=A.step(first.account,{now:now+2000,signals:[],quotes:{BTCUSDT:q(now+2000,101.1,101.12)},connected:true});
 const trade=last.events[0].trade;
 assert.equal(trade.entryEvidence.strategy,'DEMO_INTELLIGENCE_V1');
 assert.equal(trade.entryEvidence.confirmationSeconds,3);
 assert.equal(trade.entryEvidence.flowPressure,.5);
 assert.ok(trade.net>=.5);
 assert.equal(last.account.wins,1);
});
test('UI exposes honest loss analytics; funded Real code never loads demo intelligence',()=>{
 const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),
 client=fs.readFileSync(path.join(root,'static/demo-seconds-lab.js'),'utf8'),
 real=fs.readFileSync(path.join(root,'static/seconds-lab.js'),'utf8');
 assert.match(html,/src="\/static\/demo-scalp-intelligence.js"/);
 for(const id of ['demo-scalp-intel-status','demo-scalp-intel-costs','demo-scalp-intel-markets'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(client,/intelligence.update\(preSignals,histories,wallet.ledger.closed,now\)/);
 assert.ok(!real.includes('OmegaDemoScalpIntelligence'));
 assert.ok(!client.includes('/v5/order/create'));
});
