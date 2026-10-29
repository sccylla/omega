'use strict';
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaSelection=api})(typeof window!=='undefined'?window:null,function(){
 const rank=(a,b)=>(Number(b.rank)||0)-(Number(a.rank)||0)||a.symbol.localeCompare(b.symbol);
 function summarize(results,canEnter=()=>true){
  const counts=new Map();let qualified=0,accountBlocked=0;
  for(const plan of results){
   if(plan.eligible&&['BUY','SELL'].includes(plan.side)&&Number.isFinite(plan.rank)){
    qualified++;if(!canEnter(plan))accountBlocked++;continue;
   }
   const failed=(plan.checks||[]).filter(c=>!c.pass).map(c=>c.label+(c.detail?': '+c.detail:''));
   for(const reason of new Set(failed.length?failed:[plan.reason||'No qualifying decision']))counts.set(reason,(counts.get(reason)||0)+1);
  }
  const blockers=[...counts].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason));
  return {qualified,accountBlocked,available:qualified-accountBlocked,blockers};
 }
 function explain(summary){
  if(summary.qualified&&summary.available===0)return summary.qualified+' qualifying setup(s) blocked by existing positions or portfolio concentration.';
  return summary.blockers.slice(0,3).map(x=>x.count+' pair(s): '+x.reason).join(' · ')||'No supported markets returned.';
 }
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
  return {results,picks,coverage,summary:summarize(results,canEnter)};
 }
 return {scanMarkets,rank,summarize,explain};
});
