'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Guard=require('../static/demo-seconds-guard');
const Intelligence=require('../static/demo-scalp-intelligence');
const Account=require('../static/demo-seconds-account');
const Shadow=require('../static/seconds-shadow');
const Portfolio=require('../lib/live-portfolio');
const now=Date.UTC(2026,10,3,8,30);
const symbol='SOLUSDT';
function history(rangeBps=12,at=now){
 const radius=100*rangeBps/10000/2;
 return Array.from({length:61},(_,i)=>({
  s:Math.floor(at/1000)-60+i,mid:100+radius*Math.sin(i/9.5)
 }));
}
const signal={symbol,side:'BUY',state:'WATCH',score:84,spreadBps:1.1,
 roundTripImpactBps:2.2,requiredMoveBps:69.2,
 move5Bps:2.5,move15Bps:6.2,range30Bps:10,
 flowPressure:.55,imbalance:.20,reasons:[]};
const quote=t=>({symbol,notional:100,bidVwap:99.99,askVwap:100.01,
 observedAt:t,requiredMoveBps:69.2});
test('Demo Scalper accepts 12bp one-minute activity for research, after two *distinct* confirmed seconds',()=>{
 const intel=Intelligence.create(),wallet=Account.smallInitial(now);
 const seen=[];
 for(let i=0;i<2;i++){
  const t=now+i*1000,h=history(12,t);
  const gated=Guard.filter(signal,h,t);
  assert.equal(gated.state,'WATCH',gated.reason);
  const found=intel.update([gated],{[symbol]:h},[],t).signals[0];
  seen.push(found.state);
  if(i===0)assert.equal(Account.step(wallet,{now:t,signals:[found],
   quotes:{[symbol]:quote(t)}}).events.length,0);
  else{
   const entered=Account.step(wallet,{now:t,signals:[found],
    quotes:{[symbol]:quote(t)}});
   assert.equal(entered.events.filter(e=>e.type==='OPEN').length,1);
   assert.equal(Shadow.openList(entered.account.ledger)[0].notional,100);
   assert.equal(entered.account.cash,1500);
  }
 }
 assert.deepEqual(seen,['WAIT','WATCH']);
});
test('Demo keeps stale, flat, expensive, and invalid signals blocked, without inventing a trade',()=>{
 const stale=Guard.filter(signal,history(12,now),now+30000);
 assert.equal(stale.state,'WAIT');
 assert.match(stale.reason,/fresh/);
 const flat=Guard.filter(signal,history(3),now);
 assert.equal(flat.state,'WAIT');
 assert.match(flat.reason,/Observed 60s range/);
 assert.equal(Guard.filter({...signal,spreadBps:4},history(12),now).state,'WAIT');
 assert.equal(Guard.filter({...signal,roundTripImpactBps:9},history(12),now).state,'WAIT');
 const wallet=Account.smallInitial(now),result=Account.step(wallet,{now,signals:[],quotes:{[symbol]:quote(now)}});
 assert.equal(result.events.length,0);
 assert.equal(result.account.ledger.closed.length,0);
});
test('Real Scalper remains funded-only and does not bypass $100 position risk on $88 equity',()=>{
 assert.equal(Portfolio.PER_ORDER_USD,100);
 assert.throws(()=>Portfolio.validate({equity:88,available:88,pnlToday:0,positions:[],pending:[]}),
  /Insufficient remaining total exposure/);
});
test('10 selected pairs and reliable waiting reasons are exposed on both scalp desks',()=>{
 const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
 const html=read('index.html'),demo=read('static/demo-seconds-lab.js'),
  real=read('static/seconds-lab.js'),armed=read('static/live-scalper.js');
 assert.ok(html.includes('BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,DOGEUSDT,BNBUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,SUIUSDT'));
 assert.ok(html.includes('id="demo-scalper-readiness"'));
 assert.match(demo,/reportReadiness\(results,now\)/);
 assert.match(demo,/Leading reason/);
 assert.match(real,/omega:scalp-health/);
 assert.match(armed,/SCALPER ARMED, WAITING/);
 assert.match(armed,/A market WATCH is not permission to trade/);
});
