'use strict';
// The strategy report is research only; the separately protected Bybit demo API cannot be invoked by this script.
(()=>{
 const $=id=>document.getElementById(id),fmt=(x,n=2)=>Number(x).toLocaleString('en-US',{minimumFractionDigits:n,maximumFractionDigits:n});
 const money=n=>'$'+fmt(n);let loading=false,latest=null;
 const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function setStatus(msg){$('quant-feed').textContent=msg;}
 function render(payload){const a=payload.result,t=a.target;latest=payload;
   $('quant-decision').textContent=a.decision==='WAIT'?'NO TRADE':a.decision+' CANDIDATE';$('quant-decision').className='quant-decision-value '+(a.decision==='LONG'?'quant-up':a.decision==='SHORT'?'quant-down':'quant-wait');
   $('quant-reason').textContent=a.reason;$('quant-score').textContent=a.alignmentScore;$('quant-score-bar').style.width=a.alignmentScore+'%';$('quant-regime').textContent='Regime: '+a.regime+' · ADX '+a.indicators.adx;
   $('quant-notional').textContent=money(t.maxNotional);$('quant-costs').textContent=money(t.totalEstimatedCosts);$('quant-move').textContent=fmt(t.requiredMovePct,3)+'%';$('quant-range').textContent=fmt(t.observedTwoBarAtrPct,3)+'%';$('quant-feasibility').textContent=t.feasibility;
   $('quant-evidence').innerHTML=a.evidence.length?a.evidence.map(x=>'<div class="quant-event"><span>'+html(x.label)+'</span><b class="'+(x.impact>=0?'quant-up':'quant-down')+'">'+(x.impact>0?'+':'')+fmt(x.impact,1)+'</b></div>').join(''):'<span class="muted-small">No technical contributions</span>';
   $('quant-blockers').innerHTML=a.blockers.length?a.blockers.map(x=>'<div class="quant-block">× '+html(x)+'</div>').join(''):'<div class="quant-allow">Risk gates passed — research candidate only. Profit not assured.</div>';
   setStatus('BYBIT '+payload.market+'/USDT · '+new Date(payload.timestamp).toLocaleTimeString()+' · 5m / 15m / 1h · '+(payload.feeds?.orderBook?'ORDERBOOK LIVE':'ORDERBOOK UNAVAILABLE'));
 }
 async function run(isTest=false){if(loading)return;loading=true;const btn=$(isTest?'quant-test':'quant-scan');btn.disabled=true;btn.textContent=isTest?'Evaluating history…':'Scanning market…';
 try{const symbol=$('quant-symbol').value;let balance=10000;try{const p=await window.omegaAction('/status');balance=Math.max(100,Math.min(1000000,p.equity));}catch{}
 const res=await fetch('/api/quant?'+new URLSearchParams({symbol,equity:String(Math.round(balance)),target:'1',mode:isTest?'test':'scan'}),{cache:'no-store'});const data=await res.json();if(!res.ok)throw Error(data.error||'Unable to fetch public market research');
 if(isTest){const t=data.backtest;const k=(label,val)=>'<div class="quant-testrow"><span>'+html(label)+'</span><strong>'+html(val)+'</strong></div>';
 $('quant-history').innerHTML=k('Closed 10m trades',t.trades)+k('Net after estimated costs',money(t.netPnl))+k('Win rate',t.winRatePct===null?'Insufficient trades':t.winRatePct+'%')+k('Trades achieving $1 net',t.hitTarget+'/'+t.trades)+k('Max observed drawdown',fmt(t.maxDrawdownPct,2)+'%')+'<p class="quant-caveat">'+html(t.caveat)+'</p>';
 setStatus('HISTORICAL SIMULATION · '+data.market+' · '+new Date(data.timestamp).toLocaleTimeString()+' · NOT AN OUT-OF-SAMPLE FORECAST');
 }else render(data);
 }catch(e){setStatus('RESEARCH FEED ISSUE: '+e.message);if(!isTest)$('quant-reason').textContent='No trading decision when live research is unavailable. '+e.message;
 }finally{loading=false;btn.disabled=false;btn.textContent=isTest?'↗ Test 10m history':'◉ Run intelligence';}
 }
 $('quant-scan').onclick=()=>run(false);$('quant-test').onclick=()=>run(true);$('quant-symbol').onchange=()=>run(false);
 // Runs only while browser is open. Does not connect to any exchange trading account.
 setInterval(()=>{if(document.visibilityState==='visible'&&!loading)run(false);},120000);
 run(false);
})();
