'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Guard=require('../static/demo-seconds-guard');
const Shadow=require('../static/seconds-shadow');
const Demo=require('../static/demo-seconds-account');
const fs=require('node:fs'),path=require('node:path');
const ORIGIN=Date.UTC(2026,9,30,15,0,0),SYMBOL='BTCUSDT';
function candidate(){return {symbol:SYMBOL,state:'WATCH',side:'BUY',score:90,spreadBps:1,
 roundTripImpactBps:3,requiredMoveBps:71,reason:'Qualified momentum',reasons:[]}}
function history(start=100,step=.05,now=ORIGIN+61000){
 const s=Math.floor(now/1000);
 return Array.from({length:61},(_,i)=>({s:s-60+i,mid:start+i*step}));
}
function book(now,bid,ask){return {symbol:SYMBOL,observedAt:now,bidVwap:bid,askVwap:ask,notional:90}}
function enter(now=ORIGIN+100){
 const out=Demo.step(Demo.initial(now),{now,signals:[candidate()],quotes:{[SYMBOL]:book(now,99.99,100.01)},connected:true});
 assert.equal(out.events[0].type,'OPEN');return out.account;
}
test('Guard blocks flat movement even when experimental 8bp entry impulse qualifies',()=>{
 const now=ORIGIN+61000,q=Guard.filter(candidate(),history(100,.001,now),now);
 assert.equal(q.state,'WAIT');assert.match(q.reason,/range/);
 assert.equal(q.side,null);assert.ok(q.feasibilityThresholdBps>=22);
});
test('Guard permits strong observed 60s movement with low spread and cost, never guarantees win',()=>{
 const now=ORIGIN+61000,q=Guard.filter(candidate(),history(100,.05,now),now);
 assert.equal(q.state,'WATCH');assert.equal(q.side,'BUY');
 assert.match(q.meaning,/not a forecast/);assert.ok(q.feasibilityBps>q.feasibilityThresholdBps);
});
test('Guard rejects missing history and expensive execution',()=>{
 const now=ORIGIN+61000;
 assert.match(Guard.filter(candidate(),[],now).reason,/60 seconds/);
 assert.equal(Guard.filter({...candidate(),spreadBps:3},history(100,.05,now),now).state,'WAIT');
 assert.equal(Guard.filter({...candidate(),roundTripImpactBps:12},history(100,.05,now),now).state,'WAIT');
});
test('New Demo keeps a virtual scalp open past 45 and 180 seconds until an actual price or protective exit',()=>{
 const start=ORIGIN+100,a=enter(start);
 const halfway=Demo.step(a,{now:start+50000,signals:[],quotes:{[SYMBOL]:book(start+50000,99.99,100.01)},connected:true});
 assert.equal(halfway.account.ledger.open.symbol,SYMBOL);
 assert.equal(halfway.account.closedTrades,0);
 const end=Demo.step(halfway.account,{now:start+180001,signals:[],quotes:{[SYMBOL]:book(start+180001,99.99,100.01)},connected:true});
 assert.equal(end.account.closedTrades,0);
 assert.equal(end.events.length,0);
 assert.equal(end.account.ledger.open.symbol,SYMBOL);
});
test('Old strict research shadow still times out at 45 seconds, independent from Demo',()=>{
 const now=ORIGIN+100,s=Shadow.step(Shadow.init(),{now,signals:[candidate()],quotes:{[SYMBOL]:book(now,99.99,100.01)},connected:true});
 const out=Shadow.step(s.state,{now:now+45000,signals:[],quotes:{[SYMBOL]:book(now+45000,99.99,100.01)},connected:true});
 assert.equal(out.events[0].type,'CLOSED');
 assert.match(out.events[0].trade.reason,/45s time limit/);
});
test('New virtual fill records gross profit, fees, slippage and correct net wins/losses',()=>{
 const now=ORIGIN+100,a=enter(now);
 const out=Demo.step(a,{now:now+1000,signals:[],quotes:{[SYMBOL]:book(now+1000,101,101.02)},connected:true});
 const t=out.events[0].trade;
 assert.ok(t.gross>0&&t.fees>0&&t.slippage>0);
 assert.equal(Number((t.gross-t.fees-t.slippage).toFixed(4)),t.net);
 assert.equal(out.account.wins,1);assert.equal(out.account.closedTrades,1);
});
test('Production Demo loads only Demo guard and preserves prior losses and $90 size',()=>{
 const root=path.resolve(__dirname,'..');
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const client=fs.readFileSync(path.join(root,'static/demo-seconds-lab.js'),'utf8');
 const real=fs.readFileSync(path.join(root,'static/seconds-lab.js'),'utf8');
 assert.ok(index.includes('src="/static/demo-seconds-guard.js"'));
 assert.ok(client.includes('G.filter(X.evaluate(engine.observation(s,now)),engine.history(s),now)'));
 assert.ok(index.includes('LIFETIME WIN RATE (ALL VERSIONS)'));
 assert.ok(client.includes("const KEY='omega_demo_seconds_wallet_v1'"));
 assert.ok(!real.includes('OmegaDemoScalpGuard'));
 assert.equal(Demo.TRADE_USD,90);
});
