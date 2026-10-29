'use strict';
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaSelection=api})(typeof window!=='undefined'?window:null,function(){
 const rank=(a,b)=>(Number(b.rank)||0)-(Number(a.rank)||0)||a.symbol.localeCompare(b.symbol);
 async function scanMarkets(rows,{analyze,onProgress=()=>{},isCancelled=()=>false,canEnter=()=>true,concurrency=2}={}){
  if(!Array.isArray(rows)||typeof analyze!=='function')throw Error('Invalid market scan input');
  concurrency=Math.max(1,Math.min(4,Math.floor(Number(concurrency)||2)));
  const unique=[...new Map(rows.map(r=>[r.symbol,r])).values()],results=[];
  const coverage={total:unique.length,checked:0,analyzed:0,rejected:0,incomplete:0,complete:false};
  const report=()=>onProgress({...coverage});
  for(let offset=0;offset<unique.length;offset+=concurrency){
   if(isCancelled())break;
   const batch=await Promise.all(unique.slice(offset,offset+concurrency).map(async item=>{
    if(!/^[A-Z0-9]{2,24}USDT$/.test(item.symbol)||!Number.isFinite(item.turnover24h)||item.turnover24h<10000000||!Number.isFinite(item.spreadBps)||item.spreadBps<0||item.spreadBps>8){coverage.rejected++;return {symbol:item.symbol,eligible:false,reason:'Liquidity or spread does not meet entry rules',checks:[]}}
    coverage.analyzed++;
    try{const plan=await analyze(item.symbol);return {...plan,symbol:item.symbol}}
    catch{coverage.incomplete++;return {symbol:item.symbol,eligible:false,reason:'Market evidence unavailable',checks:[]}}
   }));
   results.push(...batch);coverage.checked+=batch.length;report();
  }
  coverage.complete=coverage.checked===coverage.total&&!isCancelled();report();
  const picks=coverage.complete?results.filter(p=>p.eligible&&['BUY','SELL'].includes(p.side)&&Number.isFinite(p.rank)&&canEnter(p)).sort(rank):[];
  return {results,picks,coverage};
 }
 return {scanMarkets,rank};
});
