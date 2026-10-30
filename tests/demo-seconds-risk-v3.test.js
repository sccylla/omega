'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Intelligence=require('../static/demo-scalp-intelligence');
const Wallet=require('../static/demo-seconds-account');
const t=Date.UTC(2026,9,30,14,0,0);
const symbol='BTCUSDT';
const candidate=(side='BUY')=>({symbol,state:'WATCH',side,score:88,requiredMoveBps:70,
 move5Bps:11,move15Bps:16,spreadBps:1,flowPressure:.6,imbalance:.2,reasons:[]});
function prices(now,endFraction=.5){
 const start=100,low=start,high=101,sec=Math.floor(now/1000);
 return Array.from({length:61},(_,i)=>({s:sec-60+i,mid:i===60?low+endFraction:low+i/60}));
}
const quote=(now,bid=99.99,ask=100.01)=>({symbol,bidVwap:bid,askVwap:ask,observedAt:now,notional:90,requiredMoveBps:70});
test('negative outcome evidence quarantines the losing direction after short cooldowns expire',()=>{
 const closed=Array.from({length:6},(_,i)=>({symbol,side:'BUY',net:-.6,closedAt:t+i*1000,
  openedAt:t+(i-1)*1000,fees:.10,slippage:.036}));
 const now=t+75*60000,a=Intelligence.audit(closed,now);
 assert.equal(a.globalPauseUntil,0);
 assert.equal(a.markets[0].quarantineUntil,0);
 assert.ok(a.directions.find(x=>x.symbol===symbol&&x.side==='BUY').quarantineUntil>now);
 const s=Intelligence.create().update([candidate()],{[symbol]:prices(now)},closed,now).signals[0];
 assert.equal(s.state,'WAIT');
 assert.match(s.reason,/six-hour risk cooldown/);
 const other=Intelligence.create().update([candidate('SELL')],{[symbol]:prices(now)},closed,now).signals[0];
 assert.doesNotMatch(other.reason,/six-hour risk cooldown/);
});
test('conservative 60-second chase rule rejects long at upper 85 percent extreme',()=>{
 const now=t+100000,gate=Intelligence.create(),history=prices(now,.87);
 const r=gate.update([candidate()],{[symbol]:history},[],now).signals[0];
 assert.equal(r.state,'WAIT');
 assert.match(r.reason,/Late long/);
});
test('unpriced open position is not silently displayed as verified equity',()=>{
 const first=Wallet.step(Wallet.initial(t),{now:t,signals:[candidate()],
  quotes:{[symbol]:quote(t)},connected:true});
 assert.equal(first.events[0].type,'OPEN');
 const missing=Wallet.stats(first.account,t+1000);
 assert.equal(missing.wallet,100);
 assert.equal(missing.estimatedEquity,null);
 assert.equal(missing.openMarkPriced,false);
 const priced=Wallet.stats(first.account,t+1000,{[symbol]:quote(t+1000,100.19,100.21)});
 assert.equal(priced.openMarkPriced,true);
 assert.ok(priced.unrealizedNetUsd>0);
 assert.ok(priced.estimatedEquity>100);
 const stale=Wallet.stats(first.account,t+5000,{[symbol]:quote(t+1000,100.19,100.21)});
 assert.equal(stale.estimatedEquity,null);
});
test('marked equity includes modeled executable spread, taker fees and slippage',()=>{
 const entered=Wallet.step(Wallet.initial(t),{now:t,signals:[candidate()],
  quotes:{[symbol]:quote(t)},connected:true}).account;
 const marked=Wallet.stats(entered,t+1000,{[symbol]:quote(t+1000)});
 assert.ok(marked.estimatedEquity<100);
 assert.ok(marked.unrealizedNetUsd<0);
});
