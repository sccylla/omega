'use strict';
// Read-only Open Trades monitor. Actual real positions come ONLY from the
// authenticated Bybit API; virtual fills stay separate and are never labeled real.
(()=>{
const $=id=>document.getElementById(id);
if(!$('real-open-rows')||!$('demo-scalper-open-rows')||!$('demo-futures-open-rows'))return;
const money=n=>Number.isFinite(n)?(n<0?'−$':'$')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4}):'—';
const price=n=>Number.isFinite(n)&&n>0?
 n.toLocaleString('en-US',{minimumFractionDigits:n<1?5:2,maximumFractionDigits:n<1?8:5}):'—';
const numeric=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const positive=v=>{const n=numeric(v);return n!==null&&n>0?n:null};
let liveBusy=false,scalpState=null,futuresQuotes=new Map(),futuresBusy=false;
let lastFuturesQuote=0,initialFuturesLoaded=false;
const row=(body,values,classes={})=>{
 const tr=document.createElement('tr');
 for(let i=0;i<values.length;i++){
  const td=document.createElement('td');td.textContent=String(values[i]);if(classes[i])td.className=classes[i];tr.append(td);
 }
 body.append(tr);
};
function empty(body,message){
 body.replaceChildren();
 const tr=document.createElement('tr'),td=document.createElement('td');
 td.colSpan=7;td.className='open-trades-empty';td.textContent=message;tr.append(td);body.append(tr);
}
const direction=s=>s==='Buy'||s==='BUY'?'LONG':s==='Sell'||s==='SELL'?'SHORT':'UNKNOWN';
function pnlClass(n){return !Number.isFinite(n)?'open-trades-unavailable':n>=0?'open-trades-positive':'open-trades-negative'}
const fresh=q=>q&&Number.isFinite(q.observedAt)&&Date.now()>=q.observedAt-1000&&Date.now()-q.observedAt<=3000;
function paintScalps(){
 const A=window.OmegaDemoSeconds,H=window.OmegaSecondsShadow,body=$('demo-scalper-open-rows');
 if(!A||!H){empty(body,'Demo Scalper account has not loaded.');return}
 let a,quotes;
 if(scalpState){a=scalpState.wallet;quotes=scalpState.quotes||{}}
 else{
  try{
   const value=JSON.parse(localStorage.getItem('omega_demo_seconds_wallet_88_v1')||'null');
   a=A.restore(value,Date.now(),A.SMALL_VERSION);
  }catch{a=A.smallInitial()}
  quotes={};
 }
 const positions=H.openList(a.ledger);
 body.replaceChildren();
 $('demo-scalper-open-status').textContent=positions.length+'/10 virtual positions · '+(scalpState?'Live browser quotes':'Saved on this device; waiting for live quotes');
 if(!positions.length){empty(body,'No open Demo Scalper positions. Start the Demo Scalper and wait for a qualifying setup.');return}
 for(const p of positions){
  const q=quotes[p.symbol],usable=fresh(q)&&positive(q.bidVwap)&&positive(q.askVwap)&&q.askVwap>q.bidVwap;
  const exit=usable?(p.side==='BUY'?q.bidVwap:q.askVwap):null;
  const pl=usable?H.pnl(p,q):null;
  const stop=Number.isFinite(p.stopNet)?'−'+money(p.stopNet):'—';
  const target=Number.isFinite(p.targetNet)?'+'+money(p.targetNet):'—';
  row(body,[p.symbol,direction(p.side),money(p.notional),price(p.entry),
   exit===null?'— (no fresh quote)':price(exit),pl===null?'—':money(pl),
   target+' / '+stop],{1:direction(p.side)==='LONG'?'open-trades-long':'open-trades-short',5:pnlClass(pl)});
 }
}
function futuresAccount(){
 const A=window.OmegaAccount;
 if(!A)return null;
 try{const a=A.read();return a&&Array.isArray(a.positions)?a:null}catch{return null}
}
function paintFutures(){
 const account=futuresAccount(),body=$('demo-futures-open-rows');
 if(!account){empty(body,'Waiting for your Demo Futures account to load…');$('demo-futures-open-status').textContent='Connecting to virtual account…';updateDemoCount();return}
 const positions=account.positions;
 body.replaceChildren();
 const source=window.OmegaAccount?.status()?.mode==='cloud'?'Synced demo account':'Local demo account';
 $('demo-futures-open-status').textContent=positions.length+'/10 virtual positions · '+source;
 if(!positions.length)empty(body,'No open Demo Futures positions. Start Futures Trader to scan for long or short setups.');
 for(const p of positions){
  const cached=futuresQuotes.get(p.symbol),q=cached&&Date.now()-cached.at<30000?cached:null;
  const exit=q?(p.side==='BUY'?q.bid:q.ask):null,entry=positive(p.entry),qty=positive(p.qty);
  const fee=window.OmegaPaper?.FEE_RATE??.0006;
  const pl=exit!==null&&entry!==null&&qty!==null?
   (p.side==='BUY'?1:-1)*qty*(exit-entry)-(Number(p.entryFee)||0)-qty*exit*fee:null;
  row(body,[p.symbol+'USDT',direction(p.side),money(p.notional),price(entry),
   exit===null?'— (fetching quote)':price(exit),
   pl===null?'—':money(pl),
   price(positive(p.target))+' / '+price(positive(p.stop))],
   {1:p.side==='BUY'?'open-trades-long':'open-trades-short',5:pnlClass(pl)});
 }
 updateDemoCount();
}
function updateDemoCount(){
 const future=futuresAccount()?.positions?.length||0;
 let scalp=0;try{
  const A=window.OmegaDemoSeconds,H=window.OmegaSecondsShadow;
  if(A&&H){
   const state=scalpState?.wallet||A.restore(JSON.parse(localStorage.getItem('omega_demo_seconds_wallet_88_v1')||'null'),Date.now(),A.SMALL_VERSION);
   scalp=H.openList(state.ledger).length;
  }
 }catch{}
 $('demo-open-count').textContent=(future+scalp)+' open';
}
async function updateFuturesQuotes(force=false){
 const account=futuresAccount(),positions=account?.positions||[];
 if(futuresBusy||document.hidden||document.body.dataset.account!=='demo')return;
 if(!force&&Date.now()-lastFuturesQuote<18000){paintFutures();return}
 lastFuturesQuote=Date.now();if(!positions.length){futuresQuotes.clear();paintFutures();return}
 if(!window.OmegaDecision?.quote){paintFutures();return}
 futuresBusy=true;
 try{
  // Three at a time: keep price loading bounded rather than ten concurrent
  // requests per browser tab. Never synthesize quotes when a request fails.
  for(let i=0;i<positions.length;i+=3){
   const batch=positions.slice(i,i+3);
   await Promise.all(batch.map(async p=>{
    try{
     const q=await window.OmegaDecision.quote(p.symbol);
     futuresQuotes.set(p.symbol,{bid:q.bid,ask:q.ask,at:Date.now()});
    }catch{futuresQuotes.delete(p.symbol)}
   }));
  }
 }finally{futuresBusy=false;initialFuturesLoaded=true;paintFutures()}
}
async function refreshReal(){
 if(liveBusy||document.hidden||document.body.dataset.account!=='real')return;
 liveBusy=true;$('real-open-refresh').disabled=true;
 const status=$('real-open-status'),body=$('real-open-rows');
 status.textContent='Checking authenticated Bybit positions…';
 try{
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  let response,data;
  try{
   response=await fetch('/api/live?action=bybit',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   data=await response.json();
  }finally{clearTimeout(timeout)}
  if(!response.ok)throw Error(response.status===401?'Sign into Omega to view real positions.':data?.error||'Bybit position read failed');
  if(data.broker!=='BYBIT'||!Array.isArray(data.positions)||!Number.isInteger(data.openPositions)||
   data.openPositions<0||data.openPositions<data.positions.length)throw Error('Incomplete Bybit positions response. No position count assumed.');
  $('real-open-count').textContent=data.openPositions+(data.hasMorePositions?'+':'')+' / 10';
  $('real-open').textContent=String(data.openPositions)+(data.hasMorePositions?'+':'');
  $('live-auto-positions').textContent=data.openPositions+' / 10';
  status.textContent='BYBIT VERIFIED · '+new Date(data.fetchedAt||Date.now()).toLocaleTimeString()+
   ' · '+data.openPositions+' open funded position(s)'+(data.hasMorePositions?' · More positions exist; pagination incomplete':'');
  body.replaceChildren();
  if(data.positions.length===0&&!data.hasMorePositions)empty(body,'No open REAL positions on this Bybit account. An order preview or acknowledgement is not an open trade.');
  else for(const p of data.positions){
   const side=direction(p.side),entry=positive(p.avgPrice),mark=positive(p.markPrice),size=positive(p.size);
   const notional=positive(p.positionValue)??(mark&&size?mark*size:null);
   const pnl=numeric(p.unrealisedPnl),tp=positive(p.takeProfit),sl=positive(p.stopLoss);
   const protection=tp&&sl?price(tp)+' / '+price(sl):tp?price(tp)+' / NO STOP':sl?'NO TP / '+price(sl):'TP / SL NOT SET';
   row(body,[p.symbol||'UNKNOWN',side,notional===null?'—':money(notional),
    price(entry),price(mark),pnl===null?'—':money(pnl),protection],{
    1:side==='LONG'?'open-trades-long':side==='SHORT'?'open-trades-short':'open-trades-warning',
    5:pnlClass(pnl),6:tp&&sl?'':'open-trades-warning'});
  }
  if(data.hasMorePositions&&data.positions.length===0)empty(body,'Bybit reports additional positions but returned no complete first page. Refresh or inspect Bybit.');
 }catch(e){
  $('real-open-count').textContent='— / 10';
  status.textContent='BYBIT NOT VERIFIED: '+(e.name==='AbortError'?'Connection timed out':e.message);
  empty(body,'Unable to verify current real positions. Sign into Omega, check Bybit API permissions, then refresh. No open-trade count assumed.');
 }finally{liveBusy=false;$('real-open-refresh').disabled=false}
}
function refreshDemo(){
 paintScalps();paintFutures();updateFuturesQuotes(true);
}
$('real-open-refresh').addEventListener('click',refreshReal);
$('demo-open-refresh').addEventListener('click',refreshDemo);
window.addEventListener('omega:demo-scalper-state',event=>{
 if(event.detail?.wallet){scalpState=event.detail;paintScalps();updateDemoCount()}
});
window.addEventListener('omega:paper-updated',()=>{paintFutures();updateFuturesQuotes()});
window.addEventListener('omega:paper-reset',()=>{futuresQuotes.clear();paintFutures()});
window.addEventListener('storage',event=>{
 if(event.key==='omega_demo_seconds_wallet_88_v1'){scalpState=null;paintScalps();updateDemoCount()}
 if(event.key===window.OmegaAccount?.KEY){paintFutures();updateFuturesQuotes()}
});
window.addEventListener('omega:account-mode',()=>{
 if(document.body.dataset.account==='real')refreshReal();
 else refreshDemo();
});
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden){if(document.body.dataset.account==='real')refreshReal();else refreshDemo()}
});
window.OmegaAccount?.ready?.then(()=>{paintFutures();updateFuturesQuotes()}).catch(()=>{paintFutures()});
paintScalps();paintFutures();
if(document.body.dataset.account==='real')refreshReal();
setInterval(()=>{
 if(document.hidden)return;
 if(document.body.dataset.account==='real')refreshReal();
 else{paintScalps();paintFutures();updateFuturesQuotes()}
},15000);
})();