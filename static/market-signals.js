/* OMEGA: closed-candle research. Scores are not win probabilities. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaSignals=api;})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const PERIOD=300000;
 function ema(x,n){if(!x.length)return NaN;let v=x[0],k=2/(n+1);for(let i=1;i<x.length;i++)v+=(x[i]-v)*k;return v}
 function latestRows(rows,now=Date.now()){if(!Array.isArray(rows))return [];return rows.filter(r=>Array.isArray(r)&&Number.isFinite(+r[0])&&+r[0]+PERIOD<=now&&r.slice(1,5).every(v=>Number.isFinite(+v)&&+v>0)).slice(-100)}
 function atr(rows,n=14){if(rows.length<n+1)return NaN;let sum=0;for(let i=rows.length-n;i<rows.length;i++){const prev=+rows[i-1][4],high=+rows[i][2],low=+rows[i][3];sum+=Math.max(high-low,Math.abs(high-prev),Math.abs(low-prev));}return sum/n;}
 function exitContext(rows,side,now=Date.now()){
  const closed=latestRows(rows,now);if(closed.length<45)return null;
  const last=closed.at(-1);if(now-(+last[0]+PERIOD)>15*60000)return null;
  const closes=closed.map(r=>+r[4]),price=closes.at(-1),a=atr(closed);
  if(!Number.isFinite(a)||a<=0)return null;
  const fast=ema(closes.slice(-42),12),slow=ema(closes.slice(-65),34),dir=side==='BUY'?1:-1;
  const weakening=dir*(fast-slow)<0 && dir*(price-closes.at(-4))<0;
  return {price,atr:a,reversal:weakening,barTime:+last[0],trend:(fast-slow)/price};
 }
 function entrySetup(rows,side,now=Date.now()){
  const closed=latestRows(rows,now),x=exitContext(rows,side,now);if(!x||closed.length<55)return null;
  const closes=closed.map(r=>+r[4]),latest=x.price,fast=ema(closes.slice(-44),12),slow=ema(closes.slice(-65),34);
  const move=(latest-closes.at(-4))/latest,trend=(fast-slow)/latest;
  const ret=closes.slice(-30).map((v,i,a)=>i?Math.abs(v/a[i-1]-1):0).slice(1);
  const vol=ret.reduce((a,b)=>a+b,0)/ret.length,dir=side==='BUY'?1:-1;
  const volumes=closed.slice(-21,-1).map(v=>Math.max(0,+v[5]||0));const average=volumes.reduce((a,b)=>a+b,0)/(volumes.length||1);
  const recent=closed.slice(-3).reduce((a,r)=>a+Math.max(0,+r[5]||0),0)/3;
  const volumeRatio=average>0?recent/average:1;
  if(dir*trend<0.001||dir*move<0.001||vol<0.00035||vol>0.017||volumeRatio<0.6)return null;
  if(x.atr/latest>0.05)return null;
  return {...x,move,vol,volumeRatio,trend,confirmed:true};
 }
 function candleKey(setup,symbol,side){return `${symbol}:${side}:${setup.barTime}`}
 return {ema,latestRows,atr,entrySetup,exitContext,candleKey};
});
