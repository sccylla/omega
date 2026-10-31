'use strict';
(()=>{
const $=id=>document.getElementById(id),E=window.OmegaSecondsEngine;
if(!E||!$('seconds-toggle'))return;
// REAL ACCOUNT ONLY market-data scout. This component NEVER creates broker
// orders. Browser Real Autopilot independently validates every funded entry.
const TICK_KEY='omega_seconds_1s_capture_v1',SOCKET='wss://stream.bybit.com/v5/public/linear';
const NOTIONAL=15,GOAL_NET=.05,MAX_PAIRS=20,MAX_CAPTURE=12000;
const button=$('seconds-toggle'),review=$('seconds-check'),status=text=>{$('seconds-status').textContent=text};
const setMode=text=>{$('seconds-mode').textContent=text};
const bps=v=>Number.isFinite(v)?v.toFixed(1)+' bp':'—';
let ws=null,engine=null,active=false,epoch=0,lastConnect=0,lastData=0,latest=[],symbols=[],best=null;
const readCaptures=()=>{try{const x=JSON.parse(localStorage.getItem(TICK_KEY)||'[]');return Array.isArray(x)?
 x.slice(-MAX_CAPTURE).filter(r=>Array.isArray(r)&&r.length===12&&r.every((v,i)=>i===1||i===11?
 typeof v==='string':typeof v==='number'&&Number.isFinite(v))):[]}catch{return[]}};
let captures=readCaptures(),lastRecordSecond=-1;
function flushCaptures(){try{localStorage.setItem(TICK_KEY,JSON.stringify(captures));return true}
catch{stop('Unable to preserve the one-second market research log; paused without placing an order.');return false}}
function capture(now,items){
 const sec=Math.floor(now/1000);if(lastRecordSecond===sec)return true;
 lastRecordSecond=sec;
 for(const p of items){
  if(!Number.isFinite(p.mid)||!Number.isFinite(p.spreadBps)||!Number.isFinite(p.requiredMoveBps))continue;
  captures.push([sec,p.symbol,p.mid,p.spreadBps,p.requiredMoveBps,
   Number.isFinite(p.move5Bps)?p.move5Bps:0,Number.isFinite(p.move15Bps)?p.move15Bps:0,
   Number.isFinite(p.range30Bps)?p.range30Bps:0,Number.isFinite(p.flowPressure)?p.flowPressure:0,
   Number.isFinite(p.imbalance)?p.imbalance:0,Number.isFinite(p.score)?p.score:0,p.state]);
 }
 if(captures.length>MAX_CAPTURE)captures=captures.slice(-MAX_CAPTURE);
 $('seconds-recordings').textContent=captures.length.toLocaleString()+
  ' one-second market observations · downloadable CSV. These are not fills or realized P&L.';
 return sec%10!==0||flushCaptures();
}
function stop(message){
 ++epoch;active=false;best=null;review.disabled=true;
 window.dispatchEvent(new CustomEvent('omega:scalp-watch',{detail:null}));
 try{if(ws){ws.onopen=null;ws.onclose=null;ws.onerror=null;ws.onmessage=null;ws.close()}}catch{}
 ws=null;engine=null;latest=[];
 flushCapturesNoStop();
 button.textContent='Start live seconds scalper scanner';setMode('OFFLINE · REAL ACCOUNT SCOUT');
 $('seconds-shadow-state').textContent='No scalp market selected';
 $('seconds-shadow-stats').textContent='Real Autopilot requires its own strict multi-timeframe approval';
 status(message||'Seconds scanner paused. No funded order was submitted.');
}
function flushCapturesNoStop(){try{localStorage.setItem(TICK_KEY,JSON.stringify(captures))}catch{}}
function chart(){
 if(!engine||!best)return;
 const history=engine.history(best.symbol),line=$('seconds-line');
 if(history.length<3){line.setAttribute('d','');return}
 const values=history.map(x=>x.mid),lo=Math.min(...values),hi=Math.max(...values),range=hi-lo||Math.max(lo*.0001,.000001);
 line.setAttribute('d',history.map((p,i)=>(i?'L':'M')+(i/(history.length-1)*598+1).toFixed(1)+','+
  (105-(p.mid-lo)/range*96).toFixed(1)).join(' '));
 line.setAttribute('stroke',best.side==='SELL'?'#f1a9b5':'#7de5c2');
 $('seconds-chart-name').textContent=best.symbol+' · '+history.length+
  ' one-second market quotes. Chart is indicative, not an executable fill.';
}
function render(){
 if(!active||!engine||document.hidden||document.body.dataset.account!=='real')return;
 const now=Date.now();
 latest=symbols.map(s=>engine.observation(s,now));
 if(!capture(now,latest))return;
 const ranked=[...latest].sort((a,b)=>Number(b.state==='WATCH')-Number(a.state==='WATCH')||
  Number(b.score||0)-Number(a.score||0));
 best=ranked.find(x=>x.state==='WATCH')||null;
 window.dispatchEvent(new CustomEvent('omega:scalp-watch',{detail:best?{symbol:best.symbol,side:best.side,score:best.score,at:now}:null}));
 review.disabled=!best;
 const rows=$('seconds-rows');rows.replaceChildren();
 for(const o of ranked){
  const tr=document.createElement('tr'),fields=[
   [o.symbol,''],[bps(o.move5Bps),o.move5Bps>0?'seconds-up':o.move5Bps<0?'seconds-down':''],
   [bps(o.move15Bps),''],[bps(o.range30Bps),''],[bps(o.spreadBps),''],
   [bps(o.requiredMoveBps),''],
   [Number.isFinite(o.flowPressure)?(o.flowPressure*100).toFixed(0)+'%':'—',''],
   [o.state==='WATCH'?o.side+' WATCH · '+o.score.toFixed(0):o.state+' · '+(o.reason||'No signal'),'']];
  for(const [text,klass] of fields){
   const td=document.createElement('td');td.textContent=text;if(klass)td.className=klass;tr.append(td);
  }
  rows.append(tr);
 }
 $('seconds-count').textContent=latest.filter(x=>x.state!=='NO_DATA').length+' / '+symbols.length;
 const most=latest.filter(x=>Number.isFinite(x.range30Bps)).sort((a,b)=>b.range30Bps-a.range30Bps)[0];
 $('seconds-vol').textContent=most?bps(most.range30Bps):'WARMING';
 const cheapest=latest.filter(x=>Number.isFinite(x.requiredMoveBps)).sort((a,b)=>a.requiredMoveBps-b.requiredMoveBps)[0];
 $('seconds-break-even').textContent=cheapest?bps(cheapest.requiredMoveBps):'—';
 $('seconds-net').textContent='0';
 $('seconds-shadow-state').textContent=best?'Scalp WATCH: '+best.symbol+' '+best.side:'No second-level entry qualifies';
 $('seconds-shadow-stats').textContent=best?
   'Order flow + depth satisfy the microstructure watch only; strict live 4h and holdout checks still required':
   'Waiting for fresh book, flow, volatility and modeled cost criteria. No broker orders from this feed.';
 setMode(best?'MICROSTRUCTURE WATCH · STRICT LIVE REVIEW REQUIRED':'REAL FEED · SCANNING ONLY');
 chart();
}
function connect(myEpoch){
 if(!active||document.hidden||myEpoch!==epoch)return;
 lastConnect=Date.now();setMode('CONNECTING TO BYBIT PUBLIC DATA');
 try{ws=new WebSocket(SOCKET)}catch(e){stop('Could not connect to public Bybit data: '+e.message);return}
 ws.onopen=()=>{
  if(myEpoch!==epoch||!active)return;
  const topics=symbols.flatMap(s=>['orderbook.50.'+s,'publicTrade.'+s]);
  try{for(let i=0;i<topics.length;i+=10)ws.send(JSON.stringify({op:'subscribe',args:topics.slice(i,i+10)}))}
  catch{stop('Bybit rejected a subscription request.');return}
  status('Bybit market data connected; waiting for 60 seconds of accepted orderbooks and matched trades across '+
   symbols.length+' pairs. No funded orders from the seconds scanner.');
 };
 ws.onmessage=event=>{
  if(myEpoch!==epoch||!active||document.hidden||typeof event.data!=='string'||event.data.length>900000)return;
  let msg;try{msg=JSON.parse(event.data)}catch{return}
  if(msg.success===false){stop('Bybit subscription rejected; no trade allowed.');return}
  if(msg.op==='pong'||msg.op==='subscribe')return;
  try{if(engine?.ingest(msg,Date.now()))lastData=Date.now()}
  catch{stop('Invalid market stream; scanner halted without trading.')}
 };
 ws.onerror=()=>{if(active)status('Market feed network problem: no candidate will be reviewed without fresh quotes.')};
 ws.onclose=()=>{if(myEpoch===epoch&&active)stop('Public Bybit stream disconnected; restart to rebuild a fresh 60-second baseline.')};
}
function toggle(){
 if(active){stop('Live seconds market selection paused.');return}
 if(!window.WebSocket)return status('This browser does not support WebSocket market streams.');
 if(document.hidden||document.body.dataset.account!=='real')return status('Open Real Account in a visible tab first.');
 try{
  symbols=E.validSymbols($('seconds-pairs').value,{maxSymbols:MAX_PAIRS});
  engine=E.create(symbols,{maxSymbols:MAX_PAIRS,notional:NOTIONAL,goalNet:GOAL_NET});
 }catch(e){return status(e.message)}
 active=true;best=null;review.disabled=true;lastRecordSecond=-1;lastData=0;
 button.textContent='Pause live seconds scanner';const myEpoch=++epoch;connect(myEpoch);
}
async function strictReview(){
 if(!active||!best||document.hidden||document.body.dataset.account!=='real')return;
 const selected=best.symbol,clock=Date.now(),msg=$('seconds-strict-status');
 review.disabled=true;msg.textContent='Checking '+selected+' against live 5m / 15m / 1h / 4h evidence, exchange execution and historical requirements. No order sent.';
 try{
  if(!window.OmegaDecision)throw Error('Live market review unavailable');
  const result=await window.OmegaDecision.analyze(selected,{mode:'live_small',fresh:true});
  if(Date.now()-clock>30000||!active||document.body.dataset.account!=='real')throw Error('Review expired. Request a fresh setup.');
  window.OmegaDecision.render(result,selected);
  msg.textContent=result.eligible?'Strict live evidence also qualifies for '+selected+
   '. Start or keep Real Autopilot armed to permit separately validated broker entries. This review alone sent no order.':
   selected+' NOT APPROVED for real trading: '+(result.reason||'Live strict evidence unavailable')+
   '. The seconds WATCH cannot override the server risk gates.';
 }catch(e){msg.textContent='Strict real entry review blocked: '+e.message+'. No order submitted.'}
 finally{if(active&&best)review.disabled=false}
}
window.OmegaSecondsScout={start:()=>{if(!active)toggle()},stop:()=>{if(active)toggle()},active:()=>active};
button.addEventListener('click',toggle);
review.addEventListener('click',strictReview);
$('seconds-export').addEventListener('click',()=>{
 if(!captures.length){status('No captured seconds yet. Start the live scanner first.');return}
 const header='epoch_second,symbol,midquote,spread_bps,net_target_move_bps,move_5s_bps,move_15s_bps,range_30s_bps,aggressor_pressure,book_imbalance,quality_score,state';
 const blob=new Blob([[header,...captures.map(r=>r.join(','))].join('\n')],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='omega_real_market_seconds_'+new Date().toISOString().slice(0,10)+'.csv';
 document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
 status('Exported public market observations, not real order or fill history.');
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)stop('Scanner paused because the tab was hidden.')});
window.addEventListener('omega:account-mode',()=>{if(active&&document.body.dataset.account!=='real')stop('Scanner paused after leaving Real Account.')});
window.addEventListener('beforeunload',flushCapturesNoStop);
setInterval(()=>{
 if(!active||!engine||document.hidden)return;
 if(ws?.readyState!==WebSocket.OPEN&&Date.now()-lastConnect>14000){stop('No active Bybit market stream; scanner paused safely.');return}
 if(ws?.readyState===WebSocket.OPEN){
  if(Date.now()-lastConnect>18000&&(!lastData||Date.now()-lastData>18000)){
   stop('Bybit stream is silent or stale. No live scalp candidate may be trusted.');return;
  }
  render();
 }
},1000);
setInterval(()=>{if(active&&ws?.readyState===WebSocket.OPEN)try{ws.send(JSON.stringify({op:'ping'}))}catch{}},20000);
$('seconds-net').textContent='0';
})();
