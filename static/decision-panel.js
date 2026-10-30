'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 let sequence=0;
 const money=n=>Number.isFinite(n)?'$'+n.toFixed(3):'—';
 function render(plan,symbol){
  if(!$('decision-result'))return;
  $('decision-result').hidden=false;
  const direction=plan.eligible?plan.side||plan.decision:'WAIT';
  $('decision-heading').textContent=symbol.replace(/USDT$/,'')+' / '+direction;
  $('decision-heading').dataset.direction=direction;
  $('decision-reason').textContent=(plan.reason||'The available evidence does not support an entry.')+(plan.eligible&&Number.isFinite(plan.quality?.score)?' · Execution quality '+plan.quality.score.toFixed(1)+'/100 ('+plan.quality.grade.toLowerCase()+'; not win probability)':'');
  const checks=Array.isArray(plan.checks)?plan.checks:[];
  const required=checks.filter(x=>x.required!==false);
  $('decision-check-count').textContent=required.filter(x=>x.pass).length+' / '+required.length+' required checks passed';
  const v=plan.validation||{},m=plan.metrics||{};
  const samples=v.trades??v.tradeCount??v.sampleCount;
  $('decision-validation').textContent=Number.isFinite(samples)?(v.entryGate==='ADVISORY_DEMO'?'Demo advisory: '+samples+' historical trades':samples+' / '+(v.minimumTrades??20)+' required historical price-only trades')+(v.unresolvedTrades?' · '+v.unresolvedTrades+' unresolved':'')+(v.passed===false?' · '+(v.reason||'validation failed'):''):'Historical evidence unavailable';
  $('decision-cost').textContent=money(m.estimatedRoundTripCostUsd??m.roundTripCostUsd);
  const stamp=plan.observedAt||plan.coverage?.observedAt;
  $('decision-observed').textContent=stamp?'Snapshot '+new Date(stamp).toLocaleTimeString():'Snapshot time unavailable';
  const list=$('decision-checks');list.replaceChildren();
  for(const c of checks){
   const row=document.createElement('li'),label=document.createElement('strong'),detail=document.createElement('span');
   row.className=c.pass?'evidence-pass':c.required===false?'evidence-advisory':'evidence-fail';label.textContent=(c.pass?'✓ ':c.required===false?'ⓘ Advisory: ':'× ')+c.label;detail.textContent=c.detail||'';
   row.append(label,detail);list.append(row);
  }
  $('decision-limits').textContent=v.caveat||v.limitations||'Historical prices cannot reproduce old order books, funding, latency or actual fills. This is limited evidence, not a profit forecast.';
 }
 async function analyze(symbol,{signal,mode='live',fresh=false}={}){
  const response=await fetch('/api/decision?'+new URLSearchParams({symbol,mode,...(fresh?{fresh:'1'}:{})}),{cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Market evidence is unavailable');
  if(!data.decision||typeof data.decision!=='object')throw Error('Invalid market decision response');
  return {...data.decision,symbol:data.symbol||symbol,observedAt:data.observedAt};
 }
 $('decision-analyze')?.addEventListener('click',async()=>{
  const request=++sequence,button=$('decision-analyze');button.disabled=true;
  $('decision-analysis-message').textContent='Collecting public market evidence. No order will be placed.';
  try{
   let symbol=$('decision-symbol').value.trim().toUpperCase();if(!symbol.endsWith('USDT'))symbol+='USDT';
   if(!/^[A-Z0-9]{2,24}USDT$/.test(symbol))throw Error('Enter a USDT market symbol such as BTC or ETH.');
   const result=await analyze(symbol,{mode:document.body.dataset.account==='real'?'live':'demo'});if(request!==sequence)return;
   render(result,symbol);$('decision-analysis-message').textContent='Analysis complete. This action never opens a trade.';
  }catch(e){if(request===sequence){render({eligible:false,reason:e.message,checks:[{label:'Market evidence available',pass:false}]},'MARKET');$('decision-analysis-message').textContent='No trade: evidence could not be verified.'}}finally{if(request===sequence)button.disabled=false}
 });
 async function quote(symbol){
  const r=await fetch('/api/quote?'+new URLSearchParams({symbol}),{cache:'no-store',signal:AbortSignal.timeout(8000)}),q=await r.json();
  if(!r.ok||q.symbol!==(symbol.endsWith('USDT')?symbol:symbol+'USDT')||!Number.isFinite(q.observedAt)||Date.now()-q.observedAt>10000||q.observedAt>Date.now()+1000||!Number.isFinite(q.bid)||!Number.isFinite(q.ask)||q.bid<=0||q.ask<q.bid)throw Error('Fresh liquidation quote is unavailable');
  return q;
 }
 window.OmegaDecision={analyze,render,quote};
})();
