'use strict';
(()=>{
 const E=window.OmegaPaper,S=window.OmegaSignals,T=window.OmegaTrader,A=window.OmegaAccount,M=window.OmegaSelection,$=id=>document.getElementById(id);
 if(!E||!S||!T||!A||!M||!window.OmegaDecision||!$('auto-toggle'))return;
 // Starting a fresh page always requires an explicit start. Never restore an armed bot.
 let running=false,busy=false,managing=false,activeRun=null,cursor=null,passNumber=0;
 const status=(s,state)=>{$('auto-message').textContent=s;if(state)$('auto-state').textContent=state};
 const progress=s=>{if($('auto-progress'))$('auto-progress').textContent=s};
 function controls(){
  $('auto-state').textContent=running?'READY':'OFF';
  $('auto-toggle').textContent=running?'Stop automatic entries':'Trade · scan all & enter $10';
  $('auto-toggle').classList.toggle('is-running',running);
 }
 async function load(symbol){
  return M.within(async signal=>{const r=await fetch('/api/market?'+new URLSearchParams({exchange:'bybit',symbol,tf:'5m',limit:'100'}),{cache:'no-store',signal}),d=await r.json();
  if(!r.ok||!d.candles?.length)throw Error(d.error||'Fresh market feed unavailable');return d.candles},{timeoutMs:8000,label:'Position price feed'});
 }
 function stats(){
  let a;try{a=A.read()}catch{return}
  const x=T.performance(a.closed.filter(r=>r.auto===true)),money=v=>(v<0?'−$':'$')+Math.abs(v).toFixed(2);
  $('bot-trades').textContent=x.count;
  $('bot-winrate').textContent=x.winRate===null?'—':x.winRate.toFixed(1)+'%';
  $('bot-expectancy').textContent=x.expectancy===null?'—':money(x.expectancy);
  $('bot-net').textContent=money(x.net);
  $('bot-sample').textContent=x.count<30?'Early sample · '+x.count+'/30 closed trades':'Last '+x.count+' closed trades · simulated results';
 }
 async function manage(){
  if(managing)return;managing=true;try{
  const positions=A.read().positions,quotes={},contexts={};
  await Promise.all(positions.map(async p=>{try{
   if(p.entryEvidence?.strategy==='evidence-v11'){
    const q=await M.within(()=>window.OmegaDecision.quote(p.symbol),{timeoutMs:8000,label:'Exit quote'});
    if(q.observedAt>=p.openedAt-1000)quotes[p.symbol]=p.side==='BUY'?q.bid:q.ask;
   }else{const rows=await load(p.symbol),x=S.exitContext(rows,p.side);if(x&&Date.now()-(x.barTime+300000)<=360000){quotes[p.symbol]=x.price;contexts[p.symbol]=x}}
  }catch{}}));
  if(positions.length)await M.within(signal=>A.transact(a=>E.applyQuote(a,quotes,Date.now(),contexts),{requireLock:true,signal}),{timeoutMs:5000,label:'Demo account update'});
  }finally{managing=false}
 }
 async function cycle(force=false,permitEntries=true){
  if(busy||document.hidden||permitEntries&&(!running||document.body.dataset.account==='real'))return;busy=true;
  const run=new AbortController();activeRun=run;let expired=false;
  const deadline=setTimeout(()=>{expired=true;run.abort()},60000);
  const pass=++passNumber;
  try{
   if(permitEntries)await manage();
   if(permitEntries&&(!running||document.body.dataset.account==='real'))return;
   if(permitEntries&&A.read().positions.length>=E.MAX_POSITIONS){status('Position limit reached. Existing trades remain managed; no new exposure.','MANAGING');return}
   if(run.signal.aborted)throw new DOMException('Scan cancelled','AbortError');
   $('auto-state').textContent='SCANNING';
   progress('Pass '+pass+': loading the full market list…');
   const data=await M.within(async signal=>{const response=await fetch('/api/scanner?market=futures&page=1&size=15',{cache:'no-store',signal}),data=await response.json();
    if(!response.ok)throw Error(data.error||'Market scanner unavailable');return data;
   },{signal:run.signal,timeoutMs:12000,label:'Market list'});
   $('auto-universe').textContent=Number(data.universe||0).toLocaleString();
   const {results,picks,coverage,summary,nextAfter}=await M.scanMarkets(data.rows||[],{
    analyze:window.OmegaDecision.analyze,
    signal:run.signal,maxMs:30000,allowPartial:true,startAfter:cursor,
    isCancelled:()=>document.hidden||permitEntries&&(!running||document.body.dataset.account==='real'),
    canEnter:p=>{const a=A.read();return !a.positions.some(x=>x.symbol===p.symbol.replace(/USDT$/,''))&&!window.OmegaPortfolio.concentrated(p.side,p.metrics?.benchmarkCorrelation,a.positions)},
    onProgress:c=>progress('Pass '+pass+': '+c.screened+' markets screened · '+c.analyzed+' detailed results · '+c.rejected+' rejected for liquidity/spread · '+c.remaining+' awaiting detailed analysis')
   });
   if(coverage.cancelled){status('Scan stopped. No new trade submitted.','OFF');return}
   cursor=nextAfter;
   const scope=coverage.complete?'Full detailed scan complete.':'30-second analysis pass complete; remaining pairs continue on the next pass.';
   progress('Pass '+pass+' complete. '+coverage.screened+' screened · '+coverage.analyzed+' detailed results · '+coverage.incomplete+' unavailable or unfinished. '+scope);
   const list=$('auto-shortlist');list.replaceChildren();
   for(const result of [...picks,...results.filter(x=>!picks.includes(x))].slice(0,5)){
    const row=document.createElement('div');row.className='decision-row';
    const market=document.createElement('button');market.type='button';market.textContent=result.symbol.replace(/USDT$/,'')+' / '+(result.eligible?result.side:'WAIT');market.addEventListener('click',()=>window.OmegaDecision.render(result,result.symbol));
    const why=document.createElement('span');why.textContent=result.reason;
    row.append(market,why);list.append(row);
   }
   if(!results.length)list.textContent='No market qualifies for a closer look. Waiting is a decision.';
   $('auto-choice').textContent=picks.length?picks[0].symbol+' '+picks[0].side:'WAIT';
   if(results.length)window.OmegaDecision.render(picks[0]||results[0],(picks[0]||results[0]).symbol);
   if(!picks.length){status('Pass '+pass+': '+(permitEntries?'No entry. ':'Scan only; trading is disabled for this scan. ')+M.explain(summary),permitEntries?'NO ENTRY':'SCAN ONLY');return}
   if(!permitEntries){status('Analysis complete: '+picks.length+' candidate(s). Scan without trading never places orders; press Trade to enable automatic entries.','SCAN ONLY');return}
   const account=A.read();
   const candidate=picks.find(p=>!account.positions.some(x=>x.symbol===p.symbol.replace(/USDT$/,'')));
   if(!candidate)throw Error('No qualifying unheld market is available.');
   // A deep scan can take time. Obtain a current decision again immediately before entry.
   let fresh=null;
   $('auto-state').textContent='CHECKING ENTRY';
   for(const ranked of picks){if(!running||document.hidden||document.body.dataset.account==='real')return;const latest=await M.within(signal=>window.OmegaDecision.analyze(ranked.symbol,{signal}),{signal:run.signal,timeoutMs:25000,label:'Entry evidence'});if(latest.eligible&&['BUY','SELL'].includes(latest.side)){fresh=latest;break}}
   if(!fresh)throw Error('No ranked pair still qualifies after refreshing market evidence.');
   window.OmegaDecision.render(fresh,fresh.symbol);
   if(!fresh.eligible||!['BUY','SELL'].includes(fresh.side))throw Error('The setup no longer qualifies: '+fresh.reason);
   await M.within(signal=>A.transact(a=>{
    if(!running||document.hidden||run.signal.aborted||document.body.dataset.account==='real')return a;
    if(a.positions.length>=E.MAX_POSITIONS)throw Error('Two positions open. Managing exits; no additional exposure.');
    const pick=fresh,symbol=pick.symbol.replace(/USDT$/,'');
    if(a.positions.some(p=>p.symbol===symbol))throw Error('This market already has an open position.');
    if(!Number.isFinite(pick.observedAt)||Date.now()-pick.observedAt>10000||!Number.isFinite(pick.expiresAt)||Date.now()>pick.expiresAt||pick.observedAt>Date.now()+1000||Date.now()-(pick.barTime+300000)>360000)throw Error('Setup expired during scanning.');
    if(window.OmegaPortfolio.concentrated(pick.side,pick.metrics?.benchmarkCorrelation,a.positions))throw Error('Portfolio concentration: correlated exposure or unknown correlation blocks another position.');
    const next=E.open(a,{[symbol]:pick.executionPrice},{symbol,side:pick.side,notional:10,stopPct:pick.stopPct,auto:true,atr:pick.atr,targetNet:pick.targetNet,slippageBps:pick.slippageBps,entryEvidence:{strategy:'evidence-v11',observedAt:pick.observedAt,checksPassed:pick.checks.filter(c=>c.pass).length,checksTotal:pick.checks.length,benchmarkCorrelation:pick.metrics?.benchmarkCorrelation??null}});
    status('Pass '+pass+': opened $10 virtual '+pick.side+' '+symbol+', the best qualifying pair analyzed in this pass. Net profit target $'+pick.targetNet.toFixed(2)+'; protective stop active while this page is open.','TRADE OPEN');
    return next;
   },{requireLock:true,signal}),{signal:run.signal,timeoutMs:5000,label:'Demo entry account lock'});
  }catch(e){
   if(expired)status('Pass '+pass+' reached its 60-second deadline. No new trade submitted; retrying on the next monitoring check.','SCAN TIMEOUT');
   else if(run.signal.aborted)status('Scan cancelled. No new trade submitted.','OFF');
   else status(e.message||'No trade: data unavailable.','ENTRY BLOCKED');
   progress('Pass '+pass+' ended. '+(expired?'Scan deadline reached.':run.signal.aborted?'Cancelled.':'See the last result above.'));
  }finally{clearTimeout(deadline);if(activeRun===run)activeRun=null;busy=false;stats()}
 }
 $('auto-toggle').addEventListener('click',()=>{running=!running;if(!running)activeRun?.abort();controls();status(running?'Autopilot started. It may wait for a qualified setup.':'New entries paused. Open demo positions are still monitored while this page is visible.');if(running)cycle(true)});
 document.querySelector('[data-view="demo"]')?.addEventListener('click',()=>{if(document.body.dataset.account==='real'){window.dispatchEvent(new Event('omega:live-scan'));return}if(busy){status('Full-market scan already running; progress is shown below.');return}running=true;controls();cycle(true)});
 $('auto-scan').addEventListener('click',()=>cycle(true,false));
 window.addEventListener('omega:account-mode',()=>{running=false;activeRun?.abort();controls();status('Entries paused after changing account. Start the selected mode explicitly.')});
 window.addEventListener('omega:paper-reset',()=>{running=false;activeRun?.abort();cursor=null;controls();stats()});
 window.addEventListener('omega:paper-updated',()=>{stats();if(running&&!busy)queueMicrotask(()=>cycle(true))});
 window.addEventListener('storage',e=>{if(e.key===A.KEY)stats()});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)activeRun?.abort();else cycle(true)});
 controls();stats();setInterval(()=>{if(!document.hidden)manage().catch(e=>status(e.message));cycle()},15000);
})();
