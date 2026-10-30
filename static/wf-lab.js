'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 if(!$('wf-run')||!$('wf-demo')||!$('wf-live'))return;
 const money=v=>Number.isFinite(v)?(v<0?'−$':'$')+Math.abs(v).toFixed(2):'—';
 const show=(id,value)=>{const n=$(id);if(n)n.textContent=String(value)};
 function addCell(tr,value){const td=document.createElement('td');td.textContent=String(value);tr.append(td)}
 function displayFolds(data){
  $('wf-metrics').hidden=false;
  show('wf-window-count',data.independentTestWindows);
  show('wf-test-count',data.heldOutSignals);
  show('wf-baseline',money(data.researchComparison.baselineNetUsd));
  show('wf-candidate',money(data.researchComparison.candidateSelectedNetUsd));
  const tb=$('wf-fold-rows');tb.replaceChildren();
  for(const fold of data.folds){
   const tr=document.createElement('tr');
   for(const field of [fold.number,new Date(fold.testStartAt).toLocaleDateString()+' – '+new Date(fold.testEndAt).toLocaleDateString(),
    fold.chosenPolicy,money(fold.baseline.netUsd),money(fold.selected.netUsd),fold.selected.trades])addCell(tr,field);
   tb.append(tr);
  }
  show('wf-conclusion',data.researchComparison.recommendation+' '+data.limitations);
  show('wf-message',data.independentTestWindows+' separated historical windows completed · '+data.heldOutSignals+
   ' untouched test signals · selected policy advantage '+money(data.researchComparison.differenceUsd)+
   '. No changes to live or demo execution. '+data.researchComparison.status.replaceAll('_',' ').toLowerCase()+'.');
 }
 function grouped(id,values){
  const node=$(id);node.replaceChildren();
  if(!values?.length){node.textContent='No recorded trades';return}
  for(const r of values.slice(0,8)){
   const item=document.createElement('div'),name=document.createElement('span'),result=document.createElement('strong');
   name.textContent=(r.name||r.regime)+' · '+(r.count??r.trades)+' trades';
   const net=Number(r.net??r.netUsd);result.textContent=money(net);
   result.className=net>=0?'wf-positive':'wf-negative';
   item.append(name,result);node.append(item);
  }
 }
 function displayTrades(data){
  $('wf-trade-metrics').hidden=false;
  show('wf-closed-count',data.sampleSize);
  show('wf-closed-wins',data.winRatePct===null?'Not enough data':data.winRatePct.toFixed(1)+'%');
  show('wf-closed-net',money(data.netUsd));
  show('wf-closed-dd',money(data.maxDrawdownUsd));
  grouped('wf-trade-markets',data.byMarket);
  grouped('wf-trade-sides',data.bySide);
  grouped('wf-trade-regimes',data.byRegime);
  show('wf-trade-warning',data.interpretation+' '+data.limitations+(data.notice?' '+data.notice:''));
  show('wf-trade-message',data.source+' completed-trade diagnostics · '+data.sampleSize+' validated records. No strategy changes or orders.');
 }
 async function get(url,limitMs=25000){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),limitMs);
  try{
   const r=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:ctrl.signal});
   const data=await r.json();
   if(!r.ok)throw Error(data.error||'Research service unavailable (HTTP '+r.status+')');
   return data;
  }finally{clearTimeout(timer)}
 }
 async function action(button,run,errorId){
  if(button.disabled)return;button.disabled=true;
  try{await run()}catch(e){show(errorId,'Unable to complete research: '+(e?.message||'Unknown problem'))}
  finally{button.disabled=false}
 }
 $('wf-run').addEventListener('click',()=>action($('wf-run'),async()=>{
  const asset=$('wf-asset').value;
  if(!['BTC','ETH','SOL'].includes(asset))throw Error('Invalid selected market');
  show('wf-message','Running historical walk-forward windows for '+asset+' · research only, no orders…');
  const d=await get('/api/intelligence?'+new URLSearchParams({market:'futures',asset,validation:'walkforward'}),32000);
  if(d.mode!=='WALK_FORWARD_RESEARCH_ONLY'||d.liveExecutionAffected!==false)throw Error('Server did not return safe research-only analysis');
  displayFolds(d);
 },'wf-message'));
 $('wf-demo').addEventListener('click',()=>action($('wf-demo'),async()=>{
  show('wf-trade-message','Reading completed virtual trades on this device or synced Demo account…');
  await window.OmegaAccount?.ready;
  if(!window.OmegaAccount||!window.OmegaTradeReview)throw Error('Demo account history is unavailable');
  const account=window.OmegaAccount.read(),report=window.OmegaTradeReview.summarizeClosedTrades(account.closed||[],{label:'DEMO'});
  displayTrades(report);
 },'wf-trade-message'));
 $('wf-live').addEventListener('click',()=>action($('wf-live'),async()=>{
  show('wf-trade-message','Reading the last seven days of completed Bybit futures trades, without placing orders…');
  const d=await get('/api/live?action=closed',20000);
  if(d.mode!=='CLOSED_TRADE_DIAGNOSTICS'||d.source!=='BYBIT')throw Error('Unexpected broker report');
  displayTrades(d);
 },'wf-trade-message'));
})();
