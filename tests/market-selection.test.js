'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{scanMarkets}=require('../static/market-selection');
const row=symbol=>({symbol,turnover24h:1e8,spreadBps:1});
test('all pairs are considered and the highest-ranked qualifying market beyond the old shortlist wins',async()=>{
 const rows=Array.from({length:20},(_,i)=>row('PAIR'+i+'USDT')),calls=[];
 const result=await scanMarkets(rows,{analyze:async symbol=>{calls.push(symbol);return {eligible:true,side:'BUY',rank:Number(symbol.match(/\d+/)[0])}}});
 assert.equal(calls.length,20);assert.equal(result.coverage.complete,true);assert.equal(result.picks[0].symbol,'PAIR19USDT');assert.equal(result.coverage.checked,20);
});
test('liquidity rejection is counted and never substituted for deep analysis of qualifying pairs',async()=>{
 const result=await scanMarkets([{...row('LOWUSDT'),turnover24h:1},row('GOODUSDT')],{analyze:async()=>({eligible:true,side:'BUY',rank:10})});
 assert.equal(result.coverage.rejected,1);assert.equal(result.coverage.analyzed,1);assert.equal(result.coverage.checked,2);assert.equal(result.picks[0].symbol,'GOODUSDT');
});
test('failed evidence remains in coverage without ranking it as an entry',async()=>{
 const result=await scanMarkets([row('FAILUSDT'),row('GOODUSDT')],{analyze:async symbol=>{if(symbol==='FAILUSDT')throw Error('Unavailable');return {eligible:true,side:'SELL',rank:10}}});
 assert.equal(result.coverage.incomplete,1);assert.equal(result.picks.length,1);assert.equal(result.picks[0].symbol,'GOODUSDT');
});
test('cancelling an unfinished scan never produces an entry shortlist',async()=>{
 let cancel=false;const result=await scanMarkets([row('ONEUSDT'),row('TWOUSDT')],{concurrency:1,isCancelled:()=>cancel,analyze:async()=>{cancel=true;return {eligible:true,side:'BUY',rank:10}}});
 assert.equal(result.coverage.complete,false);assert.deepEqual(result.picks,[]);
});
test('held or concentrated markets are excluded before selecting the best available pair',async()=>{
 const result=await scanMarkets([row('HELDUSDT'),row('FREEUSDT')],{analyze:async symbol=>({eligible:true,side:'BUY',rank:symbol==='HELDUSDT'?100:50}),canEnter:p=>p.symbol!=='HELDUSDT'});
 assert.equal(result.picks[0].symbol,'FREEUSDT');
});
test('full scans bound concurrency and do not impose per-symbol cooldowns between runs',async()=>{
 let active=0,peak=0,calls=0;const rows=Array.from({length:10},(_,i)=>row('P'+i+'USDT'));
 const analyze=async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return {eligible:true,side:'BUY',rank:1}};
 await scanMarkets(rows,{analyze});await scanMarkets(rows,{analyze});assert.equal(calls,20);assert.equal(peak,2);
});
