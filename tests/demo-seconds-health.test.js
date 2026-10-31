'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../static/seconds-engine');
const t=Date.UTC(2026,9,30,18,0,0),symbol='BTCUSDT';
function book(at,i=1){
 const p=100+i*.01;
 return {topic:'orderbook.50.'+symbol,ts:at,type:'snapshot',
  data:{s:symbol,u:i,seq:i,b:[[String(p-.01),'800']],a:[[String(p+.01),'800']]}};
}
function trade(at,i=1){
 return {topic:'publicTrade.'+symbol,ts:at,type:'snapshot',
  data:[{T:at,s:symbol,S:'Buy',v:'10',p:'100',i:'test-'+i}]};
}
test('scanner health distinguishes no books, valid books, stale trades and warming history',()=>{
 const e=E.create([symbol]),empty=e.diagnostics(symbol,t);
 assert.equal(empty.executable,false);
 assert.match(empty.reason,/No valid orderbook/);
 e.ingest(book(t),t);
 const first=e.diagnostics(symbol,t);
 assert.equal(first.executable,true);
 assert.equal(first.acceptedBooks,1);
 assert.match(first.reason,/No accepted public trades/);
 e.ingest(trade(t),t);
 const warm=e.diagnostics(symbol,t+100);
 assert.equal(warm.acceptedTrades,1);
 assert.match(warm.reason,/Collecting 60-second/);
 for(let i=1;i<=62;i++){e.ingest(book(t+i*1000,i+1),t+i*1000);e.ingest(trade(t+i*1000,i+1),t+i*1000)}
 const ready=e.diagnostics(symbol,t+62000);
 assert.equal(ready.executable,true);
 assert.ok(ready.historySpanSeconds>=58);
 assert.match(ready.reason,/ready/);
 const stale=e.diagnostics(symbol,t+66000);
 assert.equal(stale.executable,false);
 assert.match(stale.reason,/Stale/);
});
test('demo client exposes per-pair market data health and protects real-money execution',()=>{
 const root=path.resolve(__dirname,'..');
 const client=fs.readFileSync(path.join(root,'static/demo-seconds-lab.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(client,/engine\.diagnostics\(s,now\)/);
 assert.match(client,/valid executable order books/);
 assert.match(client,/pairs with recent trade flow/);
 assert.match(client,/ENTRIES BLOCKED/);
 assert.match(client,/processing error/);
 assert.match(html,/BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,DOGEUSDT,BNBUSDT/);
 assert.match(html,/up to 20, USDT perpetual/);
 assert.ok(html.includes('id="seconds-check"'));
 assert.ok(!html.includes('id="demo-seconds-lab"'));
 assert.ok(!client.includes('/v5/order/create'));
 assert.ok(!client.includes('BYBIT_LIVE_API_KEY'));
});
