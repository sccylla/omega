/* Transparent demo strategy. Rules select setups; they do not predict a win rate. */
(function(root,factory){
 const api=factory(typeof module!=='undefined'&&module.exports?require('../lib/market-signals'):root.OmegaSignals);
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.OmegaTrader=api;
})(typeof window!=='undefined'?window:null,function(S){
 'use strict';
 const NOTIONAL=10,PERIOD=300000;
 function evaluate(rows,item,side,now=Date.now()){
  const checks=[];
  const check=(label,pass)=>checks.push({label,pass:!!pass});
  const valid=Array.isArray(rows)&&rows.length>=70&&rows.every((r,i)=>Array.isArray(r)&&r.length>=6&&r.slice(0,6).every(Number.isFinite)&&r[0]<=now+60000&&r.slice(1,5).every(v=>v>0)&&r[5]>=0&&r[2]>=Math.max(r[1],r[4])&&r[3]<=Math.min(r[1],r[4])&&(!i||r[0]-rows[i-1][0]===PERIOD));
  const closed=valid?S.latestRows(rows,now):[];
  check('Fresh, complete 5m candles',valid&&closed.length>=65&&now-(closed.at(-1)[0]+PERIOD)<=6*60000);
  check('Liquid market · tight spread',Number.isFinite(item?.turnover24h)&&item.turnover24h>=10000000&&Number.isFinite(item?.spreadBps)&&item.spreadBps>=0&&item.spreadBps<=8);
  check('Funding within limit',Number.isFinite(item?.fundingPct)&&Math.abs(item.fundingPct)<=.06);
  if(!checks[0].pass||!['BUY','SELL'].includes(side))return {eligible:false,checks,reason:checks.filter(c=>!c.pass).map(c=>c.label).join(' · ')||'Invalid direction'};
  const setup=S.entrySetup(closed,side,now),context=S.exitContext(closed,side,now),direction=side==='BUY'?1:-1;
  // Aggregate only complete UTC-aligned 15m candles. No future/incomplete buckets.
  const buckets=new Map();
  for(const r of closed){const t=Math.floor(r[0]/900000)*900000;if(!buckets.has(t))buckets.set(t,[]);buckets.get(t).push(r)}
  const higher=[...buckets.entries()].filter(([t,rs])=>rs.length===3&&rs[0][0]===t&&t+900000<=now).map(([,rs])=>rs[2][4]);
  check('5m trend + momentum agree',!!setup);
  check('15m trend confirms direction',higher.length>=20&&direction*(S.ema(higher,8)-S.ema(higher,21))>0&&direction*(higher.at(-1)-higher.at(-4))>0);
  check('Recent volume confirms',!!setup&&setup.volumeRatio>=.9);
  const atrPct=context?context.atr/context.price*100:NaN;
  check('Volatility is tradable',atrPct>=.08&&atrPct<=2);
  const fast=S.ema(closed.map(r=>r[4]).slice(-44),12);
  check('Entry is not chasing price',!!context&&Math.abs(context.price-fast)<=2*context.atr);
  const eligible=checks.every(c=>c.pass);
  const stopPct=Math.max(.4,Math.min(2,atrPct*1.5));
  const targetNet=NOTIONAL*stopPct/100*1.5;
  return {eligible,checks,reason:eligible?'Trend, liquidity, volume and entry location agree':checks.filter(c=>!c.pass).map(c=>c.label).join(' · '),
   ...(context||{}),...(setup||{}),side,notional:NOTIONAL,stopPct,targetNet,
   slippageBps:2+Math.max(0,Number(item.spreadBps)||0)/2,
   rank:checks.filter(c=>c.pass).length+(setup?Math.min(2,setup.volumeRatio):0)};
 }
 function performance(records){
  const values=(records||[]).map(x=>Number.isFinite(x.netRaw)?x.netRaw:x.net).filter(Number.isFinite);
  const wins=values.filter(x=>x>0),losses=values.filter(x=>x<0);
  const net=values.reduce((a,b)=>a+b,0),gains=wins.reduce((a,b)=>a+b,0),loss=-losses.reduce((a,b)=>a+b,0);
  return {count:values.length,wins:wins.length,losses:losses.length,winRate:values.length?wins.length/values.length*100:null,net,expectancy:values.length?net/values.length:null,profitFactor:loss?gains/loss:null};
 }
 function lossStreak(records,now=Date.now()){
  let count=0;const day=new Date(now).toISOString().slice(0,10);
  for(const r of records||[]){if(new Date(r.closedAt).toISOString().slice(0,10)!==day||(r.netRaw??r.net)>=0)break;count++}return count;
 }
 return {NOTIONAL,evaluate,performance,lossStreak};
});
