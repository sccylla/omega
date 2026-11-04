'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Engine=require('../static/seconds-engine'),Demo=require('../static/demo-seconds-signals');
const Evidence=require('../lib/scalp-evidence');
const NOW=1800000005000,SYMBOL='XRPUSDT';
function evidence(price=i=>100+i*.014){
 return {now:NOW,side:'Buy',book:{ts:NOW,b:[['100','120'],['99.99','100']],a:[['100.01','40'],['100.02','30']]},
  trades:Array.from({length:60},(_,i)=>({T:NOW-(59-i)*1000,p:String(price(i)),v:'8',S:'Buy',execId:'trade-'+i}))};
}
test('movement analysis recognizes persistent rising and falling paths without future observations',()=>{
 const second=Math.floor(NOW/1000);
 for(const dir of [1,-1]){
  const rows=Array.from({length:16},(_,i)=>({s:second-15+i,mid:100+dir*i*.01}));
  const result=Engine.analyzeMovement([...rows,{s:second+1,mid:500}],second);
  assert.equal(result.persistent,true);assert.equal(result.efficiency15,1);
  assert.equal(Math.sign(result.move5Bps),dir);assert.equal(result.observations,16);
 }
});
test('funded scalp rejects whipsaws even with positive 5s/15s net movement and aggressive buying',()=>{
 const smooth=Evidence.decide(evidence());assert.equal(smooth.eligible,true);
 const noisy=Evidence.decide(evidence(i=>100+i*.014+(i%2?.30:-.30)));
 assert.ok(noisy.move15Bps>=10);assert.ok(noisy.pressure>=.63);assert.ok(noisy.movement.move5Bps>0);
 assert.ok(noisy.movement.efficiency15<.35);assert.equal(noisy.eligible,false);
 assert.match(noisy.reason,/persistent/);
});
test('funded scalp detects a recent reversal that a positive 15-second return misses',()=>{
 const result=Evidence.decide(evidence(i=>i<=54?100+i*.014:100+54*.014-(i-54)*.005));
 assert.ok(result.move15Bps>=10);assert.ok(result.movement.move5Bps<0);
 assert.equal(result.eligible,false);assert.match(result.reason,/persistent/);
});
test('missing book time, stale trades, duplicate executions and block trades cannot qualify',()=>{
 const q=evidence(),book={...q.book};delete book.ts;
 assert.equal(Evidence.decide({...q,book}).eligible,false);
 const stale=q.trades.map(t=>({...t,T:t.T-4000}));
 assert.equal(Evidence.decide({...q,trades:stale}).eligible,false);
 assert.equal(Evidence.decide({...q,trades:q.trades.map(t=>({...t,execId:'same-execution'}))}).eligible,false);
 assert.equal(Evidence.decide({...q,trades:q.trades.map(t=>({...t,BT:true}))}).eligible,false);
});
test('burst-only samples cannot stand in for a continuous recent movement history',()=>{
 const q=evidence(),result=Evidence.decide({...q,trades:q.trades.map((t,i)=>({...t,T:NOW-Math.floor((59-i)/5)*5000}))});
 assert.ok(result.sampleCount>=30);assert.equal(result.movement.ready,false);
 assert.equal(result.eligible,false);
});
test('Demo exploratory scoring preserves the shared choppy-path veto',()=>{
 const symbol=SYMBOL,engine=Engine.create([symbol]);
 for(let i=0;i<36;i++){
  const now=NOW-(35-i)*1000,p=100+i*.014+(i%2?.30:-.30);
  engine.ingest({topic:'orderbook.50.'+symbol,ts:now,type:'snapshot',data:{s:symbol,u:i+1,seq:i+1,
   b:[[String(p-.005),'1000']],a:[[String(p+.005),'350']]}},now);
  engine.ingest({topic:'publicTrade.'+symbol,ts:now,data:[{s:symbol,S:'Buy',T:now,p:String(p),v:'20',i:'trade-'+i}]},now);
 }
 const raw=engine.observation(symbol,NOW+100),demo=Demo.evaluate(raw);
 assert.ok(raw.move5Bps>0&&raw.move15Bps>0);assert.equal(raw.movement.persistent,false);
 assert.equal(demo.state,'WAIT');assert.match(demo.reasons.join(' '),/Choppy price path/);
});
