'use strict';
(()=>{
 const $=id=>document.getElementById(id),L=window.OmegaShadowLedger;
 if(!L||!$('shadow-toggle'))return;
 const KEY='omega_shadow_forward_v1_device',SYMBOLS=['BTC','ETH','SOL'];
 let running=false,busy=false,passes=0;
 const btn=$('shadow-toggle'),state=()=>{try{return L.restore(JSON.parse(localStorage.getItem(KEY)||'null'))}catch{return L.initial()}};
 const save=value=>localStorage.setItem(KEY,JSON.stringify(value));
 const show=s=>{$('shadow-status').textContent=s};
 const fmt=x=>Number.isFinite(x)?(x<0?'−$':'$')+Math.abs(x).toFixed(2):'—';
 function draw(){
  const r=L.report(state());$('shadow-closed').textContent=r.closedObservations;
  $('shadow-trades').textContent=r.candidate.count;$('shadow-net').textContent=fmt(r.candidate.netUsd);
  $('shadow-baseline').textContent=fmt(r.baseline.netUsd);
  $('shadow-gate').textContent=r.passed?'Research sample-quality checks passed; independent audit and real-broker tests are still required.':'NOT VALIDATED · '+r.candidate.count+' adaptive observations / 60 required · '+r.forwardDays+' / 14 days · '+r.uniqueSymbols+' / 3 markets.';
  const el=$('shadow-checks');el.replaceChildren();
  for(const c of r.conditions){
   const item=document.createElement('div'),label=document.createElement('span'),status=document.createElement('strong');
   label.textContent=c.name;status.textContent=c.pass?'PASS':'NOT MET';status.className=c.pass?'wf-positive':'wf-negative';item.append(label,status);el.append(item);
  }
 }
 async function fetchData(url,signal){
  const r=await fetch(url,{cache:'no-store',credentials:'same-origin',signal});
  const d=await r.json();if(!r.ok)throw Error(d.error||'Public research data unavailable');
  return d;
 }
 async function check(){
  if(busy||document.hidden||!navigator.locks?.request)return;
  busy=true;
  try{
   await navigator.locks.request('omega-prospective-shadow',{ifAvailable:true},async lock=>{
    if(!lock){show('Another browser tab is collecting shadow observations. This tab will not duplicate them.');return}
    let next=state(),written=0,settled=0,errors=[];
    for(const asset of SYMBOLS){
     if(document.hidden)break;
     try{
      const symbol=asset+'USDT',url='/api/market?exchange=bybit&symbol='+encodeURIComponent(asset)+'&tf=5m&limit=700';
      if(next.events.some(e=>e.symbol===symbol&&e.status==='OPEN')){
       const c=await fetchData(url,AbortSignal.timeout(15000));
       const out=L.resolve(next,{symbol,candles:c.candles,now:Date.now()});
       next=out.state;settled+=Number(out.changed);if(out.changed)save(next);
      }
      if(!running)continue;
      const bucket=Math.floor(Date.now()/300000),mark='omega_shadow_checked_'+symbol;
      if(Number(localStorage.getItem(mark))===bucket)continue;
      const newest=await fetchData('/api/intelligence?market=futures&asset='+asset+'&validation=shadow',AbortSignal.timeout(25000));
      localStorage.setItem(mark,String(bucket));
      const x=L.accept(next,newest,Date.now());
      next=x.state;if(x.accepted){written++;save(next)}
     }catch(e){errors.push(asset+': '+String(e.message||'feed error').slice(0,95))}
    }
    passes++;draw();
    show('Pass '+passes+' · '+written+' new prospective entries · '+settled+' settled observations'+
     (errors.length?' · Unavailable: '+errors.join('; '):' · All market requests completed')+
     '. Data remain research-only; no live orders.');
   });
  }catch(e){show('Shadow monitoring paused because evidence storage or browser locking failed: '+e.message);running=false}
  finally{busy=false;btn.textContent=running?'Pause shadow monitoring':'Start forward shadow monitoring'}
 }
 btn.addEventListener('click',()=>{
  if(running){running=false;btn.textContent='Start forward shadow monitoring';show('Paused. Previously recorded outcomes can still be checked.');return}
  if(!navigator.locks?.request){show('An up-to-date HTTPS browser with tab locks is required for duplicate-safe observations.');return}
  running=true;btn.textContent='Pause shadow monitoring';show('Shadow collector armed. Reading fresh public exchange data, never sending orders.');
  check();
 });
 $('shadow-recheck').addEventListener('click',()=>check());
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&running){running=false;btn.textContent='Start forward shadow monitoring';show('Paused because the tab was hidden. No new forecasts will be backdated.')}})
 window.addEventListener('beforeunload',()=>{running=false});
 setInterval(()=>{if(running&&!document.hidden)check()},60000);
 draw();
})();
