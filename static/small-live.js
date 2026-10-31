'use strict';
(()=>{
 const $=id=>document.getElementById(id),panel=$('small-live-panel');
 if(!panel)return;
 const state=$('small-live-state'),status=$('small-live-status'),balance=$('small-live-equity'),
  available=$('small-live-available'),symbol=$('small-live-symbol'),side=$('small-live-side'),
  previewBtn=$('small-live-preview'),submit=$('small-live-submit'),confirmation=$('small-live-confirm'),
  ticket=$('small-live-ticket'),refreshBtn=$('small-live-refresh'),reconcile=$('small-live-reconcile');
 let liveStatus=null,previewToken=null,previewExpires=0,lastOrder=null,busy=false;
 const money=n=>Number.isFinite(n)?(n<0?'−$':'$')+Math.abs(n).toFixed(2):'—';
 async function api(url,body){
  const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),body?48000:24000);
  try{
   const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
    headers:body?{'Content-Type':'application/json','X-OMEGA-REQUEST':'1'}:undefined,
    body:body?JSON.stringify(body):undefined,signal:ctl.signal});
   let data;try{data=await response.json()}catch{throw Error('Invalid response from live trading service')}
   if(!response.ok)throw Error(String(data.error||'Request failed').slice(0,220));
   return data;
  }finally{clearTimeout(timeout)}
 }
 function fields(items){
  ticket.replaceChildren();
  for(const [label,value] of items){
   const box=document.createElement('div'),name=document.createElement('small'),val=document.createElement('strong');
   name.textContent=label;val.textContent=String(value);box.append(name,val);ticket.append(box);
  }
  ticket.hidden=false;
 }
 function reset(){
  previewToken=null;previewExpires=0;ticket.hidden=true;
  ticket.replaceChildren();confirmation.value='';submit.disabled=true;
 }
 function canExecute(){
  submit.disabled=busy||!liveStatus?.enabled||!previewToken||
   Date.now()>=previewExpires||confirmation.value!=='PLACE REAL $15 TRADE';
 }
 async function refresh(){
  if(busy)return;
  refreshBtn.disabled=true;
  try{
   const info=await api('/api/manual-live?profile=small&action=status');
   liveStatus=info;
   state.textContent=!info.configured?'BYBIT NOT CONNECTED':info.enabled?'REAL ORDER CONFIRMATION AVAILABLE':'READ ONLY / ORDERS OFF';
   previewBtn.disabled=!info.configured;
   const account=await api('/api/live?action=bybit');
   balance.textContent=money(account.equity);
   available.textContent=money(account.available);
   if(!Number.isFinite(account.equity)||!Number.isFinite(account.available))
    throw Error('Bybit did not return valid balance values');
   if(account.equity<info.minEquityUsd)
    status.textContent='Account connected. Trading blocked: the $15 position at 20% exposure requires at least $75 equity. No order sent.';
   else if(account.available<15)
    status.textContent='Account connected. Trading blocked: less than $15 available. No order sent.';
   else if(account.openPositions>0)
    status.textContent='Account connected with existing Bybit positions. You must resolve those before a new small trade.';
   else status.textContent=info.enabled?'Real Bybit connected. Prepare a preview and confirm each trade individually. No automatic entries.':
    'Real account connected in read-only mode. You can review a preview, but funded order submission remains disabled by the private server.';
  }catch(e){
   state.textContent='CONNECTION NOT READY';balance.textContent='—';available.textContent='—';
   previewBtn.disabled=true;status.textContent='NO ORDER SENT: '+e.message;
  }finally{refreshBtn.disabled=false;canExecute()}
 }
 async function preview(){
  if(busy)return;
  busy=true;reset();previewBtn.disabled=true;status.textContent='Reading Bybit quote, exchange quantity rules and account risk. No order sent.';
  try{
   const d=await api('/api/manual-live?profile=small',{profile:'small',action:'preview',symbol:symbol.value,side:side.value});
   previewToken=d.previewToken;previewExpires=Date.now()+d.expiresInSeconds*1000;
   fields([['SYMBOL',d.symbol],['SIDE',d.side],['BROKER ORDER NOTIONAL',money(d.notional)],
    ['QUANTITY',d.quantity],['EST. ENTRY',d.entryEstimate],['STOP LOSS',d.stopLoss],
    ['TAKE PROFIT',d.takeProfit],['EST. NET TARGET',money(d.estimatedNetTarget)],
    ['EST. STOP + COSTS',money(d.estimatedStopRiskUsd)],['PREVIEW EXPIRY',d.expiresInSeconds+'s']]);
   status.textContent=d.executionEnabled?
    'REAL FUNDS: This is a manual order preview, not a profitable signal. Review the stop, target and costs. Type PLACE REAL $15 TRADE to authorize one order.':
    'PREVIEW ONLY: Funded orders are disabled by the private server. No trade can be placed until that setting is explicitly enabled.';
  }catch(e){status.textContent='NO ORDER SENT: '+e.message;reset()}
  finally{busy=false;previewBtn.disabled=!liveStatus?.configured;canExecute()}
 }
 async function execute(){
  if(busy||!previewToken||Date.now()>=previewExpires||confirmation.value!=='PLACE REAL $15 TRADE'||!liveStatus?.enabled)return;
  busy=true;const signed=previewToken;reset();previewBtn.disabled=true;submit.disabled=true;
  status.textContent='Submitting ONE user-confirmed real order. Do not retry if Bybit does not return a clear result.';
  try{
   const result=await api('/api/manual-live?profile=small',{profile:'small',action:'execute',confirm:'PLACE REAL $15 TRADE',previewToken:signed});
   lastOrder={symbol:result.symbol,link:result.orderLinkId};
   fields([['BYBIT MARKET',result.symbol],['DIRECTION',result.side],['ORDER LINK',result.orderLinkId],
    ['ACKNOWLEDGED ORDER ID',result.orderId||'Awaiting Bybit reconciliation'],
    ['POSITION VALUE',money(result.notional)],['STOP LOSS',result.stopLoss],['TAKE PROFIT',result.takeProfit]]);
   reconcile.hidden=false;
   status.textContent='Bybit acknowledged the request; actual fill is not yet verified. Check Bybit positions and exchange TP/SL before another trade.';
  }catch(e){
   status.textContent='REAL ORDER NOT CONFIRMED: '+e.message+' Inspect Bybit before attempting another funded trade.';
  }finally{busy=false;previewBtn.disabled=!liveStatus?.configured;canExecute()}
 }
 async function checkOrder(){
  if(!lastOrder||busy)return;
  busy=true;reconcile.disabled=true;
  try{
   const params=new URLSearchParams({action:'order',symbol:lastOrder.symbol,link:lastOrder.link});
   const d=await api('/api/manual-live?profile=small&'+params.toString());
   status.textContent='Bybit order '+d.orderLinkId+': '+d.status+'. Verify your position and protective TP/SL directly at Bybit.';
  }catch(e){status.textContent='Order reconciliation unavailable: '+e.message}
  finally{busy=false;reconcile.disabled=false}
 }
 previewBtn.addEventListener('click',preview);
 refreshBtn.addEventListener('click',refresh);
 submit.addEventListener('click',execute);
 reconcile.addEventListener('click',checkOrder);
 confirmation.addEventListener('input',canExecute);
 symbol.addEventListener('change',()=>{reset();status.textContent='Pair changed. Prepare a new live order preview.'});
 side.addEventListener('change',()=>{reset();status.textContent='Side changed. Prepare a new live order preview.'});
 document.querySelector('[data-account-mode="real"]')?.addEventListener('click',refresh);
 setInterval(()=>{if(previewToken&&Date.now()>=previewExpires){
  reset();status.textContent='Trade preview expired. Request a new market quote and account check.';
 }},1000);
 refresh();
})();