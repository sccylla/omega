'use strict';
// Dedicated REAL scalper controller. Market WATCHs are public research only;
// every funded entry must be rechecked independently by the authenticated
// server, including full multi-timeframe trend and Bybit account risk.
(()=>{
 const $=id=>document.getElementById(id);
 const start=$('seconds-trade-toggle'),input=$('seconds-confirm'),note=$('seconds-strict-status');
 if(!start||!input||!note)return;
 let armed=false,token=null,expires=0,latest=null,busy=false,lastAttempt=0,lastOrder=0;
 const phrase='START REAL $15 SCALPER';
 const waiting=s=>{note.textContent=s};
 function pause(message){
  armed=false;token=null;expires=0;latest=null;
  start.textContent='Start Real Scalper ($15)';
  if(message)waiting(message);
 }
 async function request(body){
  const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),52000);
  try{
   const response=await fetch('/api/auto-live',{method:'POST',cache:'no-store',credentials:'same-origin',
    headers:{'Content-Type':'application/json','X-OMEGA-REQUEST':'1'},body:JSON.stringify(body),signal:abort.signal});
   let result;try{result=await response.json()}catch{throw Error('Bybit order service returned unreadable data')}
   if(!response.ok){const e=Error(result.error||'Bybit blocked this real entry');e.status=response.status;throw e}
   return result;
  }finally{clearTimeout(timeout)}
 }
 async function toggle(){
  if(armed){pause('Real scalper paused. Existing Bybit positions and exchange TP/SL remain active.');return}
  if(document.hidden||document.body.dataset.account!=='real')return waiting('Open Real Account in a visible browser tab.');
  if(input.value!==phrase)return waiting('Type '+phrase+' exactly before starting real scalping.');
  if(!navigator.locks?.request)return waiting('Current Chrome over HTTPS is required for single-tab real-order locking.');
  start.disabled=true;waiting('Verifying your funded Bybit balance and $15 risk limits. No order yet.');
  try{
   const result=await request({action:'arm',confirm:phrase});
   if(result.armed!==true||result.purpose!=='scalper'||!result.token)throw Error('Server did not authorize real scalping');
   token=result.token;expires=Date.now()+result.expiresInMinutes*60000-5000;armed=true;input.value='';
   start.textContent='Pause Real Scalper';waiting('Scalper ARMED: scanning up to 20 pairs. Every order needs fresh microstructure, strict futures evidence, exchange risk checks and available margin.');
   window.dispatchEvent(new CustomEvent('omega:strategy-armed',{detail:'scalper'}));
   window.OmegaSecondsScout?.start();
  }catch(e){pause('Could not start Real Scalper: '+e.message)}
  finally{start.disabled=false}
 }
 async function cycle(){
  if(!armed||busy||document.hidden||document.body.dataset.account!=='real')return;
  const now=Date.now();
  if(now>expires){pause('One-hour real-money authorization expired. Type '+phrase+' to start again.');return}
  if(!window.OmegaSecondsScout?.active())return waiting('Real scalper armed but market data is stopped. Press Start scalp market scan.');
  if(!latest||now-latest.at>2500||!['BUY','SELL'].includes(latest.side))return;
  if(now-lastAttempt<25000||now-lastOrder<45000)return;
  busy=true;lastAttempt=now;
  const sym=latest.symbol,side=latest.side;
  try{
   await navigator.locks.request('omega-real-autopilot',{ifAvailable:true},async lock=>{
    if(!lock){waiting('Another real trading tab is submitting or validating an order. Waiting.');return}
    waiting('Validating '+sym+' '+side+' against 5m/15m/1h/4h trends, depth, costs and fresh market evidence…');
    const result=await window.OmegaDecision.analyze(sym,{mode:'live_small',fresh:true});
    if(!armed||document.hidden||latest?.symbol!==sym||latest?.side!==side||
     Date.now()-latest.at>2500)return;
    if(!result.eligible||result.side!==side){
     waiting('WAIT '+sym+': '+(result.reason||'Strict live futures evidence did not qualify')+'. No funded trade.');return;
    }
    const order=await request({action:'enter_scalp',symbol:sym,side:side==='BUY'?'Buy':'Sell',token});
    if(!order.submitted)throw Error('Bybit did not acknowledge the trade');
    lastOrder=Date.now();
    waiting('REAL ORDER ACKNOWLEDGED: '+order.side+' '+sym+' · $'+Number(order.notional).toFixed(2)+
     ' · exchange take-profit '+order.takeProfit+' · stop-loss '+order.stopLoss+
     '. Verify fills and exits on Bybit. No profit is guaranteed.');
   });
  }catch(e){
   if(e.status===409)waiting('WAIT '+sym+': '+e.message+'. No order submitted.');
   else pause('Real scalping paused. Broker result may be uncertain: '+e.message+'. Check Bybit positions and order history before restarting.');
  }finally{busy=false}
 }
 start.addEventListener('click',toggle);
 window.addEventListener('omega:scalp-watch',e=>{latest=e.detail||null});
 window.addEventListener('omega:strategy-armed',e=>{if(e.detail==='futures'&&armed)pause('Paused Scalper because Futures Trader was armed. Only one real strategy can send entries.')});
 window.addEventListener('omega:account-mode',()=>{if(armed&&document.body.dataset.account!=='real')pause('Paused after leaving Real Account. Exchange orders may remain active.')});
 document.addEventListener('visibilitychange',()=>{if(armed&&document.hidden)pause('Scalper paused when tab became hidden. Exchange TP/SL remain active.')});
 window.addEventListener('beforeunload',()=>{armed=false;token=null});
 start.textContent='Start Real Scalper ($15)';
 setInterval(cycle,2500);
})();