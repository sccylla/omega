'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Shadow=require('../static/seconds-shadow'),Demo=require('../static/demo-seconds-account');
const Paper=require('../static/paper-engine'),Portfolio=require('../lib/live-portfolio');
const now=1800000005000;
const quote=(symbol,price=100)=>({symbol,observedAt:now,askVwap:price+.01,bidVwap:price-.01,notional:100,requiredMoveBps:70});
const names=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','BNBUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','LTCUSDT'];
const signals=names.map((symbol,i)=>({symbol,state:'WATCH',side:'BUY',score:90-i,qualityVeto:'DEMO_INTELLIGENCE_V1'}));
const quotes=Object.fromEntries(names.map(s=>[s,quote(s)]));
test('Demo scalper can fund ten separate $100 1x positions on its $1500 wallet',()=>{
 let w=Demo.smallInitial(now);
 assert.equal(w.cash,1500);assert.equal(Demo.SMALL_TRADE_USD,100);
 const out=Demo.step(w,{now,signals,quotes,connected:true});w=out.account;
 assert.equal(Shadow.openList(w.ledger).length,10);
 assert.equal(out.events.filter(x=>x.type==='OPEN').length,10);
 assert.equal(new Set(Shadow.openList(w.ledger).map(p=>p.symbol)).size,10);
 assert.equal(Shadow.openList(w.ledger).reduce((s,p)=>s+p.notional,0),1000);
 assert.equal(Demo.stats(w,now,quotes).openCount,10);
 const refused=Demo.step(w,{now:now+1000,signals,quotes,connected:true});
 assert.equal(refused.events.filter(x=>x.type==='OPEN').length,0);
});
test('Demo scalper closes only observed qualifying exits, never fabricates fills',()=>{
 let w=Demo.step(Demo.smallInitial(now),{now,signals,quotes,connected:true}).account;
 const changed=Object.fromEntries(names.map(s=>[s,quote(s,103)]));
 const out=Demo.step(w,{now:now+1500,signals:[],quotes:changed,connected:true});
 assert.equal(out.events.filter(x=>x.type==='CLOSED').length,10);
 assert.equal(Shadow.openList(out.account.ledger).length,0);
 assert.equal(out.account.closedTrades,10);
 assert.equal(out.account.wins,10);
 const next=Demo.step(Demo.smallInitial(now),{now,signals,quotes,connected:true}).account;
 const interrupted=Demo.interrupt(next,now+2000);
 assert.equal(Shadow.openList(interrupted.ledger).length,0);
 assert.equal(interrupted.ledger.incomplete,10);
 assert.equal(interrupted.closedTrades,0);
});
test('Demo Futures Trader permits ten fully funded $100 auto positions but not eleven',()=>{
 let a=Paper.initial();
 assert.equal(Paper.MAX_POSITIONS,10);
 for(let i=0;i<10;i++){
  const symbol='COIN'+i;
  a=Paper.open(a,{[symbol]:1},{symbol,side:'BUY',notional:100,auto:true,targetNet:.05,stopPct:1.5});
 }
 assert.equal(a.positions.length,10);
 assert.equal(a.positions.reduce((s,p)=>s+p.notional,0),1000);
 assert.throws(()=>Paper.open(a,{COIN10:1},{symbol:'COIN10',side:'BUY',notional:100,auto:true}),/10 demo position slots/);
 assert.throws(()=>Paper.open(Paper.initial(),{XYZ:1},{symbol:'XYZ',side:'BUY',notional:99.99,auto:true}),/\$100/);
 assert.throws(()=>Paper.open(Paper.initial(),{XYZ:1},{symbol:'XYZ',side:'BUY',notional:10}),/\$100/);
});
const protectedPos=(symbol,side='Buy')=>({symbol,side,size:'0.15',avgPrice:'100',markPrice:'100',
 stopLoss:side==='Buy'?'99.7':'100.3',takeProfit:side==='Buy'?'100.7':'99.3',positionIdx:0});
const liveSnapshot=(positions=[],equity=800,available=800)=>({positions,pending:[],equity,available,pnlToday:0});
const ticket=symbol=>({symbol,side:'Buy',qty:'0.15',price:100,notional:15,
 stopLoss:'99.7',takeProfit:'100.7',estimatedRoundTripCostRate:.0022,estimatedTakeProfitNetUsd:.056});
test('Real account allows a $100 order only when equity and aggregate risk can afford it',()=>{
 const funded=liveSnapshot([],800,800);
 const old=ticket('XRPUSDT'),next={...old,qty:'1',price:100,notional:100,stopLoss:'99.7'};
 const result=Portfolio.validate(funded,{symbol:'XRPUSDT',ticket:next});
 assert.equal(Portfolio.PER_ORDER_USD,100);
 assert.equal(result.remainingSlots,9);
 assert.ok(result.notional<=funded.equity*.2);
 const nine=names.slice(0,9).map(s=>({...protectedPos(s),size:'1'}));
 assert.throws(()=>Portfolio.validate(liveSnapshot(nine,8000,8000)),/risk|budget/i);
 assert.throws(()=>Portfolio.validate(liveSnapshot(names.map(s=>protectedPos(s)),8000,8000)),/10 positions/);
});
test('At $88 equity no $100 real entry is permitted without relaxing the 20% aggregate exposure limit',()=>{
 const s=liveSnapshot([],88,88);
 assert.throws(()=>Portfolio.validate(s),/Insufficient remaining total exposure/);
 assert.throws(()=>Portfolio.validate(s,{ticket:{...ticket('XRPUSDT'),notional:100},symbol:'XRPUSDT'}),/funding|exposure|balance/);
 const enough=liveSnapshot([],600,120);
 assert.equal(Portfolio.validate(enough).capacity,1);
});
test('No real entry when existing protection is missing, risk is exhausted or symbol duplicated',()=>{
 const missing=protectedPos('BTCUSDT');missing.stopLoss='';
 assert.throws(()=>Portfolio.validate(liveSnapshot([missing])),/unprotected/);
 assert.throws(()=>Portfolio.validate(liveSnapshot([protectedPos('BTCUSDT')]),{symbol:'BTCUSDT'}),/already holds/);
 const bad=liveSnapshot();bad.pnlToday=-1.01;
 assert.throws(()=>Portfolio.validate(bad),/daily/);
 const pending=liveSnapshot();pending.pending=[{symbol:'BTCUSDT'}];
 assert.throws(()=>Portfolio.validate(pending),/Pending/);
});
