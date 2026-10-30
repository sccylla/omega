'use strict';
(()=>{
 const $=id=>document.getElementById(id),E=window.OmegaSecondsEngine,A=window.OmegaDemoSeconds,X=window.OmegaDemoSecondsSignals,G=window.OmegaDemoScalpGuard;
 if(!E||!A||!X||!G||!$('demo-seconds-start'))return;
 const KEY='omega_demo_seconds_wallet_v1',WS='wss://stream.bybit.com/v5/public/linear';
 const money=x=>Number.isFinite(x)?(x<0?'−$':'$')+Math.abs(x).toFixed(2):'—',
  bps=x=>Number.isFinite(x)?x.toFixed(1)+' bp':'—';
 const button=$('demo-seconds-start'),setStatus=s=>{$('demo-seconds-status').textContent=s},
  mode=s=>{$('demo-seconds-mode').textContent=s};
 let active=false,socket=null,engine=null,symbols=[],wallet=null,epoch=0,lastConnected=0,lastDiagnostic=0;
 function read(){try{return A.restore(JSON.parse(localStorage.getItem(KEY)||'null'))}catch{return A.initial()}}
 wallet=read();
 // An open position from a closed/reloaded browser has no verified exit.
 if(wallet.ledger.open){wallet=A.interrupt(wallet);try{localStorage.setItem(KEY,JSON.stringify(wallet))}catch{}}
 function persist(){
  try{localStorage.setItem(KEY,JSON.stringify(wallet));return true}
  catch{halt('Demo wallet storage unavailable. Virtual trading paused without claiming a fill.');return false}
 }
 function renderAccount(){
  const s=A.stats(wallet);
  $('demo-seconds-equity').textContent=money(s.equity);$('demo-seconds-net').textContent=money(s.totalNetUsd);
  $('demo-seconds-trades').textContent=s.closedTrades;
  $('demo-seconds-wins').textContent=s.winRatePct===null?'—':s.winRatePct.toFixed(1)+'%';
  $('demo-seconds-position').textContent=s.open?s.open.side+' '+s.open.symbol+' · $90 virtual open':'No open virtual position';
  $('demo-seconds-risk').textContent=s.entryBlock||'Virtual daily max loss '+money(s.dailyMaxLossUsd)+' · 20-second cooldown · 1 position';
  const body=$('demo-seconds-history');body.replaceChildren();
  const recent=[...wallet.ledger.closed].reverse().slice(0,10);
  if(!recent.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='No completed seconds trades yet.';tr.append(td);body.append(tr)}
  for(const t of recent){
   const tr=document.createElement('tr');
   for(const value of [t.symbol,t.side,Math.round((t.closedAt-t.openedAt)/1000)+'s',money(t.net),t.reason+(Number.isFinite(t.fees)?' · Gross '+money(t.gross)+' / costs '+money(t.fees+t.slippage):' · older model')]){
    const td=document.createElement('td');td.textContent=value;tr.append(td)
   }
   body.append(tr);
  }
 }
 function halt(reason){
  epoch++;active=false;
  if(socket){try{socket.onopen=null;socket.onmessage=null;socket.onerror=null;socket.onclose=null;socket.close()}catch{}}
  socket=null;engine=null;
  if(wallet.ledger.open){wallet=A.interrupt(wallet);try{localStorage.setItem(KEY,JSON.stringify(wallet))}catch{}}
  button.textContent='Start Demo Seconds Scalper';mode('OFF · DEMO ONLY');
  setStatus(reason||'Seconds Demo paused. No real-money orders are involved.');renderAccount();
 }
 function chart(results){
  const target=results.find(x=>x.state==='WATCH')||results.filter(x=>Number.isFinite(x.range30Bps)).sort((a,b)=>b.range30Bps-a.range30Bps)[0];
  if(!target)return;
  const points=engine.history(target.symbol),svg=$('demo-seconds-line');
  if(points.length<3){svg.setAttribute('d','');return}
  const prices=points.map(x=>x.mid),low=Math.min(...prices),top=Math.max(...prices),span=top-low||top*.0001;
  svg.setAttribute('d',points.map((v,i)=>(i?'L':'M')+(i/Math.max(1,points.length-1)*598+1).toFixed(1)+','+
   (105-(v.mid-low)/span*96).toFixed(1)).join(' '));
  svg.setAttribute('stroke',target.side==='SELL'?'#f1a9b5':'#7de5c2');
  $('demo-seconds-chart-name').textContent=target.symbol+' · '+points.length+' live midquote seconds · indicative, not a broker fill chart';
 }
 function drawRows(results){
  const body=$('demo-seconds-rows');body.replaceChildren();
  for(const r of [...results].sort((a,b)=>Number(b.state==='WATCH')-Number(a.state==='WATCH')||(b.score||0)-(a.score||0))){
   const tr=document.createElement('tr');
   for(const value of [r.symbol,bps(r.move5Bps),bps(r.move15Bps),bps(r.range30Bps),bps(r.spreadBps),
    bps(r.requiredMoveBps),Number.isFinite(r.flowPressure)?(r.flowPressure*100).toFixed(0)+'%':'—',
    r.state==='WATCH'?r.side+' WATCH · '+r.score.toFixed(0):r.state+' · '+(r.reason||'No signal')]){
    const cell=document.createElement('td');cell.textContent=value;tr.append(cell)}
   if(r.reasons?.length)tr.title='Entry checks: '+r.reasons.join(' | ');
   body.append(tr)
  }
 }
 function tick(){
  if(!active||document.hidden||document.body.dataset.account!=='demo'||!engine)return;
  if(!socket||socket.readyState!==WebSocket.OPEN){
   if(Date.now()-lastConnected>12000)halt('Public seconds feed disconnected. No virtual price exits fabricated.');
   return
  }
  const now=Date.now(),results=symbols.map(s=>G.filter(X.evaluate(engine.observation(s,now)),engine.history(s),now)),
   quotes=Object.fromEntries(symbols.map(s=>[s,engine.execution(s,now)]));
  const out=A.step(wallet,{now,signals:results,quotes,connected:true});
  if(out.events.length){
   wallet=out.account;
   if(!persist())return;
   for(const event of out.events){
    if(event.type==='OPEN')setStatus('Demo virtual BUY/SELL opened on '+event.symbol+'. Watching executable prices for a qualified virtual exit.');
    else if(event.type==='CLOSED')setStatus('Closed '+event.trade.side+' '+event.trade.symbol+' in '+Math.round((event.trade.closedAt-event.trade.openedAt)/1000)+
     's · virtual net '+money(event.trade.net)+' (gross '+money(event.trade.gross)+', modeled fees + slippage '+money((event.trade.fees||0)+(event.trade.slippage||0))+') · '+event.trade.reason+'. Next scan only after risk and volatility checks.');
    else setStatus('Price feed lost during a trade. Marked incomplete, not counted as profit.');
   }
  }else wallet=out.account;
  drawRows(results);chart(results);renderAccount();
  if(now-lastDiagnostic>=9000&&!out.events.length){
   lastDiagnostic=now;
   const ready=results.filter(x=>x.state!=='NO_DATA'),qualified=results.filter(x=>x.state==='WATCH');
   const top=[...results].filter(x=>Number.isFinite(x.range30Bps)).sort((a,b)=>(b.score||0)-(a.score||0))[0];
   const notes=top?.reasons?.slice(0,2).join(' | ')||'Waiting for a fresh book and 30 seconds of valid live prices';
   const block=A.stats(wallet,now).entryBlock;
   setStatus(block||('Receiving valid quotes from '+ready.length+'/'+symbols.length+' pairs · '+qualified.length+
    ' qualifying signals. '+(top?top.symbol+' ('+top.score+'/100): ':'')+notes+
    '. Move your mouse over any WAIT row to see every entry rule blocking it.'));
  }
  if(!out.risk.allowed&&!wallet.ledger.open)mode('DEMO RISK LIMIT / WAIT');
  else mode(results.some(r=>r.state==='WATCH')?'DEMO SIGNAL WATCH':'DEMO LIVE FEED');
 }
 function connect(id){
  lastConnected=Date.now();mode('CONNECTING TO BYBIT');
  try{socket=new WebSocket(WS)}catch(e){halt('Unable to open public Bybit stream: '+e.message);return}
  socket.onopen=()=>{
   if(id!==epoch||!active)return;
   lastConnected=Date.now();
   socket.send(JSON.stringify({op:'subscribe',args:symbols.flatMap(s=>['orderbook.50.'+s,'publicTrade.'+s])}));
   setStatus('Bybit connected. First collecting 60 seconds of real prices, then requiring a cost-aware volatility burst before a $90 Demo trade. $0.50 net remains the goal; returns are not guaranteed.');
  };
  socket.onmessage=event=>{
   if(id!==epoch||!active||document.hidden||typeof event.data!=='string'||event.data.length>900000)return;
   let msg;try{msg=JSON.parse(event.data)}catch{return}
   if(msg.success===false){halt('Bybit rejected a requested symbol or data subscription');return}
   engine?.ingest(msg,Date.now());
  };
  socket.onerror=()=>{if(active)setStatus('Public market stream error. New virtual trades require fresh prices.')};
  socket.onclose=()=>{if(id===epoch&&active)halt('Bybit public market stream closed. Virtual entries paused, any open position marked incomplete.')};
 }
 function toggle(){
  if(active){halt('Demo Seconds Scalper paused. Open virtual research trades are marked incomplete, not assumed closed.');return}
  if(!window.WebSocket)return setStatus('This browser does not support Bybit public WebSocket research.');
  if(document.hidden||document.body.dataset.account!=='demo')return setStatus('Switch to Demo Account and keep the tab visible.');
  try{symbols=E.validSymbols($('demo-seconds-pairs').value);engine=E.create(symbols)}catch(e){setStatus(e.message);return}
  const check=A.eligibility(wallet);if(!check.allowed){setStatus(check.reason);return}
  active=true;button.textContent='Pause Demo Seconds Scalper';const id=++epoch;connect(id);
 }
 button.addEventListener('click',toggle);
 $('demo-seconds-reset').addEventListener('click',()=>{
  if(active){setStatus('Pause seconds scalping before resetting the demo test wallet.');return}
  if(!window.confirm('Reset ONLY the separate Seconds Demo $100 wallet and its virtual trade history? Standard Demo trades will not be touched.'))return;
  wallet=A.initial();if(!persist())return;renderAccount();setStatus('Seconds virtual wallet reset to $100. Your regular Demo account is unchanged.');
 });
 $('demo-seconds-export').addEventListener('click',()=>{
  const rows=[...wallet.ledger.closed];if(!rows.length){setStatus('No completed virtual seconds trades to export yet.');return}
  const header='opened_at,closed_at,symbol,side,entry_price,exit_price,gross_usd,estimated_fees_usd,estimated_slippage_usd,net_usd,seconds_held,reason';
  const csv=[header,...rows.map(t=>[
   new Date(t.openedAt).toISOString(),new Date(t.closedAt).toISOString(),t.symbol,t.side,
   t.entry,t.exit,t.gross??'',t.fees??'',t.slippage??'',t.net,Math.round((t.closedAt-t.openedAt)/1000),JSON.stringify(t.reason)
  ].join(','))].join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='omega_demo_seconds_trades.csv';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)halt('Seconds Demo paused when the tab became hidden. No fabricated exits.')});
 window.addEventListener('omega:account-mode',()=>{if(active&&document.body.dataset.account!=='demo')halt('Seconds Demo paused after switching accounts.')});
 window.addEventListener('beforeunload',()=>{active=false;if(wallet.ledger.open)wallet=A.interrupt(wallet);try{localStorage.setItem(KEY,JSON.stringify(wallet))}catch{}});
 setInterval(()=>{if(active)tick()},1000);
 setInterval(()=>{if(active&&socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({op:'ping'}))},20000);
 renderAccount();
})();
