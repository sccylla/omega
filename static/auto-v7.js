'use strict';
(()=>{
 const E=window.OmegaPaper,S=window.OmegaSignals,T=window.OmegaTrader,A=window.OmegaAccount,$=id=>document.getElementById(id);
 if(!E||!S||!T||!A||!window.OmegaDecision||!$('auto-toggle'))return;
 // Starting a fresh page always requires an explicit start. Never restore an armed bot.
 let running=false,busy=false,managing=false;
 const status=s=>$('auto-message').textContent=s;
 function controls(){
  $('auto-state').textContent=running?'SCANNING':'OFF';
  $('auto-toggle').textContent=running?'Stop automatic entries':'Trade · scan all & enter $10';
  $('auto-toggle').classList.toggle('is-running',running);
 }
 async function load(symbol){
  const r=await fetch('/api/market?'+new URLSearchParams({exchange:'bybit',symbol,tf:'5m',limit:'100'}),{cache:'no-store'}),d=await r.json();
  if(!r.ok||!d.candles?.length)throw Error(d.error||'Fresh market feed unavailable');return d.candles;
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
    const q=await window.OmegaDecision.quote(p.symbol);
    if(q.observedAt>=p.openedAt-1000)quotes[p.symbol]=p.side==='BUY'?q.bid:q.ask;
   }else{const rows=await load(p.symbol),x=S.exitContext(rows,p.side);if(x&&Date.now()-(x.barTime+300000)<=360000){quotes[p.symbol]=x.price;contexts[p.symbol]=x}}
  }catch{}}));
  if(positions.length)await A.transact(a=>E.applyQuote(a,quotes,Date.now(),contexts),{requireLock:true});
  }finally{managing=false}
 }
 async function cycle(force=false,permitEntries=true){
  if(busy||document.hidden)return;busy=true;
  try{
   if(permitEntries)await manage();
   if(permitEntries&&(!running||document.body.dataset.account==='real'))return;
   if(permitEntries&&A.read().positions.length>=E.MAX_POSITIONS){status('Position limit reached. Existing trades remain managed; no new exposure.');return}
   status('Gathering four timeframes, depth, derivatives and historical price evidence…');
   const response=await fetch('/api/scanner?market=futures&page=1&size=15',{cache:'no-store'}),data=await response.json();
   if(!response.ok)throw Error(data.error||'Market scanner unavailable');
   $('auto-universe').textContent=Number(data.universe||0).toLocaleString();
   const {results,picks,coverage}=await window.OmegaSelection.scanMarkets(data.rows||[],{
    analyze:window.OmegaDecision.analyze,
    isCancelled:()=>permitEntries&&(!running||document.body.dataset.account==='real'),
    canEnter:p=>{const a=A.read();return !a.positions.some(x=>x.symbol===p.symbol.replace(/USDT$/,''))&&!window.OmegaPortfolio.concentrated(p.side,p.metrics?.benchmarkCorrelation,a.positions)},
    onProgress:c=>status('Scanning all markets: '+c.checked+' / '+c.total+' screened · '+c.analyzed+' deep analyses · '+c.rejected+' rejected for liquidity/spread')
   });
   if(!coverage.complete){status('Scan stopped. No new trade submitted.');return}
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
   if(!picks.length){status('Waiting. No setup passed every evidence and cost check. '+coverage.analyzed+' analyzed in depth / '+coverage.checked+' screened.');return}
   if(!permitEntries){status('Analysis complete: '+picks.length+' candidate(s). Read-only scan placed no trades.');return}
   const account=A.read();
   const candidate=picks.find(p=>!account.positions.some(x=>x.symbol===p.symbol.replace(/USDT$/,'')));
   if(!candidate)throw Error('No qualifying unheld market is available.');
   // A deep scan can take time. Obtain a current decision again immediately before entry.
   let fresh=null;
   for(const ranked of picks){if(!running||document.body.dataset.account==='real')return;const latest=await window.OmegaDecision.analyze(ranked.symbol);if(latest.eligible&&['BUY','SELL'].includes(latest.side)){fresh=latest;break}}
   if(!fresh)throw Error('No ranked pair still qualifies after refreshing market evidence.');
   window.OmegaDecision.render(fresh,fresh.symbol);
   if(!fresh.eligible||!['BUY','SELL'].includes(fresh.side))throw Error('The setup no longer qualifies: '+fresh.reason);
   await A.transact(a=>{
    if(!running||document.body.dataset.account==='real')return a;
    if(a.positions.length>=E.MAX_POSITIONS)throw Error('Two positions open. Managing exits; no additional exposure.');
    const pick=fresh,symbol=pick.symbol.replace(/USDT$/,'');
    if(a.positions.some(p=>p.symbol===symbol))throw Error('This market already has an open position.');
    if(!Number.isFinite(pick.observedAt)||Date.now()-pick.observedAt>10000||!Number.isFinite(pick.expiresAt)||Date.now()>pick.expiresAt||pick.observedAt>Date.now()+1000||Date.now()-(pick.barTime+300000)>360000)throw Error('Setup expired during scanning.');
    if(window.OmegaPortfolio.concentrated(pick.side,pick.metrics?.benchmarkCorrelation,a.positions))throw Error('Portfolio concentration: correlated exposure or unknown correlation blocks another position.');
    const next=E.open(a,{[symbol]:pick.executionPrice},{symbol,side:pick.side,notional:10,stopPct:pick.stopPct,auto:true,atr:pick.atr,targetNet:pick.targetNet,slippageBps:pick.slippageBps,entryEvidence:{strategy:'evidence-v11',observedAt:pick.observedAt,checksPassed:pick.checks.filter(c=>c.pass).length,checksTotal:pick.checks.length,benchmarkCorrelation:pick.metrics?.benchmarkCorrelation??null}});
    status('Opened $10 virtual '+pick.side+' '+symbol+'. Net profit target $'+pick.targetNet.toFixed(2)+'; protective stop active while this page is open.');
    return next;
   },{requireLock:true});
  }catch(e){status(e.message||'No trade: data unavailable.')}finally{busy=false;stats()}
 }
 $('auto-toggle').addEventListener('click',()=>{running=!running;controls();status(running?'Autopilot started. It may wait for a qualified setup.':'New entries paused. Open demo positions are still monitored while this page is visible.');if(running)cycle(true)});
 document.querySelector('[data-view="demo"]')?.addEventListener('click',()=>{if(document.body.dataset.account==='real'){window.dispatchEvent(new Event('omega:live-scan'));return}if(busy){status('Full-market scan already running; progress is shown below.');return}running=true;controls();cycle(true)});
 $('auto-scan').addEventListener('click',()=>cycle(true,false));
 window.addEventListener('omega:account-mode',()=>{running=false;controls();status('Entries paused after changing account. Start the selected mode explicitly.')});
 window.addEventListener('omega:paper-reset',()=>{running=false;controls();stats()});
 window.addEventListener('omega:paper-updated',()=>{stats();if(running&&!busy)queueMicrotask(()=>cycle(true))});
 window.addEventListener('storage',e=>{if(e.key===A.KEY)stats()});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)cycle(true)});
 controls();stats();setInterval(()=>{if(!document.hidden)manage().catch(e=>status(e.message));cycle()},15000);
})();
