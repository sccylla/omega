'use strict';
(()=>{
 const $=id=>document.getElementById(id),button=$('live-preview'),check=$('live-check-readiness');
 if(!button||!check)return;
 const setState=(id,label,state)=>{const n=document.createElement('div');n.className='live-readiness-item '+state;const marker=document.createElement('span');marker.textContent=state==='ok'?'✓':state==='warn'?'!':'○';const t=document.createElement('span');t.textContent=label;n.append(marker,t);$(id).append(n)};
 async function request(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),28000);
  try{
   const response=await fetch(url,{method:options.post?'POST':'GET',cache:'no-store',credentials:'same-origin',headers:options.post?{'Content-Type':'application/json','X-OMEGA-REQUEST':'1'}:undefined,body:options.post?JSON.stringify(options.post):undefined,signal:options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal});
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
   const [w,b]=await Promise.allSettled([request('/api/manual-live'),request('/api/live?action=bybit')]);
   if(b.status==='fulfilled'){
    const d=b.value,valid=Number.isFinite(d.equity)&&Number.isFinite(d.available);
    setState('live-readiness-grid',valid?'Bybit account read verified · $'+d.equity.toFixed(2)+' equity / $'+d.available.toFixed(2)+' available':'Account response missing balance',valid?'ok':'missing');
    if(valid)setState('live-readiness-grid',d.equity>=50&&d.available>=10?'Worker balance threshold met ($50 equity, $10 available)':'Insufficient balance for worker startup ($50 equity, $10 available)',d.equity>=50&&d.available>=10?'ok':'missing');
   }else setState('live-readiness-grid','Broker account read failed: '+b.reason.message,'missing');
   if(w.status==='fulfilled'){
    const d=w.value;
    setState('live-readiness-grid',d.configured?'Bybit credentials available for manual order requests':'Bybit trading credentials missing',d.configured?'ok':'missing');
    setState('live-readiness-grid',d.enabled?'Manual execution switch enabled · every order needs confirmation':'Manual order execution switch is off',d.enabled?'warn':'missing');
    summary.textContent=d.enabled&&d.configured?'Manual $10 trading is available after fresh signal, balance, exchange and risk checks. No order is automatic.':'Manual execution is currently disabled; market scanning remains read-only.';
   }else{
    setState('live-readiness-grid','Manual order endpoint unavailable: '+w.reason.message,'missing');
    summary.textContent='Real-money trading is not ready. Market scanning remains read-only.';
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
  left.append(name,reason);const tag=document.createElement('span');tag.textContent=plan?.eligible?'QUALIFIED':'NO ENTRY';item.append(left,tag);
  if(plan?.eligible){const prepare=document.createElement('button');prepare.type='button';prepare.textContent='Prepare $10 LIVE';prepare.addEventListener('click',()=>prepareManual(symbol));item.append(prepare)}
  parent.append(item);
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
   msg.textContent=market.universe+' markets screened for liquidity/spread. Evaluating '+candidates.length+' high-ranked candidates with live rules; no orders.';
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
  finally{running=null;button.textContent='Scan trading pairs · no orders'}
 }
 let previewToken=null,preparing=false,submitting=false;
 const msg=$('live-order-message'),summary=$('live-ticket-summary'),entryConfirm=$('live-order-confirm'),execute=$('live-execute');
 function resetPreview(){
  previewToken=null;summary.replaceChildren();summary.hidden=true;entryConfirm.value='';execute.disabled=true;
 }
 function field(k,v){
  const div=document.createElement('div'),name=document.createElement('small'),val=document.createElement('strong');
  name.textContent=k;val.textContent=v;div.append(name,val);summary.append(div);
 }
 async function prepareManual(symbol){
  if(preparing||submitting)return;
  preparing=true;resetPreview();const s=String(symbol||'').trim().toUpperCase();
  msg.textContent='Preparing a $10 LIVE order for '+s+'; this step submits no funded order.';
  try{
   if(!/^[A-Z0-9]{2,24}USDT$/.test(s))throw Error('Enter a Bybit USDT perpetual pair, such as XRPUSDT.');
   const d=await request('/api/manual-live',{post:{action:'preview',symbol:s}});
   previewToken=d.previewToken;summary.hidden=false;
   field('MARKET',d.symbol);field('DIRECTION',d.side);field('EST. NOTIONAL','
 check.addEventListener('click',ready);
 document.querySelector('[data-account-mode="real"]')?.addEventListener('click',ready);
 ready();
})();
+d.notional.toFixed(2));
   field('EST. ENTRY','
 check.addEventListener('click',ready);
 document.querySelector('[data-account-mode="real"]')?.addEventListener('click',ready);
 ready();
})();
+d.entryEstimate);field('STOP LOSS','
 check.addEventListener('click',ready);
 document.querySelector('[data-account-mode="real"]')?.addEventListener('click',ready);
 ready();
})();
+d.stopLoss);field('TAKE PROFIT','
 check.addEventListener('click',ready);
 document.querySelector('[data-account-mode="real"]')?.addEventListener('click',ready);
 ready();
})();
+d.takeProfit);
   field('EST. STOP RISK','
 check.addEventListener('click',ready);
 document.querySelector('[data-account-mode="real"]')?.addEventListener('click',ready);
 ready();
})();
+d.estimatedStopRiskUsd.toFixed(3));field('MODEL NET TARGET','
 check.addEventListener('click',ready);
 document.querySelector('[data-account-mode="real"]')?.addEventListener('click',ready);
 ready();
})();
+d.targetNet.toFixed(3));field('PREVIEW EXPIRES',d.expiresInSeconds+' seconds');
   msg.textContent='Preview ready. Read the entry, stop and target. Type the full confirmation phrase to submit one live order.';
  }catch(e){msg.textContent='NO ORDER SENT: '+e.message}
  finally{preparing=false}
 }
 entryConfirm?.addEventListener('input',()=>{execute.disabled=!previewToken||entryConfirm.value!=='PLACE REAL $10 TRADE'||submitting});
 execute?.addEventListener('click',async()=>{
  if(!previewToken||submitting||entryConfirm.value!=='PLACE REAL $10 TRADE')return;
  submitting=true;execute.disabled=true;const token=previewToken;previewToken=null;
  msg.textContent='Confirming fresh market and account risk checks. DO NOT resubmit if the outcome becomes uncertain.';
  try{
   const d=await request('/api/manual-live',{post:{action:'execute',confirm:'PLACE REAL $10 TRADE',previewToken:token}});
   msg.textContent='Bybit order request accepted: '+d.symbol+' '+d.side+' · '+d.orderStatus+'. Verify the fill and stop/target prices at Bybit now.';
   summary.replaceChildren();summary.hidden=false;
   field('BYBIT ORDER ID',d.orderId||'Check broker');field('STATUS',d.orderStatus);field('MARKET',d.symbol);
   field('STOP LOSS',d.stopLoss);field('TAKE PROFIT',d.takeProfit);field('POSITION','Verify in Bybit');
  }catch(e){msg.textContent='ORDER NOT CONFIRMED: '+e.message+' Do not repeat automatically; inspect your Bybit orders and positions first.';summary.hidden=true}
  finally{submitting=false;entryConfirm.value=''}
 });
 $('live-prepare-specific')?.addEventListener('click',()=>{
  let symbol=$('live-symbol')?.value.trim().toUpperCase()||'';
  if(symbol&&!symbol.endsWith('USDT'))symbol+='USDT';
  prepareManual(symbol);
 });
 button.addEventListener('click',preview);
 check.addEventListener('click',ready);
 document.querySelector('[data-account-mode="real"]')?.addEventListener('click',ready);
 ready();
})();
