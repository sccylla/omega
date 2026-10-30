'use strict';
(()=>{
const $=id=>document.getElementById(id),E=window.OmegaSecondsEngine,S=window.OmegaSecondsShadow;
if(!E||!S||!$('seconds-toggle'))return;
const KEY='omega_seconds_shadow_v1',SOCKET='wss://stream.bybit.com/v5/public/linear';
let ws=null,engine=null,active=false,connecting=false,lastConnect=0,latest=[],symbols=[],ledger=S.init(),epoch=0;
const button=$('seconds-toggle'),status=text=>{$('seconds-status').textContent=text};
const setMode=s=>{$('seconds-mode').textContent=s};
const usd=v=>Number.isFinite(v)?(v<0?'−$':'$')+Math.abs(v).toFixed(2):'—';
const bps=v=>Number.isFinite(v)?v.toFixed(1)+' bp':'—';
const read=()=>{try{return S.restore(JSON.parse(localStorage.getItem(KEY)||'null'))}catch{return S.init()}};
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(ledger));return true}catch{stop('Shadow storage unavailable; scanner halted to avoid fabricated statistics');return false}};
ledger=read();if(ledger.open){ledger=S.interrupt(ledger);try{localStorage.setItem(KEY,JSON.stringify(ledger))}catch{}}
function displayShadow(){
 const stat=S.stats(ledger);$('seconds-net').textContent=usd(stat.netUsd);
 $('seconds-shadow-state').textContent=ledger.open?ledger.open.side+' '+ledger.open.symbol+' · $90 virtual position':'No virtual position';
 $('seconds-shadow-stats').textContent=stat.count+' simulated closed trades · Win rate '+(stat.winRate===null?'unavailable':stat.winRate.toFixed(1)+'%')+
  ' · '+usd(stat.netUsd)+' modeled net · '+stat.incomplete+' interrupted';
}
function stop(message){
 ++epoch;active=false;connecting=false;
 try{if(ws){ws.onopen=null;ws.onclose=null;ws.onerror=null;ws.onmessage=null;ws.close()}}catch{}
 ws=null;engine=null;
 if(ledger.open){ledger=S.interrupt(ledger);save()}
 button.textContent='Start seconds scanner';setMode('OFFLINE · RESEARCH ONLY');
 status(message||'Paused. No public WebSocket updates are being collected, and no funded trading behavior was changed.');
 displayShadow();
}
function chart(){
 if(!engine)return;
 const first=latest.find(x=>x?.state==='WATCH')||latest.filter(x=>Number.isFinite(x?.range30Bps)).sort((a,b)=>b.range30Bps-a.range30Bps)[0];
 if(!first)return;
 const points=engine.history(first.symbol),line=$('seconds-line');
 if(points.length<3){line.setAttribute('d','');return}
 const values=points.map(p=>p.mid),lo=Math.min(...values),hi=Math.max(...values),range=hi-lo||lo*.0001;
 const result=points.map((p,i)=>(i?'L':'M')+(i/(points.length-1)*598+1).toFixed(1)+','+
  (105-(p.mid-lo)/range*96).toFixed(1)).join(' ');
 line.setAttribute('d',result);line.setAttribute('stroke',first.side==='SELL'?'#f1a9b5':'#7de5c2');
 $('seconds-chart-name').textContent=first.symbol+' · last '+points.length+' 1-second midquote observations · indicative chart, not executable P&L';
}
function render(){
 if(!engine)return;
 const now=Date.now();latest=symbols.map(symbol=>engine.observation(symbol,now));
 const quotes=Object.fromEntries(symbols.map(s=>[s,engine.execution(s,now)]));
 const live=ws?.readyState===WebSocket.OPEN&&active;
 const run=S.step(ledger,{signals:latest,quotes,now,connected:live});
 if(run.events.length){ledger=run.state;if(!save())return;
  for(const event of run.events){if(event.type==='OPEN')status('Research setup: opened $90 virtual '+event.symbol+'. Monitoring net after modeled executable prices and fees.');
   if(event.type==='CLOSED')status('Virtual trade '+event.trade.symbol+' closed at '+usd(event.trade.net)+' net in '+Math.round((event.trade.closedAt-event.trade.openedAt)/1000)+'s. This was NOT a real trade.')}
 }
 if(run.state!==ledger&&ledger.open)ledger=run.state;
 // The portfolio can open on a 1-second boundary; persist opening evidence.
 if(run.events.some(e=>e.type==='OPEN')){ledger=run.state;if(!save())return}
 const trs=$('seconds-rows');trs.replaceChildren();
 for(const o of [...latest].sort((a,b)=>(b.state==='WATCH')-(a.state==='WATCH')||Number(b.score||0)-Number(a.score||0))){
  const row=document.createElement('tr');
  for(const [value,klass] of [
   [o.symbol,''],[bps(o.move5Bps),o.move5Bps>0?'seconds-up':o.move5Bps<0?'seconds-down':''],
   [bps(o.move15Bps),''],[bps(o.range30Bps),''],[bps(o.spreadBps),''],
   [bps(o.requiredMoveBps),''],[Number.isFinite(o.flowPressure)?(o.flowPressure*100).toFixed(0)+'%':'—',''],
   [o.state==='WATCH'?o.side+' WATCH · '+o.score.toFixed(0):o.state+' · '+(o.reason||'No signal'),'']
  ]){const td=document.createElement('td');td.textContent=value;if(klass)td.className=klass;row.append(td)}
  trs.append(row);
 }
 $('seconds-count').textContent=latest.filter(x=>x.state!=='NO_DATA').length+' / '+symbols.length;
 const max=latest.filter(x=>Number.isFinite(x.range30Bps)).sort((a,b)=>b.range30Bps-a.range30Bps)[0];
 $('seconds-vol').textContent=max?bps(max.range30Bps):'WARMING';
 const lowest=latest.filter(x=>Number.isFinite(x.requiredMoveBps)).sort((a,b)=>a.requiredMoveBps-b.requiredMoveBps)[0];
 $('seconds-break-even').textContent=lowest?bps(lowest.requiredMoveBps):'—';
 if(live&&latest.some(x=>x.state==='WATCH'))setMode('VOLATILITY WATCH · PAPER ONLY');
 else if(live)setMode('LIVE FEED · PAPER ONLY');
 displayShadow();chart();
}
function connect(myEpoch){
 if(!active||document.hidden||myEpoch!==epoch)return;
 connecting=true;lastConnect=Date.now();setMode('CONNECTING TO BYBIT');
 try{ws=new WebSocket(SOCKET)}catch(e){stop('Public Bybit WebSocket unavailable in this browser: '+e.message);return}
 ws.onopen=()=>{
  if(myEpoch!==epoch||!active)return;
  connecting=false;
  const topics=symbols.flatMap(s=>['orderbook.50.'+s,'publicTrade.'+s]);
  ws.send(JSON.stringify({op:'subscribe',args:topics}));
  status('Bybit connected. Collecting exchange-time trades, 50-level books, and a 30-second movement baseline for '+symbols.join(', ')+'. No funded orders.');
 };
 ws.onmessage=event=>{
  if(myEpoch!==epoch||!active||document.hidden||typeof event.data!=='string'||event.data.length>900000)return;
  let msg;try{msg=JSON.parse(event.data)}catch{return}
  if(msg.success===false){stop('Bybit rejected a real-time subscription. Check market symbols and connection.');return}
  if(msg.op==='pong'||msg.op==='subscribe')return;
  engine?.ingest(msg,Date.now());
 };
 ws.onerror=()=>{if(active)status('WebSocket network problem. No new virtual orders will be evaluated until fresh quotes resume.')};
 ws.onclose=()=>{
  if(myEpoch!==epoch||!active)return;
  if(ledger.open){ledger=S.interrupt(ledger);save()}
  stop('Exchange WebSocket disconnected. Scanner stopped; restart to collect a fresh 30-second baseline.');
 };
}
function start(){
 if(active){stop('Seconds scanner paused manually.');return}
 if(!window.WebSocket)return status('This browser does not support WebSocket market streams.');
 if(document.hidden||document.body.dataset.account!=='real')return status('Switch to the Real account view and keep the tab visible before starting seconds research.');
 try{symbols=E.validSymbols($('seconds-pairs').value);engine=E.create(symbols)}catch(e){return status(e.message)}
 active=true;button.textContent='Pause seconds scanner';++epoch;
 const id=epoch;connect(id);
}
button.addEventListener('click',start);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)stop('Paused when tab became hidden: seconds research cannot continue without a visible live feed.')});
window.addEventListener('omega:account-mode',()=>{if(active&&document.body.dataset.account!=='real')stop('Seconds scanner paused after leaving the Real account view.')});
window.addEventListener('beforeunload',()=>{active=false;if(ledger.open){ledger=S.interrupt(ledger);try{localStorage.setItem(KEY,JSON.stringify(ledger))}catch{}}});
setInterval(()=>{
 if(!active||!engine||document.hidden)return;
 if(ws?.readyState===WebSocket.OPEN){
  render();
 }else if(Date.now()-lastConnect>12000){stop('No active public market connection; research stopped safely')}
},1000);
setInterval(()=>{if(active&&ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({op:'ping'}))},20000);
displayShadow();
})();
