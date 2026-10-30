'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Engine=require('../static/seconds-engine');
const Signals=require('../static/demo-seconds-signals');
const Guard=require('../static/demo-seconds-guard');
const Intelligence=require('../static/demo-scalp-intelligence');
const Wallet=require('../static/demo-seconds-account');
const BASE=Date.UTC(2026,9,30,14,0,0),SYMBOL='BTCUSDT';

test('60s liquid pullback/reacceleration can result in an actual demo virtual OPEN',()=>{
 const engine=Engine.create([SYMBOL]),intel=Intelligence.create();let wallet=Wallet.initial(BASE),openCount=0;
 for(let i=0;i<=64;i++){
  const t=BASE+i*1000,p=100+(i<=20?.30*i/20:i<=45?.30-.20*(i-20)/25:.10+(i-45)*.008);
  const bid=(p-.005).toFixed(5),ask=(p+.005).toFixed(5);
  assert.equal(engine.ingest({topic:'orderbook.50.'+SYMBOL,ts:t,type:'snapshot',
   data:{s:SYMBOL,u:i+1,seq:i+1,b:[[bid,'1000']],a:[[ask,'350']]}},t),true);
  assert.equal(engine.ingest({topic:'publicTrade.'+SYMBOL,ts:t,type:'snapshot',
   data:[{s:SYMBOL,S:'Buy',T:t,p:p.toFixed(5),v:'20',i:'trade-'+i}]},t),true);
  if(i<60)continue;
  const now=t+100,raw=engine.observation(SYMBOL,now),pre=Guard.filter(Signals.evaluate(raw),engine.history(SYMBOL),now);
  const selected=intel.update([pre],{[SYMBOL]:engine.history(SYMBOL)},wallet.ledger.closed,now).signals[0];
  const output=Wallet.step(wallet,{now,signals:[selected],quotes:{[SYMBOL]:engine.execution(SYMBOL,now)},connected:true});
  wallet=output.account;openCount+=output.events.filter(e=>e.type==='OPEN').length;
 }
 assert.equal(openCount,1,'A representative valid setup should no longer be made impossible by entry rules');
 assert.equal(wallet.ledger.open.symbol,SYMBOL);
 assert.equal(wallet.ledger.open.notional,90);
 assert.equal(wallet.closedTrades,0);
 assert.equal(wallet.cash,100);
});
test('the scalper reconnect path cannot submit real orders, fabricate offline exits, or retry unbounded',()=>{
 const code=fs.readFileSync(path.resolve(__dirname,'../static/demo-seconds-lab.js'),'utf8');
 assert.match(code,/function recover\(reason,id=epoch\)/);
 assert.match(code,/A\.interrupt\(wallet\)/);
 assert.match(code,/retryCount>6/);
 assert.match(code,/No fresh Bybit order book or matched trade updates/);
 assert.ok(!code.includes('/v5/order/create'));
 assert.ok(!code.includes('BYBIT_LIVE_API_KEY'));
});
