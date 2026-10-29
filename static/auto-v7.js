'use strict';
(()=>{
 const E=window.OmegaPaper,S=window.OmegaSignals,T=window.OmegaTrader,A=window.OmegaAccount,$=id=>document.getElementById(id);
 if(!E||!S||!T||!A||!$('auto-toggle'))return;
 const BARS='omega_trader_v10_entry_bars';
 // Starting a fresh page always requires an explicit start. Never restore an armed bot.
 let running=false,busy=false,lastScan=0;
 const status=s=>$('auto-message').textContent=s;
 function controls(){
  $('auto-state').textContent=running?'WATCHING':'PAUSED';
  $('auto-toggle').textContent=running?'Pause entries':'Start $10 autopilot';
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
  const positions=A.read().positions,quotes={},contexts={};
  await Promise.all(positions.map(async p=>{try{const rows=await load(p.symbol),x=S.exitContext(rows,p.side);if(x&&Date.now()-(x.barTime+300000)<=360000){quotes[p.symbol]=x.price;contexts[p.symbol]=x}}catch{}}));
  if(positions.length)await A.transact(a=>E.applyQuote(a,quotes,Date.now(),contexts),{requireLock:true});
 }
 async function cycle(force=false){
  if(busy||document.hidden)return;busy=true;
  try{
   await manage();
   if(!running||document.body.dataset.account==='real')return;
   if(!force&&Date.now()-lastScan<60000)return;
   lastScan=Date.now();
   if(T.lossStreak(A.read().closed)>=3){status('Risk pause: three consecutive losses today. New entries resume only on the next UTC day.');return}
   status('Checking liquidity, 5m / 15m trend, volume and entry location…');
   const response=await fetch('/api/scanner?market=futures&page=1&size=15',{cache:'no-store'}),data=await response.json();
   if(!response.ok)throw Error(data.error||'Market scanner unavailable');
   $('auto-universe').textContent=Number(data.universe||0).toLocaleString();
   const items=(data.rows||[]).filter(x=>['BUY WATCH','SELL WATCH'].includes(x.status)&&/^[A-Z0-9]{2,24}USDT$/.test(x.symbol)).slice(0,8);
   const results=await Promise.all(items.map(async item=>{
    const symbol=item.symbol.slice(0,-4),side=item.status==='BUY WATCH'?'BUY':'SELL';
    try{return {symbol,side,...T.evaluate(await load(symbol),item,side)}}catch{return {symbol,side,eligible:false,reason:'Candle feed unavailable'}}
   }));
   const picks=results.filter(x=>x.eligible).sort((a,b)=>b.rank-a.rank);
   const list=$('auto-shortlist');list.replaceChildren();
   for(const result of results.slice(0,5)){
    const row=document.createElement('div');row.className='decision-row';
    const market=document.createElement('strong');market.textContent=result.symbol+' / '+result.side;
    const why=document.createElement('span');why.textContent=result.eligible?'All entry checks passed':result.reason;
    row.append(market,why);list.append(row);
   }
   if(!results.length)list.textContent='No market qualifies for a closer look. Waiting is a decision.';
   $('auto-choice').textContent=picks.length?picks[0].symbol+' '+picks[0].side:'WAIT';
   if(!picks.length){status('Waiting. No setup passed every entry check.');return}
   await A.transact(a=>{
    if(!running||document.body.dataset.account==='real')return a;
    if(T.lossStreak(a.closed)>=3)throw Error('Three-loss daily pause is active.');
    if(a.positions.length>=E.MAX_POSITIONS)throw Error('Two positions open. Managing exits; no additional exposure.');
    const bars=JSON.parse(localStorage.getItem(BARS)||'{}');
    const pick=picks.find(p=>!a.positions.some(x=>x.symbol===p.symbol)&&bars[p.symbol+':'+p.side]!==p.barTime);
    if(!pick)throw Error('No new setup. Already traded this candle or market is open.');
    if(Date.now()-(pick.barTime+300000)>360000)throw Error('Setup expired during scanning.');
    // Use entry references for other open positions conservatively; never invent profit.
    const next=E.open(a,{[pick.symbol]:pick.price},{symbol:pick.symbol,side:pick.side,notional:10,stopPct:pick.stopPct,auto:true,atr:pick.atr,targetNet:pick.targetNet,slippageBps:pick.slippageBps});
    bars[pick.symbol+':'+pick.side]=pick.barTime;
    localStorage.setItem(BARS,JSON.stringify(Object.fromEntries(Object.entries(bars).slice(-200))));
    status('Opened $10 virtual '+pick.side+' '+pick.symbol+'. Net profit target $'+pick.targetNet.toFixed(2)+'; protective stop and trail active while this page is open.');
    return next;
   },{requireLock:true});
  }catch(e){status(e.message||'No trade: data unavailable.')}finally{busy=false;stats()}
 }
 $('auto-toggle').addEventListener('click',()=>{running=!running;controls();status(running?'Autopilot started. It may wait for a qualified setup.':'New entries paused. Open demo positions are still monitored while this page is visible.');if(running)cycle(true)});
 $('auto-scan').addEventListener('click',()=>{if(running)cycle(true);else status('Start autopilot to evaluate entries. No trades happen while paused.')});
 window.addEventListener('omega:account-mode',()=>{running=false;controls();status('Entries paused after changing account. Start the selected mode explicitly.')});
 window.addEventListener('omega:paper-reset',()=>{running=false;controls();localStorage.removeItem(BARS);stats()});
 window.addEventListener('omega:paper-updated',stats);
 window.addEventListener('storage',e=>{if(e.key===A.KEY)stats()});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)cycle(true)});
 controls();stats();setInterval(()=>cycle(),15000);
})();
