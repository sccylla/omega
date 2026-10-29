'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 let mode='demo',working=false,worker=null;
 try{mode=location.hash==='#real'?'real':sessionStorage.getItem('omega_account_mode')||'demo'}catch{}
 async function api(url,body){const r=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json','X-OMEGA-REQUEST':'1'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'Account service unavailable');return d}
 function select(next,navigate=true){
  mode=next==='real'?'real':'demo';document.body.dataset.account=mode;
  document.querySelectorAll('[data-account-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.accountMode===mode)));
  $('account-mode-label').textContent=mode==='real'?'REAL FUNDS':worker?.active?'LIVE BOT ARMED':'SIMULATED';
  try{sessionStorage.setItem('omega_account_mode',mode)}catch{}
  if(navigate)window.dispatchEvent(new CustomEvent('omega:account-mode',{detail:mode}));
  if(mode==='real')refresh();
 }
 function showWorker(d){
  worker=d;$('live-running-banner').hidden=!d.active;$('real-worker-state').textContent=d.active?'ARMED / LIVE':d.pending?'RECONCILING':'PAUSED';
  $('real-worker-message').textContent=d.message;
  $('real-start').disabled=working||!d.configured||!d.serverEnabled||d.pending||d.active;
  $('real-pause').disabled=working||!d.active;
  const decisions=$('real-decision-rows');if(decisions){decisions.replaceChildren();
   for(const plan of d.decisions||[]){const row=document.createElement('div'),name=document.createElement('strong'),why=document.createElement('p');row.className='real-decision';name.textContent=plan.symbol+' / '+plan.decision;why.textContent=plan.reason;row.append(name,why);decisions.append(row)}
   if(!d.decisions?.length)decisions.textContent='No live entry analysis yet. The worker remains paused until explicitly activated.';
   if(d.coverage)$('real-decision-coverage').textContent=d.coverage.checked+' analyzed in depth / '+d.coverage.liquidMarkets+' liquid / '+d.coverage.snapshotMarkets+' in public snapshot';
  }
  const list=$('real-worker-events');list.replaceChildren();
  for(const e of d.events||[]){const row=document.createElement('div'),time=document.createElement('small'),text=document.createElement('p');time.textContent=new Date(e.at).toLocaleTimeString();text.textContent=e.message;row.append(time,text);list.append(row)}
  $('account-mode-label').textContent=mode==='real'?(d.active?'LIVE / ARMED':'LIVE / PAUSED'):(d.active?'LIVE BOT ARMED':'SIMULATED');
 }
 async function refresh(){
  const jobs=[(async()=>{try{
   const d=await api('/api/live?action=bybit');
   $('real-connection-state').textContent='BYBIT CONNECTED';$('real-account-message').textContent='Actual account data · '+new Date().toLocaleTimeString();
   const money=v=>Number.isFinite(v)?'$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
   $('real-equity').textContent=money(d.equity);$('real-available').textContent=money(d.available);$('real-open').textContent=String(d.openPositions)+(d.hasMorePositions?'+':'');
   const rows=$('real-position-rows');rows.replaceChildren();
   for(const p of d.positions||[]){const row=document.createElement('tr');for(const value of [p.symbol,p.side,p.size,p.stopLoss||'—',p.takeProfit||'—']){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}rows.append(row)}
   if(!d.positions?.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=5;cell.textContent='No open broker positions.';row.append(cell);rows.append(row)}
  }catch(e){$('real-connection-state').textContent='NOT CONNECTED';$('real-account-message').textContent=e.message;for(const id of ['real-equity','real-available','real-open'])$(id).textContent='—';$('real-position-rows').replaceChildren()}})(),
  (async()=>{try{showWorker(await api('/api/bot'))}catch(e){worker=null;$('real-worker-state').textContent='UNAVAILABLE';$('real-worker-message').textContent=e.message;$('real-start').disabled=true;$('real-pause').disabled=true}})()];
  await Promise.all(jobs);
 }
 $('live-running-banner').addEventListener('click',()=>select('real'));
 document.querySelectorAll('[data-account-mode]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.accountMode)));
 $('real-refresh').addEventListener('click',refresh);
 $('real-activate-form').addEventListener('submit',async e=>{
  e.preventDefault();if(working||!worker||!worker.configured||!worker.serverEnabled)return;
  if($('real-confirm').value!=='START REAL $10 BOT'){$('real-worker-message').textContent='Type the activation phrase exactly.';return}
  working=true;showWorker(worker);let failure=null;
  try{const d=await api('/api/bot',{action:'start',confirm:$('real-confirm').value,dailyLimit:Number($('real-loss-budget').value)});$('real-confirm').value='';showWorker(d)}catch(err){failure=err.message}finally{working=false;if(worker)showWorker(worker);if(failure)$('real-worker-message').textContent=failure}
 });
 $('real-pause').addEventListener('click',async()=>{if(working)return;working=true;$('real-pause').disabled=true;let failure=null;try{showWorker(await api('/api/bot',{action:'pause'}))}catch(e){failure=e.message}finally{working=false;if(worker)showWorker(worker);if(failure)$('real-worker-message').textContent=failure}});
 window.addEventListener('hashchange',()=>{if(location.hash==='#real'&&mode!=='real')select('real')});
 select(mode,mode==='real');
 if(mode==='demo')api('/api/bot').then(showWorker).catch(()=>{});
 setInterval(()=>{if(!document.hidden&&!working){if(mode==='real')refresh();else api('/api/bot').then(showWorker).catch(()=>{})}},30000);
})();
