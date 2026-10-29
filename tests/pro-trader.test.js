'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../static/pro-trader'),E=require('../lib/paper-engine');
function candles(now=Math.floor(Date.now()/300000)*300000){return Array.from({length:100},(_,i)=>{const c=100+i*.08+Math.sin(i*.7)*.05;return [now-(100-i)*300000,c-.02,c+.22,c-.22,c,1000]})}
const quality={turnover24h:1e8,spreadBps:1,fundingPct:.01};
test('qualified entry needs every independent market gate and fixes size at $10',()=>{
 const now=Math.floor(Date.now()/300000)*300000,x=T.evaluate(candles(now),quality,'BUY',now);
 assert.equal(x.eligible,true);assert.ok(x.checks.every(c=>c.pass));assert.equal(x.notional,10);assert.ok(x.targetNet>0);
 assert.equal(T.evaluate(candles(now),quality,'SELL',now).eligible,false);
 for(const item of [{...quality,spreadBps:20},{...quality,turnover24h:100},{...quality,fundingPct:.1},{...quality,fundingPct:NaN}])assert.equal(T.evaluate(candles(now),item,'BUY',now).eligible,false);
});
test('stale, disordered, missing or impossible candles cannot trigger entries',()=>{
 const now=Math.floor(Date.now()/300000)*300000;
 for(const mutate of [r=>r.reverse(),r=>r.splice(40,1),r=>{r[70][2]=r[70][3]-1},r=>{r[70][5]=NaN},r=>r.forEach(c=>c[0]-=3600000)]){
  const r=candles(now);mutate(r);assert.equal(T.evaluate(r,quality,'BUY',now).eligible,false);
 }
});
test('unclosed candle data cannot alter a confirmed decision',()=>{
 const now=Math.floor(Date.now()/300000)*300000,r=candles(now),a=T.evaluate(r,quality,'BUY',now);
 r.push([now,108,200,100,150,1e8]);const b=T.evaluate(r,quality,'BUY',now);
 assert.equal(a.eligible,b.eligible);assert.equal(a.price,b.price);assert.equal(a.barTime,b.barTime);
});
test('profit exits subtract entry/exit fees and adverse slippage for both directions',()=>{
 for(const side of ['BUY','SELL']){
  let a=E.open(E.initial(),{XRP:1},{symbol:'XRP',side,notional:10,auto:true,atr:.003,targetNet:.05,slippageBps:3});
  a=E.applyQuote(a,{XRP:side==='BUY'?1.001:.999});assert.equal(a.positions.length,1);
  a=E.applyQuote(a,{XRP:side==='BUY'?1.012:.988});assert.equal(a.positions.length,0);
  assert.ok(a.closed[0].netRaw>=.05);assert.match(a.closed[0].reason,/Net profit target/);
 }
});
test('new strategy still takes a losing stop rather than waiting forever for profit',()=>{
 let a=E.open(E.initial(),{XRP:1},{symbol:'XRP',side:'BUY',notional:10,auto:true,targetNet:.05,slippageBps:3});
 a=E.applyQuote(a,{XRP:.97});assert.equal(a.positions.length,0);assert.ok(a.closed[0].netRaw<0);
});
test('win rate uses closed outcomes, includes losses and reports an empty sample honestly',()=>{
 assert.equal(T.performance([]).winRate,null);
 const x=T.performance([{net:3},{net:-10},{net:0},{net:2}]);
 assert.equal(x.winRate,50);assert.equal(x.net,-5);assert.equal(x.expectancy,-1.25);assert.equal(x.profitFactor,.5);
});
test('three-loss pause counts only consecutive losses on the current UTC day',()=>{
 const now=Date.now(),r=Array.from({length:3},()=>({net:-.1,closedAt:now}));
 assert.equal(T.lossStreak(r,now),3);assert.equal(T.lossStreak([{net:0,closedAt:now},...r],now),0);
 assert.equal(T.lossStreak(r,now+86400000),0);
});
test('browser and Node paper engines stay identical',()=>assert.equal(require('node:fs').readFileSync(require.resolve('../lib/paper-engine'),'utf8'),require('node:fs').readFileSync(require.resolve('../static/paper-engine'),'utf8')));
module.exports={candles,quality};
