'use strict';
// Read-only closed-position history. Data comes from two existing virtual ledgers
// or from the authenticated Bybit closed-PnL endpoint, NEVER from mock fills.
(()=>{
 const $=id=>document.getElementById(id);
 if(!$('demo-trade-history')||!$('real-trade-history'))return;
 const demo={rows:[]},real={rows:[],loaded:false,nextCursor:'',anchor:null,weeksAgo:0,loading:false,rejected:0};
 const DAY=86400000;
 const numeric=v=>v===undefined||v===null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
 const positive=v=>{const x=numeric(v);return x!==null&&x>0?x:null};
 const money=v=>Number.isFinite(v)?(v<0?'−$':'$')+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4}):'—';
 const price=v=>Number.isFinite(v)&&v>0?v.toLocaleString('en-US',{minimumFractionDigits:v<1?5:2,maximumFractionDigits:v<1?8:5}):'—';
 const when=t=>Number.isFinite(t)&&t>0?new Date(t).toLocaleString():'—';
 const side=v=>v==='BUY'||v==='Buy'||v==='LONG'?'LONG':v==='SELL'||v==='Sell'||v==='SHORT'?'SHORT':'—';
 const target=id=>$(id);
 const source=prefix=>prefix==='demo'?demo:real;
 const text=(id,value)=>{if($(id))$(id).textContent=value};
 const fail=(id,error)=>text(id,String(error?.message||error||'History request unavailable'));
 const bybitRow=p=>{
  if(!p||typeof p!=='object'||p.source!=='Bybit'||!['LONG','SHORT'].includes(p.side)||
   !/^[A-Z0-9]{2,24}USDT$/.test(p.symbol)||!Number.isFinite(p.closedAt)||
   !Number.isFinite(p.net))return null;
  return {id:String(p.id||p.symbol+':'+p.closedAt),source:'Bybit',symbol:p.symbol,side:p.side,
   notional:positive(p.notional),entry:positive(p.entry),exit:positive(p.exit),
   net:p.net,closedAt:p.closedAt,openedAt:null,reason:'Bybit closed-position P&L',
   fees:numeric(p.fees)};
 };
 function virtualRecord(p,engine,id){
  if(!p||typeof p!=='object'||!Number.isFinite(p.closedAt)||!Number.isFinite(p.net)||
   !/^[A-Z0-9]{2,24}(?:USDT)?$/.test(p.symbol))return null;
  const market=p.symbol.endsWith('USDT')?p.symbol:p.symbol+'USDT';
  const a=numeric(p.openedAt),entry=positive(p.entry),exit=positive(p.exit);
  return {id:String(id),source:engine,symbol:market,side:side(p.side),
   notional:positive(p.notional),entry,exit,closedAt:p.closedAt,
   openedAt:Number.isFinite(a)&&a>0?a:null,net:p.net,
   reason:String(p.reason||'Virtual exit').slice(0,160),
   fees:engine==='Scalper'&&Number.isFinite(p.fees)&&Number.isFinite(p.slippage)?
    p.fees+p.slippage:null};
 }
 let lastScalp=null,lastDemoRead=0;
 function scalpWallet(key,version){
  const A=window.OmegaDemoSeconds;
  if(!A)return [];
  let saved=null;
  try{saved=JSON.parse(localStorage.getItem(key)||'null')}catch{return []}
  if(lastScalp&&key==='omega_demo_seconds_wallet_88_v1'&&lastScalp.version===A.SMALL_VERSION)
   saved=lastScalp;
  if(!saved)return [];
  let account;
  try{account=A.restore(saved,Date.now(),version)}catch{return []}
  return (account.ledger?.closed||[]).map((p,i)=>virtualRecord(p,'Scalper',key+':'+i+':'+p.closedAt)).filter(Boolean);
 }
 function readDemo(){
  const A=window.OmegaAccount,DS=window.OmegaDemoSeconds;
  const scalps=[
   ...scalpWallet('omega_demo_seconds_wallet_88_v1',DS?.SMALL_VERSION),
   ...scalpWallet('omega_demo_seconds_wallet_v1',DS?.VERSION)
  ];
  let futures=[],scope='Waiting for Demo Futures ledger';
  if(A){
   try{
    const account=A.read(),status=A.status();
    futures=(account?.closed||[]).map((p,i)=>
     virtualRecord(p,'Futures Trader',p.id||('future:'+i+':'+p.closedAt))).filter(Boolean);
    scope=status.mode==='cloud'?'synced Futures ledger':status.mode==='local'?'device Futures ledger':
     'Futures account connection not yet confirmed';
   }catch{scope='Unable to read Futures ledger'}
  }
  demo.rows=[...scalps,...futures].sort((a,b)=>b.closedAt-a.closedAt);
  const src=scalps.length+' Scalper / '+futures.length+' Futures records · '+scope;
  text('demo-history-status',src+' · '+new Date().toLocaleTimeString());
  render('demo');lastDemoRead=Date.now();
 }
 function filtered(prefix){
  const records=source(prefix).rows;
  const search=String($(prefix+'-history-search')?.value||'').trim().toUpperCase();
  const result=$(prefix+'-history-result')?.value||'all';
  const bot=$(prefix+'-history-bot')?.value||'all';
  const period=$(prefix+'-history-period')?.value||'all',now=Date.now();
  return records.filter(r=>{
   if(prefix==='demo'&&bot!=='all'&&r.source!==bot)return false;
   if(prefix==='demo'&&period!=='all'&&now-r.closedAt>Number(period)*DAY)return false;
   if(result==='win'&&!(r.net>0)||result==='loss'&&!(r.net<0)||result==='flat'&&r.net!==0)return false;
   if(search&&!r.symbol.toUpperCase().includes(search))return false;
   return true;
  }).sort((a,b)=>b.closedAt-a.closedAt);
 }
 function empty(tbody,message){
  const tr=document.createElement('tr'),td=document.createElement('td');
  td.colSpan=9;td.className='trade-history-empty';td.textContent=message;tr.append(td);tbody.append(tr);
 }
 function render(prefix){
  const tbody=$(prefix+'-history-rows');
  if(!tbody)return;
  const isReal=prefix==='real',isReady=!isReal||real.loaded;
  const rows=isReady?filtered(prefix):[],count=rows.length,
   total=rows.reduce((sum,r)=>sum+r.net,0),wins=rows.filter(r=>r.net>0).length;
  text(prefix+'-history-count',isReady?String(count):'—');
  text(prefix+'-history-win',!isReady||!count?'—':(100*wins/count).toFixed(1)+'%');
  text(prefix+'-history-net',isReady?money(total):'—');
  text(prefix+'-history-average',!isReady||!count?'—':money(total/count));
  for(const name of ['net','average']){
   const card=$(prefix+'-history-'+name);
   if(card)card.className=isReady&&count?(total<0?'trade-history-loss':'trade-history-profit'):'';
  }
  $(prefix+'-history-export').disabled=!isReady||!count;
  tbody.replaceChildren();
  if(!isReady){empty(tbody,'Sign in to Omega and load verified Bybit closed-position records.');return}
  if(!count){empty(tbody,isReal?'No Bybit closed-position records match this loaded seven-day window and filters.':'No saved Demo trades match these filters. Run either Demo bot to generate actual simulated closed trades.');return}
  for(const r of rows){
   const tr=document.createElement('tr');
   const cells=[when(r.closedAt),r.source,r.symbol,r.side,
    money(r.notional),price(r.entry),price(r.exit),money(r.net),r.reason];
   for(let i=0;i<cells.length;i++){
    const td=document.createElement('td');td.textContent=cells[i];
    if(i===7)td.className=r.net>0?'trade-history-up':r.net<0?'trade-history-down':'trade-history-muted';
    else if(i===8)td.title=r.reason;
    tr.append(td);
   }
   tbody.append(tr);
  }
 }
 function asCSV(prefix){
  const records=filtered(prefix);
  if(!records.length)return;
  // Escape spreadsheet formulas in text fields and escape commas/quotes/newlines.
  const cell=(value,unsafeText=false)=>{
   let s=String(value??'');
   if(unsafeText&&/^\s*[=+\-@]/.test(s))s="'"+s;
   return '"'+s.replaceAll('"','""')+'"';
  };
  const columns=['Closed UTC','Source','Symbol','Position side','Notional USDT',
   'Entry price','Exit price','Closed PnL USDT','Fees (if provided)','Reason'];
  const csv=[columns.map(x=>cell(x)).join(',')];
  for(const p of records){
   csv.push([cell(new Date(p.closedAt).toISOString()),cell(p.source,true),
    cell(p.symbol,true),cell(p.side,true),cell(p.notional??''),cell(p.entry??''),
    cell(p.exit??''),cell(p.net),cell(p.fees??''),cell(p.reason,true)].join(','));
  }
  const content='\uFEFF'+csv.join('\r\n'),blob=new Blob([content],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download='omega-'+prefix+'-closed-trades-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.append(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
 }
 function realBusy(busy){
  real.loading=busy;
  $('real-history-refresh').disabled=busy;
  $('real-history-week').disabled=busy;
  $('real-history-next').disabled=busy;
 }
 async function realRequest(query){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),13000);
  try{
   const res=await fetch('/api/live?'+new URLSearchParams({action:'history',...query}),{
    credentials:'same-origin',cache:'no-store',signal:controller.signal});
   const data=await res.json();
   if(!res.ok)throw Error(res.status===401?'Sign in to Omega to view authenticated Bybit trade history.':
    data?.error||'Could not read Bybit closed trades');
   if(data.broker!=='BYBIT'||data.source!=='BYBIT_CLOSED_PNL'||!Array.isArray(data.rows)||
    data.rows.length>100||typeof data.nextCursor!=='string'||
    !Number.isSafeInteger(data.anchor)||Number(data.weeksAgo)!==Number(real.weeksAgo))
    throw Error('Incomplete or mismatched Bybit history response; try again.');
   return data;
  }finally{clearTimeout(timer)}
 }
 async function refreshReal({more=false}={}){
  if(real.loading||document.hidden||document.body.dataset.account!=='real')return;
  if(more&&!real.nextCursor)return;
  const cursor=more?real.nextCursor:'',anchor=more?real.anchor:'';
  if(!more){real.rows=[];real.loaded=false;real.anchor=null;real.nextCursor='';real.rejected=0;render('real')}
  realBusy(true);
  text('real-history-status',more?'Loading additional Bybit closed trades…':'Reading actual Bybit closed trades…');
  try{
   const data=await realRequest({weeksAgo:String(real.weeksAgo),
    ...(cursor?{cursor,anchor:String(anchor)}:{})});
   const next=data.rows.map(bybitRow).filter(Boolean);
   const keys=new Set(real.rows.map(r=>r.id+':'+r.closedAt));
   for(const p of next)if(!keys.has(p.id+':'+p.closedAt)){
    real.rows.push(p);keys.add(p.id+':'+p.closedAt);
   }
   real.rows.sort((a,b)=>b.closedAt-a.closedAt);
   real.rejected+=Number(data.rejectedRows||0)+(data.rows.length-next.length);
   real.anchor=data.anchor;real.nextCursor=data.nextCursor;
   real.loaded=true;
   const from=new Date(data.windowStart).toLocaleDateString(),
    to=new Date(data.windowEnd).toLocaleDateString();
   const pending=real.nextCursor?' · More records available; select Load more':' · Window fully fetched';
   text('real-history-status','BYBIT VERIFIED · '+from+'–'+to+' · '+real.rows.length+
    ' loaded closed-position records'+pending+(real.rejected?' · '+real.rejected+' incomplete records omitted':''));
   $('real-history-next').hidden=!real.nextCursor||real.rows.length>=1000;
   render('real');
  }catch(e){
   if(!more){real.loaded=false;real.rows=[];real.nextCursor='';render('real')}
   fail('real-history-status','BYBIT HISTORY NOT VERIFIED: '+(e.name==='AbortError'?'Request timed out':e.message)+
    (more?' · Previous verified pages remain visible.':''));
  }finally{realBusy(false)}
 }
 for(let w=1;w<=25;w++){
  const option=document.createElement('option');option.value=String(w);
  option.textContent=(w*7)+'–'+((w+1)*7)+' days ago';
  $('real-history-week').append(option);
 }
 $('real-history-week').addEventListener('change',()=>{
  real.weeksAgo=Number($('real-history-week').value);
  real.rows=[];real.loaded=false;real.nextCursor='';real.anchor=null;real.rejected=0;
  $('real-history-next').hidden=true;render('real');refreshReal();
 });
 $('real-history-refresh').addEventListener('click',()=>refreshReal());
 $('real-history-next').addEventListener('click',()=>refreshReal({more:true}));
 $('demo-history-refresh').addEventListener('click',readDemo);
 for(const prefix of ['demo','real']){
  for(const kind of ['result','search',...(prefix==='demo'?['bot','period']:[])]){
   const el=$(prefix+'-history-'+kind);
   el.addEventListener(kind==='search'?'input':'change',()=>render(prefix));
  }
  $(prefix+'-history-export').addEventListener('click',()=>asCSV(prefix));
 }
 window.addEventListener('omega:paper-updated',readDemo);
 window.addEventListener('omega:paper-reset',readDemo);
 window.addEventListener('omega:demo-scalper-state',event=>{
  if(event.detail?.wallet)lastScalp=event.detail.wallet;
  if(Date.now()-lastDemoRead>3000&&document.body.dataset.account==='demo')readDemo();
 });
 window.addEventListener('storage',event=>{
  if(['omega_demo_seconds_wallet_88_v1','omega_demo_seconds_wallet_v1',
   window.OmegaAccount?.KEY].includes(event.key)){lastScalp=null;readDemo()}
 });
 window.addEventListener('omega:account-mode',()=>{
  if(document.body.dataset.account==='real'){if(!real.loaded)refreshReal()}
  else readDemo();
 });
 document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){if(document.body.dataset.account==='real'){if(!real.loaded)refreshReal()}
   else readDemo()}
 });
 window.OmegaAccount?.ready?.then(readDemo).catch(readDemo);
 readDemo();render('real');
 if(document.body.dataset.account==='real')refreshReal();
})();
