'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const A=require('../static/demo-seconds-account');
const E=require('../static/seconds-engine');
const S=require('../static/seconds-shadow');
const TIME=Date.UTC(2026,9,30,15,0,0),SYMBOL='BTCUSDT';
function book(time,bid=99.99,ask=100.01){return {symbol:SYMBOL,bidVwap:bid,askVwap:ask,observedAt:time,notional:90,requiredMoveBps:80}}
function signal(){return {symbol:SYMBOL,state:'WATCH',side:'BUY',score:95}}
function open(wallet,time){
 const out=A.step(wallet,{now:time,signals:[signal()],quotes:{[SYMBOL]:book(time)},connected:true});
 assert.equal(out.events.length,1);assert.equal(out.events[0].type,'OPEN');
 return out.account;
}
function close(wallet,time,{bid=101,ask=101.02}={}){
 const out=A.step(wallet,{now:time,signals:[],quotes:{[SYMBOL]:book(time,bid,ask)},connected:true});
 assert.equal(out.events.length,1);assert.equal(out.events[0].type,'CLOSED');
 return out;
}
test('seconds Demo opens with its own $100 practice wallet and $90 position policy',()=>{
 const a=A.initial(TIME),stats=A.stats(a,TIME);
 assert.equal(stats.wallet,100);assert.equal(stats.totalNetUsd,0);
 assert.equal(A.TRADE_USD,90);assert.equal(A.INITIAL_USD,100);
 assert.equal(A.DAILY_LOSS_FRACTION,.02);
 assert.equal(a.ledger.closed.length,0);
 assert.equal(A.eligibility(a,TIME).allowed,true);
});
test('seconds Demo virtual profits credit its wallet and losses debit it, not the standard OmegaPaper ledger',()=>{
 const start=A.initial(TIME),position=open(start,TIME+100);
 const settled=close(position,TIME+1100,{bid:101,ask:101.02});
 assert.ok(settled.events[0].trade.net>=.50);
 assert.ok(settled.account.cash>100);
 assert.equal(settled.account.closedTrades,1);
 assert.equal(settled.account.wins,1);
 assert.equal(A.stats(settled.account,TIME+1100).totalNetUsd,Number((settled.account.cash-100).toFixed(2)));
 const losing=close(open(A.initial(TIME),TIME+100),TIME+1100,{bid:98.5,ask:98.52});
 assert.ok(losing.events[0].trade.net<=-.75);
 assert.ok(losing.account.cash<100);
 assert.equal(losing.account.wins,0);
 assert.equal(losing.account.closedTrades,1);
 const paper=require('../static/paper-engine');
 assert.equal(paper.MIN_NOTIONAL_USD,100);
 assert.equal(paper.initial().cash,100);
});
test('two adverse seconds scalp outcomes trigger the separate 2 percent Demo daily loss stop',()=>{
 let a=A.initial(TIME);
 a=close(open(a,TIME+100),TIME+1100,{bid:98.5,ask:98.52}).account;
 assert.equal(A.eligibility(a,TIME+1200).allowed,true);
 a=close(open(a,TIME+25000),TIME+26000,{bid:98.5,ask:98.52}).account;
 assert.equal(A.eligibility(a,TIME+27000).allowed,false);
 assert.match(A.eligibility(a,TIME+27000).reason,/2%/);
 const attempted=A.step(a,{now:TIME+46000,signals:[signal()],quotes:{[SYMBOL]:book(TIME+46000)},connected:true});
 assert.equal(attempted.events.length,0);
 assert.equal(attempted.account.ledger.open,null);
});
test('disconnected feed never awards a profitable exit, and interrupted virtual trades remain incomplete',()=>{
 const opened=open(A.initial(TIME),TIME+100);
 const interrupted=A.interrupt(opened,TIME+9000);
 assert.equal(interrupted.cash,100);
 assert.equal(interrupted.closedTrades,0);
 assert.equal(interrupted.ledger.incomplete,1);
 assert.equal(interrupted.ledger.open,null);
 const disconnected=A.step(opened,{now:TIME+4100,connected:false,signals:[],quotes:{}});
 assert.equal(disconnected.account.cash,100);
 assert.equal(disconnected.account.closedTrades,0);
 assert.equal(disconnected.events[0].type,'INCOMPLETE');
});
test('wallet cash cannot reset on rollover of the bounded trade history',()=>{
 const sample=A.initial(TIME);
 sample.cash=99.13;sample.closedTrades=201;sample.wins=99;
 sample.ledger.closed=Array.from({length:200},(_,i)=>({symbol:SYMBOL,net:-.01,closedAt:TIME+i}));
 const restored=A.restore(sample,TIME+1000);
 assert.equal(restored.cash,99.13);
 assert.equal(A.stats(restored,TIME+1000).totalNetUsd,-.87);
 assert.equal(restored.closedTrades,201);
});
test('archived Demo seconds simulator is not mounted in Real or Demo webpages',()=>{
 const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.ok(!html.includes('id="demo-seconds-lab"'));
 assert.ok(!html.includes('/static/demo-seconds-lab.js'));
 assert.ok(html.includes('id="seconds-lab"'));
 assert.ok(html.indexOf('id="seconds-lab"')>html.indexOf('id="view-real"'));
});
