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
 // Race the whole operation (including response-body parsing), even if a source
 // ignores abort. Always clean up timers/listeners and abort its underlying fetch.
 function within(task,{signal,timeoutMs=25000,label='Market request'}={}){
  return new Promise((resolve,reject)=>{
   const controller=new AbortController();let timer,settled=false;
   const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort();fn(value)};
   const cancel=()=>finish(reject,new DOMException('Scan cancelled','AbortError'));
   if(signal?.aborted){cancel();return}
   signal?.addEventListener('abort',cancel,{once:true});
   timer=setTimeout(()=>finish(reject,new DOMException(label+' timed out','TimeoutError')),Math.max(1,timeoutMs));
   Promise.resolve().then(()=>{if(!settled)return task(controller.signal)}).then(value=>finish(resolve,value),error=>finish(reject,error));
  });
 }
 async function scanMarkets(rows,{analyze,onProgress=()=>{},isCancelled=()=>false,canEnter=()=>true,concurrency=2,signal,maxMs=Infinity,requestTimeoutMs=25000,startAfter=null,allowPartial=false}={}){
  if(!Array.isArray(rows)||typeof analyze!=='function')throw Error('Invalid market scan input');
  concurrency=Math.max(1,Math.min(4,Math.floor(Number(concurrency)||2)));
  const unique=[...new Map(rows.map(r=>[r.symbol,r])).values()],results=[],liquid=[];
  const coverage={total:unique.length,screened:unique.length,checked:0,analyzed:0,rejected:0,incomplete:0,remaining:0,complete:false,timedOut:false,cancelled:false};
  // Cheap full-universe screening must not sit behind slow evidence requests.
  for(const item of unique){
   if(!/^[A-Z0-9]{2,24}USDT$/.test(item.symbol)||!Number.isFinite(item.turnover24h)||item.turnover24h<10000000||!Number.isFinite(item.spreadBps)||item.spreadBps<0||item.spreadBps>8){coverage.rejected++;coverage.checked++;results.push({symbol:item.symbol,eligible:false,reason:'Liquidity or spread does not meet entry rules',checks:[]})}
   else liquid.push(item);
  }
  const cursor=liquid.findIndex(x=>x.symbol===startAfter),offset=cursor<0?0:(cursor+1)%liquid.length;
  const queue=liquid.slice(offset).concat(liquid.slice(0,offset));
  const controller=new AbortController(),abort=()=>controller.abort();let deadline;
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  if(Number.isFinite(maxMs))deadline=setTimeout(()=>{coverage.timedOut=true;controller.abort()},Math.max(1,maxMs));
  const cancelled=()=>signal?.aborted||isCancelled();
  let nextAfter=startAfter;
  const report=()=>onProgress({...coverage});
  try{
   coverage.remaining=queue.length;report();
   for(let offset=0;offset<queue.length;offset+=concurrency){
    if(cancelled()||controller.signal.aborted)break;
    const items=queue.slice(offset,offset+concurrency);
    const batch=await Promise.all(items.map(async item=>{
     try{
      const plan=await within(childSignal=>analyze(item.symbol,{signal:childSignal}),{signal:controller.signal,timeoutMs:requestTimeoutMs});
      coverage.analyzed++;return {...plan,symbol:item.symbol};
     }catch(error){coverage.incomplete++;return {symbol:item.symbol,eligible:false,reason:error.name==='TimeoutError'?'Market evidence request timed out':controller.signal.aborted?'Evidence unfinished when scan stopped':'Market evidence unavailable',checks:[]}}
    }));
    results.push(...batch);coverage.checked+=batch.length;coverage.remaining=queue.length-(offset+items.length);nextAfter=items.at(-1).symbol;report();
   }
   coverage.cancelled=!!cancelled();
   coverage.complete=coverage.checked===coverage.total&&!coverage.cancelled&&!coverage.timedOut;
   report();
   const picks=!coverage.cancelled&&(coverage.complete||allowPartial)?results.filter(p=>p.eligible&&['BUY','SELL'].includes(p.side)&&Number.isFinite(p.rank)&&canEnter(p)).sort(rank):[];
   return {results,picks,coverage,nextAfter,summary:summarize(results,canEnter)};
  }finally{clearTimeout(deadline);signal?.removeEventListener('abort',abort);controller.abort()}
 }
 return {scanMarkets,rank,summarize,explain,within};
});
