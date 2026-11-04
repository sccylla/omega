'use strict';
// Public news gates new Demo scalp entries; exits continue using fresh quotes.
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaNewsContext=api})(typeof window!=='undefined'?window:null,function(){
 const MAX_AGE_MS=120000,POLL_MS=30000;
 function create({fetcher=(...args)=>fetch(...args),clock=()=>Date.now(),onUpdate=()=>{}}={}){
  let snapshot=null,pending=null,lastAttempt=-Infinity,lastKey='';
  const validTime=(time,now)=>Number.isFinite(time)&&time<=now&&now-time<=MAX_AGE_MS;
  function assessment(symbol,now=clock()){
   const context=snapshot?.markets?.[symbol];
   if(!validTime(snapshot?.observedAt,now)||!context||context.ready!==true||typeof context.blocked!=='boolean')
    return {ready:false,blocked:true,status:'UNAVAILABLE',reason:'Fresh news context unavailable; new entries paused',events:[],headlines:[]};
   return context;
  }
  function filter(signals,now=clock()){
   return (Array.isArray(signals)?signals:[]).map(signal=>{
    if(signal?.state!=='WATCH')return signal;
    const context=assessment(signal.symbol,now);
    return context.blocked?{...signal,state:'WAIT',side:null,reason:context.reason,
     reasons:[context.reason,...(signal.reasons||[])],newsStatus:context.status}:{...signal,newsStatus:context.status};
   });
  }
  function refresh(symbols){
   const list=[...new Set(symbols)].sort(),key=list.join(','),now=clock();
   if(pending)return key===lastKey?pending:pending.then(()=>refresh(list));
   if(key===lastKey&&now>=lastAttempt&&now-lastAttempt<POLL_MS)return Promise.resolve();
   lastAttempt=now;lastKey=key;
   pending=(async()=>{
    try{
     const r=await fetcher('/api/news?'+new URLSearchParams({symbols:key}),{cache:'no-store',signal:AbortSignal.timeout(7000)});
     if(!r.ok)throw Error('News unavailable');
     const data=await r.json();
     if(!validTime(data?.observedAt,clock())||!data.markets||list.some(s=>!Object.hasOwn(data.markets,s)))throw Error('Incomplete news response');
     snapshot=data;
    }catch{snapshot=null}
    finally{pending=null;onUpdate(snapshot)}
   })();
   return pending;
  }
  return {assessment,filter,refresh};
 }
 return {create,MAX_AGE_MS,POLL_MS};
});
