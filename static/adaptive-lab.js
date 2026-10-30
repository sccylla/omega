'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 if(!$('adaptive-run')||!$('forward-validate'))return;
 let research=null,forward=null;
 const fmt=n=>Number.isFinite(n)?(n<0?'−$':'$')+Math.abs(n).toFixed(2):'—';
 const show=(id,value)=>{const el=$(id);if(el)el.textContent=String(value)};
 async function fetchResearch(url){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),35000);
  try{const res=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:ctrl.signal});
   const data=await res.json();if(!res.ok)throw Error(data.error||'Research request was rejected');return data;
  }finally{clearTimeout(timer)}
 }
 function addCell(row,value){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell)}
 function combined(){
  const historical=research?.summary?.enoughHistoricalEvidence===true,forwardOk=forward?.passed===true;
  let shadow=null;
  try{shadow=window.OmegaShadowLedger?.report(window.OmegaShadowLedger.restore(JSON.parse(localStorage.getItem('omega_shadow_forward_v1_device')||'null')))}catch{}
  const prospective=shadow?.passed===true;
  const status='ADAPTIVE STRATEGY NOT APPROVED FOR LIVE. Historical validation: '+(research?historical?'PASS':'FAIL':'NOT RUN')+
   '; completed legacy Demo trades: '+(forward?forwardOk?'PASS (different strategy)':'FAIL OR INSUFFICIENT':'NOT RUN')+
   '; prospective adaptive shadow trials: '+(shadow?prospective?'RESEARCH SAMPLE PASS':'INSUFFICIENT':'NOT COLLECTED')+
   '. Historical simulation, a device-local shadow sample, or a legacy Demo win rate cannot independently validate Bybit execution. No automatic funded-order changes.';
  show('adaptive-joint-status',status);
 }
 function drawResearch(data){
  research=data;
  $('adaptive-metrics').hidden=false;
  show('adaptive-windows',data.process.windows);
  show('adaptive-trades',data.summary.adaptiveTrades);
  show('adaptive-difference',fmt(data.summary.differenceUsd));
  show('adaptive-low',fmt(data.summary.sensitivity.lower5PctUsd));
  const table=$('adaptive-folds');table.replaceChildren();
  for(const f of data.folds){
   const row=document.createElement('tr');
   [new Date(f.testStartAt).toLocaleDateString(),Number(f.chosenThreshold).toFixed(2),
    fmt(f.baseline.netUsd),fmt(f.selected.netUsd),f.selected.count,f.selected.unresolved].forEach(x=>addCell(row,x));
   table.append(row);
  }
  show('adaptive-message',data.history.days+' days · '+data.history.bars.toLocaleString()+
   ' completed candles · '+data.history.pages+' checked pages · '+data.summary.stage.replaceAll('_',' ')+
   ' · '+data.summary.positiveWindows+'/'+data.process.windows+' profitable test windows.');
  show('adaptive-limitations',data.summary.next+' '+data.limitations);
  combined();
 }
 function drawForward(data){
  forward=data;$('forward-metrics').hidden=false;
  show('forward-count',data.sample.count);
  show('forward-days',data.period.spanDays.toFixed(1)+' days');
  show('forward-net',fmt(data.sample.netUsd));
  show('forward-factor',data.sample.profitFactor===null?'Insufficient losses to estimate':data.sample.profitFactor.toFixed(2));
  const box=$('forward-checks');box.replaceChildren();
  for(const check of data.conditions){
   const item=document.createElement('div'),name=document.createElement('span'),state=document.createElement('strong');
   name.textContent=check.name;state.textContent=check.pass?'PASS':'NOT MET';
   state.className=check.pass?'wf-positive':'wf-negative';item.append(name,state);box.append(item);
  }
  show('forward-message',data.stage.replaceAll('_',' ')+' · '+data.retained+
   ' eligible completed trades · '+data.rejected.missingProvenance+' records excluded without matching strategy provenance.');
  combined();
 }
 async function buttonRun(btn,work,statusId){
  if(btn.disabled)return;btn.disabled=true;
  try{await work()}catch(err){show(statusId,(err?.name==='AbortError'?'Research timed out. ': 'Validation unavailable. ')+(err.message||'Unknown error')+'. No policies or funded orders changed.')}
  finally{btn.disabled=false}
 }
 $('adaptive-run').addEventListener('click',()=>buttonRun($('adaptive-run'),async()=>{
  const asset=$('adaptive-asset').value,days=Number($('adaptive-days').value);
  if(!['BTC','ETH','SOL'].includes(asset)||![28,56].includes(days))throw Error('Invalid historical research selection');
  research=null;combined();show('adaptive-message','Fetching '+days+' complete days of Bybit candles and evaluating independent windows. Read-only research…');
  const result=await fetchResearch('/api/intelligence?'+new URLSearchParams({asset,market:'futures',days:String(days),validation:'adaptive'}));
  if(result.mode!=='ADAPTIVE_WALK_FORWARD_RESEARCH'||result.liveExecutionAffected!==false||!result.history.complete)throw Error('Incomplete or unsafe adaptive analysis');
  drawResearch(result);
 },'adaptive-message'));
 $('forward-validate').addEventListener('click',()=>buttonRun($('forward-validate'),async()=>{
  if(!window.OmegaAccount||!window.OmegaForwardValidation)throw Error('Demo ledger or forward review is not available');
  show('forward-message','Reviewing completed, attributable Demo autopilot trades on your device or synced account…');
  await window.OmegaAccount.ready;
  const saved=window.OmegaAccount.read();drawForward(window.OmegaForwardValidation.evaluateForward(saved.closed||[]));
 },'forward-message'));
 $('adaptive-joint-check').addEventListener('click',()=>combined());
})();
