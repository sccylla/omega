'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Engine=require('../static/seconds-engine');
const Shadow=require('../static/seconds-shadow');
const Demo=require('../static/demo-seconds-account');
const PAIRS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','LINKUSDT','AVAXUSDT','BNBUSDT','LTCUSDT','TRXUSDT','SUIUSDT','NEARUSDT','APTUSDT','ATOMUSDT','UNIUSDT','ETCUSDT','BCHUSDT','INJUSDT','ARBUSDT'];
const now=Date.UTC(2026,9,30,12,0),market={symbol:'BTCUSDT',bidVwap:99.98,askVwap:100.02,observedAt:now,notional:90};
const signal={symbol:'BTCUSDT',state:'WATCH',side:'BUY',score:91};
const quote=(t,bid,ask)=>({...market,observedAt:t,bidVwap:bid,askVwap:ask});
test('Demo can choose 20 independent futures symbols; funded research retains 5 symbol cap',()=>{
 assert.equal(Engine.validSymbols(PAIRS,{maxSymbols:20}).length,20);
 assert.equal(Engine.create(PAIRS,{maxSymbols:20}).symbols.length,20);
 assert.throws(()=>Engine.create(PAIRS),/1–5/);
 assert.throws(()=>Engine.validSymbols([...PAIRS,'PEPEUSDT'],{maxSymbols:20}),/1–20/);
 assert.throws(()=>Engine.validSymbols([...PAIRS.slice(0,19),'BTCUSDT'],{maxSymbols:20}),/unique/);
});
test('Demo $90 position does not time-out after 45, 180 or 1800 seconds',()=>{
 const t=now+100,open=Demo.step(Demo.initial(t),{now:t,signals:[signal],quotes:{BTCUSDT:quote(t,99.98,100.02)},connected:true});
 assert.equal(open.events[0].type,'OPEN');
 let wallet=open.account;
 for(const secs of [46,181,1801]){
  const at=t+secs*1000;
  const update=Demo.step(wallet,{now:at,signals:[],quotes:{BTCUSDT:quote(at,100.08,100.10)},connected:true});
  assert.equal(update.events.length,0);
  assert.equal(update.account.ledger.open.symbol,'BTCUSDT');
  wallet=update.account;
 }
 assert.equal(wallet.closedTrades,0);
});
test('Once estimated net exceeds $0.50, Demo closes then scans for another $90 trade after 3 seconds',()=>{
 const t=now+100;
 let wallet=Demo.step(Demo.initial(t),{now:t,signals:[signal],quotes:{BTCUSDT:quote(t,99.98,100.02)},connected:true}).account;
 const end=Demo.step(wallet,{now:t+1900000,signals:[],quotes:{BTCUSDT:quote(t+1900000,101,101.02)},connected:true});
 assert.equal(end.events[0].type,'CLOSED');
 assert.ok(end.events[0].trade.net>=.50);
 assert.equal(end.account.wins,1);
 const quick=Demo.step(end.account,{now:t+1901000,signals:[signal],quotes:{BTCUSDT:quote(t+1901000,99.98,100.02)},connected:true});
 assert.equal(quick.events.length,0);
 const next=Demo.step(quick.account,{now:t+1903001,signals:[signal],quotes:{BTCUSDT:quote(t+1903001,99.98,100.02)},connected:true});
 assert.equal(next.events[0].type,'OPEN');
 assert.equal(next.account.ledger.open.notional,90);
});
test('Negative price reversal stops Demo virtual position; it never waits for profit indefinitely after stop',()=>{
 const t=now+100,opened=Demo.step(Demo.initial(t),{now:t,signals:[signal],quotes:{BTCUSDT:quote(t,99.98,100.02)},connected:true}).account;
 const close=Demo.step(opened,{now:t+6000,signals:[],quotes:{BTCUSDT:quote(t+6000,98.1,98.12)},connected:true});
 assert.equal(close.events[0].type,'CLOSED');
 assert.ok(close.events[0].trade.net<=-.75);
 assert.equal(close.account.wins,0);
});
test('Real research shadow retains 45-second time exit unless explicitly disabled',()=>{
 const t=now+100,opened=Shadow.step(Shadow.init(),{now:t,signals:[signal],quotes:{BTCUSDT:quote(t,99.98,100.02)},connected:true});
 const close=Shadow.step(opened.state,{now:t+45000,signals:[],quotes:{BTCUSDT:quote(t+45000,99.98,100.02)},connected:true});
 assert.match(close.events[0].trade.reason,/45s time limit/);
});
test('Interrupted data marks an open trade incomplete and does not fabricate profit',()=>{
 const t=now+100,opened=Demo.step(Demo.initial(t),{now:t,signals:[signal],quotes:{BTCUSDT:quote(t,99.98,100.02)},connected:true}).account;
 const ended=Demo.step(opened,{now:t+6000,signals:[],quotes:{},connected:false});
 assert.equal(ended.events[0].type,'INCOMPLETE');
 assert.equal(ended.account.closedTrades,0);
});
test('real-only seconds selector uses 20-market batched subscriptions without funded order calls',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
 const code=fs.readFileSync(path.join(root,'static/seconds-lab.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(code,/topics\.slice\(i,i\+10\)/);
 assert.match(code,/maxSymbols:MAX_PAIRS/);
 assert.match(html,/up to 20, USDT perpetual/);
 assert.ok(html.indexOf('id="seconds-lab"')>html.indexOf('id="view-real"'));
 assert.ok(!html.includes('id="demo-seconds-lab"'));
 assert.ok(!code.includes('/v5/order/create'));
});
