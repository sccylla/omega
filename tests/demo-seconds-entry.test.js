'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Engine=require('../static/seconds-engine'),Demo=require('../static/demo-seconds-signals'),Wallet=require('../static/demo-seconds-account');
const Symbol='XRPUSDT',FIRST=Date.UTC(2026,9,30,14,0);
function feed(step=.005,{spread=.018,trades=true,volumeSide='Buy',symbol=Symbol}={}){
 const m=Engine.create([symbol]),book=(t,p,i)=>{
  const b=p-spread/2,a=p+spread/2;
  return {topic:'orderbook.50.'+symbol,ts:t,type:'snapshot',
   data:{s:symbol,u:i+1,seq:i+1,
    b:Array.from({length:7},(_,j)=>[String(b-j*.0001),String(90)]),
    a:Array.from({length:7},(_,j)=>[String(a+j*.0001),String(40)])}};
 };
 for(let i=0;i<36;i++){
  const t=FIRST+i*1000,p=100+i*step;
  m.ingest(book(t,p,i),t);
  if(trades)m.ingest({topic:'publicTrade.'+symbol,ts:t,type:'snapshot',
   data:[{s:symbol,S:volumeSide,p:String(p),v:'10',T:t,i:'event-'+i}]},t);
 }
 const now=FIRST+35200;
 return {m,now,strict:m.observation(symbol,now),demo:Demo.evaluate(m.observation(symbol,now))};
}
test('Demo-only 12-18 bps micro-momentum can qualify even when strict Real research waits for the full target movement',()=>{
 const f=feed();
 assert.equal(f.strict.state,'WAIT');
 assert.match(f.strict.reason,/below net-profit break-even/);
 assert.equal(f.demo.state,'WATCH',JSON.stringify(f.demo.reasons));
 assert.equal(f.demo.side,'BUY');
 assert.ok(f.demo.score>=65);
 assert.equal(f.demo.analysisMode,'DEMO_EXPLORATORY_RESEARCH');
 assert.ok(f.demo.requiredMoveBps>60);
 assert.equal(f.demo.entryMomentumBps,8);
});
test('a smaller qualified demo momentum burst opens a $90 virtual trade without an actual exchange order',()=>{
 const f=feed(),quote=f.m.execution(Symbol,f.now);
 const result=Wallet.step(Wallet.initial(FIRST),{now:f.now,signals:[f.demo],quotes:{[Symbol]:quote},connected:true});
 assert.equal(result.events.length,1);
 assert.equal(result.events[0].type,'OPEN');
 assert.equal(result.account.ledger.open.notional,90);
 assert.equal(result.account.cash,100);
});
test('flat price, stale data, wrong-side trade flow and excessively wide spreads remain blocked',()=>{
 const flat=feed(.0001);
 assert.notEqual(flat.demo.state,'WATCH');
 const stale=feed();assert.equal(Demo.evaluate(stale.m.observation(Symbol,stale.now+3000)).state,'NO_DATA');
 const opposite=feed(.005,{volumeSide:'Sell'});assert.notEqual(opposite.demo.state,'WATCH');
 const wide=feed(.005,{spread:.08});assert.notEqual(wide.demo.state,'WATCH');
 const missing=feed(.005,{trades:false});assert.notEqual(missing.demo.state,'WATCH');
});
test('production website uses real-only seconds review, never experimental Demo micro-entry rules',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const demo=fs.readFileSync(path.join(root,'static/demo-seconds-lab.js'),'utf8');
 const real=fs.readFileSync(path.join(root,'static/seconds-lab.js'),'utf8');
 assert.ok(!index.includes('/static/demo-seconds-lab.js'));
 assert.ok(!index.includes('/static/demo-seconds-signals.js'));
 assert.ok(!index.includes('id="demo-seconds-lab"'));
 assert.ok(real.includes("mode:'live_small'"));
 assert.ok(!real.includes('OmegaDemoSecondsSignals'));
 assert.ok(!real.includes('DEMO_EXPLORATORY_RESEARCH'));
 assert.ok(!demo.includes('/v5/order/create'));
});
