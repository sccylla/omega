'use strict';
(()=>{
 const $=id=>document.getElementById(id),button=$('live-preview'),check=$('live-check-readiness');
 if(!button||!check)return;
 const setState=(id,label,state)=>{const n=document.createElement('div');n.className='live-readiness-item '+state;const marker=document.createElement('span');marker.textContent=state==='ok'?'✓':state==='warn'?'!':'○';const t=document.createElement('span');t.textContent=label;n.append(marker,t);$(id).append(n)};
 async function request(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),28000);
  try{
   const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal});
   let data;try{data=await response.json()}catch{throw Error('Invalid server response')}
   if(!response.ok)throw Error(data.error||'Request failed (HTTP '+response.status+')');
   return data;
  }finally{clearTimeout(timer)}
 }
 async function ready(){
  check.disabled=true;const grid=$('live-readiness-grid'),summary=$('live-readiness-summary');
  grid.replaceChildren();summary.textContent='Checking account configuration. No live orders are sent.';
  try{
   const s=await request('/api/live?action=status');
   setState('live-readiness-grid',s.bybitConfigured?'Bybit credentials stored · permission not yet verified':'Bybit API credentials not configured',s.bybitConfigured?'warn':'missing');
   if(!s.authenticated){
    setState('live-readiness-grid','Sign in to verify your actual account and live worker','missing');
    summary.textContent='Sign in first. A configured API key is not proof of trade permission, balance, or an active worker.';
    return;
   }
   setState('live-readiness-grid','Signed in to your OMEGA dashboard','ok');
   const [w,b]=await Promise.allSettled([request('/api/bot'),request('/api/live?action=bybit')]);
   if(b.status==='fulfilled'){
    const d=b.value,valid=Number.isFinite(d.equity)&&Number.isFinite(d.available);
    setState('live-readiness-grid',valid?'Bybit account read verified · $'+d.equity.toFixed(2)+' equity / $'+d.available.toFixed(2)+' available':'Account response missing balance',valid?'ok':'missing');
    if(valid)setState('live-readiness-grid',d.equity>=50&&d.available>=10?'Worker balance threshold met ($50 equity, $10 available)':'Insufficient balance for worker startup ($50 equity, $10 available)',d.equity>=50&&d.available>=10?'ok':'missing');
   }else setState('live-readiness-grid','Broker account read failed: '+b.reason.message,'missing');
   if(w.status==='fulfilled'){
    const d=w.value;
    setState('live-readiness-grid',d.configured?'Persistent worker has Bybit credentials':'Worker missing Bybit credentials',d.configured?'ok':'missing');
    setState('live-readiness-grid',d.serverEnabled?'Dedicated live-order server switch enabled':'Live-order server switch off',d.serverEnabled?'warn':'missing');
    setState('live-readiness-grid',d.pending?'Unresolved broker order requires reconciliation':d.active?'Worker armed; exchange protections must stay monitored':'Worker paused; start requires the activation phrase',d.pending?'missing':d.active?'warn':'warn');
    summary.textContent=d.active?'Live worker reports ARMED. Verify positions and stops at Bybit; this check did not submit an order.':d.configured&&d.serverEnabled&&!d.pending?'Use the dedicated activation form below. Its final checks must pass before a funded order is allowed.':'Live entries remain disabled. Configure a persistent worker with a durable state directory and its private live-order switch, then activate explicitly.';
   }else{
    setState('live-readiness-grid','Persistent worker unavailable: '+w.reason.message,'missing');
    summary.textContent='Vercel cannot run the persistent live trading worker. Configure a separate durable worker and connect it using OMEGA_WORKER_URL and OMEGA_WORKER_TOKEN. This page cannot activate live trading without it.';
   }
  }catch(e){setState('live-readiness-grid','Readiness check unavailable: '+e.message,'missing');summary.textContent='No change to your live trading state.'}
  finally{check.disabled=false}
 }
 let running=null;
 function showDecision(parent,plan,symbol){
  const item=document.createElement('div');item.className='live-candidate '+(plan?.eligible?'qualified':'waiting');
  const left=document.createElement('div'),name=document.createElement('strong'),reason=document.createElement('p');
  name.textContent=symbol+' · '+(plan?.eligible?plan.side:'WAIT');
  const fail=(plan?.checks||[]).filter(c=>!c.pass&&c.required!==false).slice(0,2);
  reason.textContent=plan?.eligible?'All required live market checks passed at snapshot time; no order submitted.':(fail.map(c=>c.label).join(' · ')||plan?.reason||'No qualified live setup');
  left.append(name,reason);const tag=document.createElement('span');tag.textContent=plan?.eligible?'CURRENTLY QUALIFIED':'NO ENTRY';item.append(left,tag);parent.append(item);
 }
 async function preview(){
  if(running){running.abort();return}
  const controller=new AbortController();running=controller;button.textContent='Stop analysis';const list=$('live-candidate-rows'),msg=$('live-preview-status');
  list.replaceChildren();msg.textContent='Loading the Bybit futures universe…';
  try{
   const market=await request('/api/scanner?market=futures&page=1&size=15',{signal:controller.signal});
   if(!Array.isArray(market.rows))throw Error('Scanner returned no market rows');
   const screened=market.rows.filter(r=>/^[A-Z0-9]{2,24}USDT$/.test(r.symbol)&&Number.isFinite(r.turnover24h)&&r.turnover24h>=10000000&&Number.isFinite(r.spreadBps)&&r.spreadBps>=0&&r.spreadBps<=8);
   const candidates=screened.slice(0,8),results=[];
   msg.textContent=market.universe+' markets screened for liquidity/spread. Evaluating '+candidates.length+' recent high-ranked candidates with strict live rules; no orders.';
   let next=0,done=0;
   await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{
    while(next<candidates.length&&!controller.signal.aborted){
     const candidate=candidates[next++];
     let plan;
     try{const d=await request('/api/decision?'+new URLSearchParams({symbol:candidate.symbol,mode:'live'}),{signal:controller.signal});plan=d.decision}
     catch(e){if(controller.signal.aborted)return;plan={eligible:false,reason:'Evidence unavailable: '+e.message}}
     results.push({symbol:candidate.symbol,plan});done++;
     msg.textContent=market.universe+' markets screened · '+done+'/'+candidates.length+' deeply evaluated · zero orders placed';
    }
   }));
   if(controller.signal.aborted){msg.textContent='Analysis stopped; zero live orders placed.';return}
   results.sort((a,b)=>Number(b.plan?.eligible)-Number(a.plan?.eligible)||(b.plan?.rank||0)-(a.plan?.rank||0));
   if(!results.length)list.textContent='No markets could be analyzed at this time.';
   for(const x of results)showDecision(list,x.plan,x.symbol);
   msg.textContent=results.filter(x=>x.plan?.eligible).length+' eligible at snapshot time among '+results.length+' inspected · '+market.universe+' screened · no live orders';
  }catch(e){msg.textContent=controller.signal.aborted?'Analysis stopped; zero orders placed.':'Research unavailable: '+e.message}
  finally{running=null;button.textContent='Analyze markets · no orders'}
 }
 button.addEventListener('click',preview);
 check.addEventListener('click',ready);
 document.querySelector('[data-account-mode="real"]')?.addEventListener('click',ready);
 ready();
})();
