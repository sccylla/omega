'use strict';
(()=>{
const $=id=>document.getElementById(id),M=window.OmegaSelection,D=window.OmegaDecision;
if(!M||!D||!$('live-auto-toggle'))return;
let running=false,busy=false,token=null,expiry=0,aborter=null,cursor=null,pass=0,lastBar=null;
const button=$('live-auto-toggle'),input=$('live-auto-confirm');
const status=(msg,state)=>{$('live-auto-message').textContent=msg;if(state)$('live-auto-state').textContent=state};
const progress=msg=>{$('live-auto-progress').textContent=msg};
function controls(){button.textContent=running?'Pause real autopilot':'Start real autopilot';$('live-autopilot').classList.toggle('live-auto-armed',running)}
function pause(reason){running=false;token=null;expiry=0;aborter?.abort();controls();status(reason||'Paused: new entries disabled. Existing Bybit protective orders remain active.','PAUSED')}
async function request(url,body,signal){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),body?55000:20000);
 try{const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-OMEGA-REQUEST':'1'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'same-origin',signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal});
  const d=await r.json();if(!r.ok){const e=Error(d.error||'Market connection unavailable');e.status=r.status;throw e}return d;
 }finally{clearTimeout(timer)}
}
async function scan(trading){
 if(busy||document.hidden||document.body.dataset.account!=='real'||trading&&!running)return;
 busy=true;const controller=new AbortController();aborter=controller;const n=++pass;
 const canceled=()=>controller.signal.aborted||document.hidden||document.body.dataset.account!=='real'||trading&&!running;
 const deadline=setTimeout(()=>controller.abort(),60000);
 try{
  if(trading){
   if(!token||Date.now()>expiry){pause('One-hour live authorization expired. Start Real autopilot again.');return}
   const account=await M.within(signal=>request('/api/live?action=bybit',null,signal),{signal:controller.signal,timeoutMs:12000,label:'Bybit account'});
   $('live-auto-positions').textContent=account.openPositions??'—';
   if(!Number.isFinite(account.equity)||!Number.isFinite(account.available))throw Error('Bybit account balance unavailable');
   if(account.openPositions>0){status('Existing Bybit position open. Waiting for its exchange-side TP/SL before scanning again.','MANAGING');return}
   if(account.equity<75||account.available<15){status('A $15 live trade at no more than 20% account exposure needs at least $75 equity and $15 available.','BALANCE LOW');return}
  }
  status('Scanning Bybit futures…','SCANNING');
  const universe=await M.within(signal=>request('/api/scanner?market=futures&page=1&size=15',null,signal),{signal:controller.signal,timeoutMs:15000,label:'Market universe'});
  if(!Array.isArray(universe.rows))throw Error('No futures markets returned');
  $('live-auto-universe').textContent=Number(universe.universe||universe.rows.length).toLocaleString();
  const {results,picks,coverage,summary,nextAfter}=await M.scanMarkets(universe.rows,{
   analyze:(symbol,opts)=>D.analyze(symbol,{...opts,mode:'live_small'}),
   signal:controller.signal,maxMs:30000,requestTimeoutMs:18000,concurrency:4,
   allowPartial:true,startAfter:cursor,selectionWindowMs:trading?1200:null,
   isCancelled:canceled,canEnter:p=>p.executionPolicy==='LIVE_STRICT'&&p.barTime!==lastBar,
   onProgress:c=>progress('Pass '+n+': '+c.screened+' screened · '+c.analyzed+' analyzed · '+c.qualified+' qualified · '+c.remaining+' awaiting analysis')
  });
  if(coverage.cancelled||canceled())return;cursor=nextAfter;
  const rows=$('live-auto-shortlist');rows.replaceChildren();
  for(const item of [...picks,...results.filter(x=>!x.screenedOut&&!picks.includes(x)).sort(M.rank)].slice(0,5)){
   const row=document.createElement('div');row.textContent=item.symbol+' / '+(item.eligible?item.side:'WAIT')+(item.eligible&&Number.isFinite(item.quality?.score)?' · Quality '+item.quality.score.toFixed(1)+'/100 (not win probability)':'')+' · '+(item.reason||'Market not qualified');rows.append(row)
  }
  $('live-auto-choice').textContent=picks.length?picks[0].symbol+' '+picks[0].side:'WAIT';
  if(!picks.length){status((trading?'Autopilot is armed. No qualifying entry yet. ':'Analysis-only complete. ')+M.explain(summary),trading?'WAITING FOR SETUP':'SCAN ONLY');return}
  if(!trading){status(picks.length+' qualifying setup(s) found. Scan-only never opens real trades.','SCAN ONLY');return}
  const selected=picks[0];if(canceled())return;
  status('Rechecking '+selected.symbol+' with Bybit for strict entry and risk rules…','CHECKING ENTRY');
  const order=await request('/api/auto-live',{action:'enter',symbol:selected.symbol,token},controller.signal);
  if(!order.submitted)throw Error('Bybit did not acknowledge an order');
  lastBar=selected.barTime;
  status('Bybit accepted '+order.side+' '+order.symbol+' ($'+Number(order.notional).toFixed(2)+'). Status: '+order.orderStatus+'. Estimated net TP goal $0.05+ at '+order.takeProfit+' · stop '+order.stopLoss+'. Verify realized profit and protection at Bybit.','ORDER SENT');
  progress('One $15 real entry submitted. After Bybit reports no open position or pending order, the next qualified scan may request another trade.');
 }catch(e){
  if(canceled())return;
  if(e.status===409){status('No eligible live entry: '+e.message,'WAITING FOR SETUP');return}
  pause('Live autopilot paused: '+e.message+'. Check Bybit orders and positions before restarting.');
 }finally{clearTimeout(deadline);if(aborter===controller)aborter=null;busy=false}
}
async function toggle(){
 if(running){pause('You paused new live entries. Any already in-flight order may still fill. Bybit TP/SL remain active.');return}
 if(busy)return;
 if(document.body.dataset.account!=='real')return status('Select Real account first.','OFF');
 if(!navigator.locks?.request)return status('This browser cannot enforce one-tab trading. Use current Chrome over HTTPS.','UNSUPPORTED');
 if(input.value!=='START REAL $15 AUTOPILOT')return status('Type START REAL $15 AUTOPILOT exactly to authorize browser-controlled $15 real-money entries.','NOT ARMED');
 button.disabled=true;status('Verifying Bybit account risk before arming; no order placed.','ARMING');
 try{const a=await request('/api/auto-live',{action:'arm',confirm:input.value});
  if(!a.armed||!a.token)throw Error('Server did not authorize this session');
  token=a.token;expiry=Date.now()+a.expiresInMinutes*60000-5000;input.value='';running=true;controls();status('Real $15 autopilot armed for this visible browser tab only. One real position at a time, strict live checks, exchange TP/SL, and $1 daily loss gate. Orders can still lose money.','ARMED');
 }catch(e){pause('Cannot start Real autopilot: '+e.message)}
 finally{button.disabled=false}
}
button.addEventListener('click',toggle);
$('live-auto-scan-only').addEventListener('click',()=>scan(false));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)pause('Real autopilot paused when tab became hidden. Exchange stop/target orders remain active.')});
window.addEventListener('omega:account-mode',()=>{if(running)pause('Real autopilot paused after account change.')});
window.addEventListener('beforeunload',()=>{running=false;token=null});
controls();
setInterval(()=>{
 if(!running||busy||document.hidden||document.body.dataset.account!=='real')return;
 navigator.locks.request('omega-real-autopilot',{ifAvailable:true},async lock=>{
  if(!lock){status('Another local tab is controlling the real bot. This tab will not open an entry.','OTHER TAB');return}
  await scan(true);
 }).catch(e=>pause('Browser locking error: '+e.message));
},18000);
})();
