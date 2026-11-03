'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Shadow=require('../static/seconds-shadow'),Demo=require('../static/demo-seconds-account');
const Paper=require('../static/paper-engine'),Portfolio=require('../lib/live-portfolio');
const now=1800000005000;
const quote=(symbol,price=100)=>({symbol,observedAt:now,askVwap:price+.01,bidVwap:price-.01,notional:8,requiredMoveBps:70});
const names=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','BNBUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','LTCUSDT'];
const signals=names.map((symbol,i)=>({symbol,state:'WATCH',side:'BUY',score:90-i,qualityVeto:'DEMO_INTELLIGENCE_V1'}));
const quotes=Object.fromEntries(names.map(s=>[s,quote(s)]));
test('Demo scalper can fund ten separate $8 1x positions on its $88 wallet',()=>{
 let w=Demo.smallInitial(now);
 assert.equal(w.cash,88);assert.equal(Demo.SMALL_TRADE_USD,8);
 const out=Demo.step(w,{now,signals,quotes,connected:true});w=out.account;
 assert.equal(Shadow.openList(w.ledger).length,10);
 assert.equal(out.events.filter(x=>x.type==='OPEN').length,10);
 assert.equal(new Set(Shadow.openList(w.ledger).map(p=>p.symbol)).size,10);
 assert.equal(Shadow.openList(w.ledger).reduce((s,p)=>s+p.notional,0),80);
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
test('Demo Futures Trader permits ten fully funded $9.50 auto positions but not eleven',()=>{
 let a=Paper.initial();
 assert.equal(Paper.MAX_POSITIONS,10);
 for(let i=0;i<10;i++){
  const symbol='COIN'+i;
  a=Paper.open(a,{[symbol]:1},{symbol,side:'BUY',notional:9.5,auto:true,targetNet:.05,stopPct:1.5});
 }
 assert.equal(a.positions.length,10);
 assert.equal(a.positions.reduce((s,p)=>s+p.notional,0),95);
 assert.throws(()=>Paper.open(a,{COIN10:1},{symbol:'COIN10',side:'BUY',notional:10,auto:true}),/10 demo position slots/);
 assert.throws(()=>Paper.open(Paper.initial(),{XYZ:1},{symbol:'XYZ',side:'BUY',notional:9.49,auto:true}),/\$9.5/);
 assert.throws(()=>Paper.open(Paper.initial(),{XYZ:1},{symbol:'XYZ',side:'BUY',notional:10}),/\$100/);
});
const protectedPos=(symbol,side='Buy')=>({symbol,side,size:'0.15',avgPrice:'100',markPrice:'100',
 stopLoss:side==='Buy'?'99.7':'100.3',takeProfit:side==='Buy'?'100.7':'99.3',positionIdx:0});
const liveSnapshot=(positions=[],equity=800,available=800)=>({positions,pending:[],equity,available,pnlToday:0});
const ticket=symbol=>({symbol,side:'Buy',qty:'0.15',price:100,notional:15,
 stopLoss:'99.7',takeProfit:'100.7',estimatedRoundTripCostRate:.0022,estimatedTakeProfitNetUsd:.056});
test('Live portfolio supports nine existing protected trades plus a tenth at sufficient equity',()=>{
 const nine=names.slice(0,9).map(s=>protectedPos(s)),snapshot=liveSnapshot(nine);
 const risk=Portfolio.validate(snapshot,{symbol:names[9],ticket:ticket(names[9])});
 assert.equal(risk.remainingSlots,0);
 assert.ok(risk.notional<=snapshot.equity*.2);
 assert.ok(risk.stopRisk<=1);
 const full=liveSnapshot(names.map(s=>protectedPos(s)));
 assert.throws(()=>Portfolio.validate(full),/10 positions/);
});
test('At $88, a $15 live position uses nearly the entire 20% portfolio allocation',()=>{
 const s=liveSnapshot([],88,88);
 assert.equal(Portfolio.validate(s).capacity,1);
 const one=liveSnapshot([protectedPos('BTCUSDT')],88,73);
 assert.throws(()=>Portfolio.validate(one),/Insufficient remaining total exposure/);
 assert.throws(()=>Portfolio.validate(s,{ticket:{...ticket('XRPUSDT'),notional:19},symbol:'XRPUSDT'}),/funding|cap/);
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
