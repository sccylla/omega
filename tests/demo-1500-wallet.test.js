'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const E=require('../lib/paper-engine'),Demo=require('../static/demo-seconds-account');
const Shadow=require('../static/seconds-shadow'),{validateAccount}=require('../lib/paper-store');
const NOW=Date.UTC(2026,10,3,10,0,0);
test('new Demo Scalper and Futures wallets each start with $1500 virtual funds',()=>{
 const future=E.initial(),scalp=Demo.smallInitial(NOW),legacy=Demo.initial(NOW);
 for(const x of [future,scalp,legacy]){
  assert.equal(x.starting,1500);
  assert.equal(x.cash,1500);
  assert.equal(x.dayStartEquity,1500);
  assert.equal(x.demoFundingVersion,2);
 }
 assert.equal(E.INITIAL,1500);
 assert.equal(Demo.SMALL_INITIAL_USD,1500);
 assert.equal(Demo.INITIAL_USD,1500);
 assert.equal(Demo.SMALL_TRADE_USD,8);
});
test('old Futures account retains existing closed trades and open positions, and migrates once',()=>{
 const old={...E.initial(),demoFundingVersion:undefined,starting:100,cash:117.25,dayStartEquity:110};
 old.positions=[{symbol:'BTC',side:'BUY',id:'demo-old-1',entry:100,qty:1,notional:100,
  entryFee:.06,stop:98,target:110,openedAt:NOW-20000,auto:false}];
 old.closed=[{id:'old-closed',symbol:'BTC',side:'BUY',entry:98,exit:103,
  notional:100,openedAt:NOW-80000,closedAt:NOW-60000,net:5,netRaw:5,reason:'Virtual profit'}];
 const first=E.restore(old),second=E.restore(first),reread=E.restore(JSON.parse(JSON.stringify(second)));
 assert.equal(first.cash,1517.25);
 assert.equal(first.starting,1500);
 assert.equal(first.dayStartEquity,1510);
 assert.equal(first.positions[0].id,'demo-old-1');
 assert.equal(first.closed[0].id,'old-closed');
 assert.equal(second.cash,1517.25);
 assert.equal(reread.cash,1517.25);
 assert.equal(E.equity(reread,{BTC:100}),1517.25);
 const cloud=validateAccount(old);
 assert.equal(cloud.cash,1517.25);
 assert.equal(cloud.closed[0].id,'old-closed');
 assert.equal(validateAccount(cloud).cash,1517.25);
});
test('old $88 Scalper wallet preserves simulated historical P&L and incomplete/open trades',()=>{
 const old=Demo.smallInitial(NOW);
 old.demoFundingVersion=undefined;old.starting=88;old.cash=90.75;old.dayStartEquity=88;
 old.closedTrades=2;old.wins=1;old.ledger.incomplete=3;
 old.ledger.closed=[{symbol:'BTCUSDT',side:'BUY',net:2.75,closedAt:NOW-10000,
  openedAt:NOW-12000,reason:'Old virtual trade',entry:100,exit:100.5}];
 const migrated=Demo.restore(old,NOW,Demo.SMALL_VERSION);
 assert.equal(migrated.cash,1502.75);
 assert.equal(migrated.dayStartEquity,1500);
 assert.equal(migrated.starting,1500);
 assert.equal(migrated.closedTrades,2);
 assert.equal(migrated.wins,1);
 assert.equal(migrated.ledger.incomplete,3);
 assert.equal(migrated.ledger.closed[0].symbol,'BTCUSDT');
 assert.equal(Demo.stats(migrated,NOW).totalNetUsd,2.75);
 assert.equal(Demo.restore(migrated,NOW,Demo.SMALL_VERSION).cash,1502.75);
});
test('old $100 legacy scalp wallet also migrates to $1500 without double credit',()=>{
 const old=Demo.initial(NOW);
 old.demoFundingVersion=undefined;old.starting=100;old.cash=103.5;old.dayStartEquity=99.5;
 const funded=Demo.restore(old,NOW,Demo.VERSION);
 assert.equal(funded.cash,1503.5);
 assert.equal(funded.dayStartEquity,1499.5);
 assert.equal(funded.starting,1500);
 assert.equal(Demo.restore(funded,NOW,Demo.VERSION).cash,1503.5);
});
test('website visibly identifies both demo wallets as $1500, but does not relabel live $88',()=>{
 const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(html,/SCALPER · VIRTUAL \$1,500 ACCOUNT/);
 assert.match(html,/FUTURES TRADER · VIRTUAL \$1,500 ACCOUNT/);
 assert.match(html,/Starting balance \$1,500\.00/);
 assert.match(html,/Trade with your \$88 account/);
 assert.ok(!html.includes('SCALPER · VIRTUAL $88 ACCOUNT'));
});
