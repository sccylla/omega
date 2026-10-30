'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Account=require('../static/demo-seconds-account');
const Shadow=require('../static/seconds-shadow');
const Engine=require('../static/seconds-engine');
const NOW=Date.UTC(2026,9,30,17,0,0),S='BTCUSDT';
const q=(t,bid=99.99,ask=100.01,notional=15)=>({symbol:S,bidVwap:bid,askVwap:ask,notional,observedAt:t,requiredMoveBps:52});
const signal={symbol:S,side:'BUY',state:'WATCH',score:90};
function open(account=Account.smallInitial(NOW),t=NOW+100){
 const r=Account.step(account,{now:t,signals:[signal],quotes:{[S]:q(t)},connected:true});
 assert.equal(r.events[0].type,'OPEN');
 return r.account;
}
test('new account has precisely $88 virtual funds, 1x $15 sizing and small net exits',()=>{
 const s=Account.smallInitial(NOW),v=Account.stats(s,NOW);
 assert.equal(s.version,Account.SMALL_VERSION);
 assert.equal(v.wallet,88);
 assert.equal(v.tradeNotional,15);
 assert.equal(v.targetNet,.05);
 assert.equal(v.stopNet,.08);
 assert.equal(v.dailyMaxLossUsd,1);
 assert.equal(Account.eligibility(s,NOW).allowed,true);
 const o=open(s).ledger.open;
 assert.equal(o.notional,15);
 assert.equal(o.targetNet,.05);
 assert.equal(o.stopNet,.08);
});
test('small account settles after estimated $0.05 net rather than legacy $0.50',()=>{
 const t=NOW+100,account=open(Account.smallInitial(NOW),t);
 const out=Account.step(account,{now:t+1000,quotes:{[S]:q(t+1000,100.7,100.72)},connected:true});
 assert.equal(out.events[0].type,'CLOSED');
 assert.ok(out.events[0].trade.net>=.05);
 assert.equal(out.events[0].trade.notional,15);
 assert.match(out.events[0].trade.reason,/\$0\.05 net TP/);
 assert.ok(out.events[0].trade.fees>0&&out.events[0].trade.slippage>0);
 assert.equal(Account.stats(out.account,t+1000).closedTrades,1);
 assert.ok(out.account.cash>88);
});
test('small account retains protective -$0.08 stop and no forced 45-second time exit',()=>{
 const t=NOW+100,a=open(Account.smallInitial(NOW),t);
 const held=Account.step(a,{now:t+180000,quotes:{[S]:q(t+180000)},connected:true});
 assert.equal(held.account.ledger.open.notional,15);
 assert.equal(held.events.length,0);
 const stopped=Account.step(held.account,{now:t+181000,quotes:{[S]:q(t+181000,99.3,99.32)},connected:true});
 assert.equal(stopped.events[0].type,'CLOSED');
 assert.ok(stopped.events[0].trade.net<=-.08);
 assert.match(stopped.events[0].trade.reason,/\$0\.08 loss trigger/);
});
test('a $1 closed daily loss prevents new positions but does not erase cash/history',()=>{
 const s=Account.smallInitial(NOW);
 const blocked={...s,cash:86.99,dayStartEquity:88};
 assert.equal(Account.eligibility(blocked,NOW).allowed,false);
 assert.match(Account.eligibility(blocked,NOW).reason,/daily loss limit/);
 assert.equal(Account.stats(blocked,NOW).wallet,86.99);
});
test('legacy $100 demo still runs identical $90 sizing and $0.50 net exits',()=>{
 const s=Account.initial(NOW),openLegacy=Account.step(s,{now:NOW+100,signals:[signal],
  quotes:{[S]:q(NOW+100,99.99,100.01,90)},connected:true});
 assert.equal(Account.stats(s,NOW).wallet,100);
 assert.equal(openLegacy.events[0].type,'OPEN');
 assert.equal(openLegacy.account.ledger.open.notional,90);
 assert.equal(openLegacy.account.ledger.open.targetNet,.50);
 assert.equal(openLegacy.account.ledger.open.stopNet,.75);
 assert.equal(Account.TRADE_USD,90);
});
test('small $15 execution quote uses $0.05 target without changing default $90 research settings',()=>{
 const book={topic:'orderbook.50.'+S,ts:NOW,type:'snapshot',data:{s:S,u:1,seq:1,
  b:[['99.99','1000']],a:[['100.01','1000']]}};
 const small=Engine.create([S],{notional:15,goalNet:.05});
 const legacy=Engine.create([S]);
 assert.equal(small.ingest(book,NOW),true);
 assert.equal(legacy.ingest(book,NOW),true);
 assert.equal(small.execution(S,NOW).notional,15);
 assert.equal(legacy.execution(S,NOW).notional,90);
 assert.ok(small.execution(S,NOW).requiredMoveBps<legacy.execution(S,NOW).requiredMoveBps);
 assert.equal(Engine.MIN_NOTIONAL,90);
});
test('UI defaults to independent $88 wallet and preserves access to older $100 virtual trade records',()=>{
 const root=path.resolve(__dirname,'..');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const client=fs.readFileSync(path.join(root,'static/demo-seconds-lab.js'),'utf8');
 assert.match(html,/id="demo-seconds-profile"/);
 assert.match(html,/value="small" selected/);
 assert.match(client,/omega_demo_seconds_wallet_88_v1/);
 assert.match(client,/omega_demo_seconds_wallet_v1/);
 assert.match(client,/let walletKey=SMALL_KEY/);
 assert.ok(!client.includes('/v5/order/create'));
});
