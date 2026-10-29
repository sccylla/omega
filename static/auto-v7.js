'use strict';
(()=>{
 const E=window.OmegaPaper,S=window.OmegaSignals,$=id=>document.getElementById(id),STORE='omega_trader_v6_browser_paper_account',BOT='omega_trader_v7_auto_demo',ENTRY_BARS='omega_trader_v9_entry_bars';
 if(!E||!S||!$('auto-toggle'))return;
 let running=false,busy=false,shortlist=[],universe=0,failed=0;
 try{const state=JSON.parse(sessionStorage.getItem(BOT)||'{}');running=!!state.running}catch{}
 const setStatus=(s)=>{$('auto-message').textContent=s};
 function account(){let a;try{a=JSON.parse(localStorage.getItem(STORE))}catch{}return E.restore(a)}
 function store(a){localStorage.setItem(STORE,JSON.stringify(a));window.dispatchEvent(new StorageEvent('storage',{key:STORE,newValue:JSON.stringify(a)}))}
 function state(){try{sessionStorage.setItem(BOT,JSON.stringify({running}))}catch{};$('auto-state').textContent=running?'SCANNING':'OFF';$('auto-toggle').textContent=running?'■ Stop auto demo':'▶ Start auto demo';}
 async function load(sym){const response=await fetch('/api/market?exchange=bybit&symbol='+encodeURIComponent(sym)+'&tf=5m&limit=90',{cache:'no-store'});if(!response.ok)throw Error('Market feed blocked');const body=await response.json();if(!body.candles?.length)throw Error('No candles');return body.candles;}
 async function updateOpen(a){const positions=a.positions.slice();if(!positions.length)return a;
  const quotes={},contexts={};for(const p of positions){try{const candles=await load(p.symbol);const info=S.exitContext(candles,p.side);if(info){quotes[p.symbol]=info.price;contexts[p.symbol]=info}}catch{}}
  const after=E.applyQuote(a,quotes,Date.now(),contexts);if(JSON.stringify(after)!==JSON.stringify(a))store(after);return after;
 }
 async function cycle(enter=true){if(busy||document.hidden)return;busy=true;try{
  let a=account();a=await updateOpen(a);
  if(!running||!enter)return;
  setStatus('Scanning active futures and verifying fresh candle history…');
  const response=await fetch('/api/scanner?market=futures&page=1&size=35',{cache:'no-store'});if(!response.ok)throw Error('Futures scanner unavailable');const data=await response.json();universe=data.universe||0;$('auto-universe').textContent=universe.toLocaleString();
  const picks=(data.rows||[]).filter(x=>['BUY WATCH','SELL WATCH'].includes(x.status)&&x.turnover24h>=10000000&&x.spreadBps<=8&&Math.abs(x.fundingPct)<=0.06).slice(0,15);
  const deep=await Promise.all(picks.slice(0,10).map(async item=>{try{const s=item.symbol.replace(/USDT$/,'');const side=item.status==='BUY WATCH'?'BUY':'SELL',rows=await load(s),ok=S.entrySetup(rows,side);return ok?{symbol:s,side,score:Math.max(item.buyScore,item.sellScore)+Math.min(10,Math.max(0,(ok.volumeRatio-1)*5)),spread:item.spreadBps,...ok}:null}catch{return null}}));
  shortlist=deep.filter(Boolean).sort((a,b)=>b.score-a.score);$('auto-shortlist').innerHTML=shortlist.length?shortlist.slice(0,5).map(x=>`<span>${x.symbol} · ${x.side==='BUY'?'BUY':'SELL'} · ${x.score.toFixed(0)} screen points</span>`).join(''):'No confirmed trade setup. Bot is waiting.';
  $('auto-choice').textContent=shortlist.length?shortlist[0].symbol+' '+shortlist[0].side:'WAIT';
  if(!shortlist.length){setStatus('No eligible setup passed screening and candle confirmation. Waiting.');return}
  a=account();if(a.positions.length>=E.MAX_POSITIONS){setStatus('Maximum of two virtual positions; managing existing trades.');return}
  let previousBars={};try{previousBars=JSON.parse(localStorage.getItem(ENTRY_BARS)||'{}')}catch{}
  const pick=shortlist.find(x=>!a.positions.some(p=>p.symbol===x.symbol)&&previousBars[x.symbol+':'+x.side]!==x.barTime);
  if(!pick){setStatus('No new confirmed candle setup; existing markets are held or already traded this candle.');return}
  const quotes={[pick.symbol]:pick.price},notional=Number($('auto-notional').value);
  // Entry is cancelled if quote or market history was stale.
  const preview=E.entryPreview(a,quotes,{symbol:pick.symbol,side:pick.side,notional});
  if(!Number.isFinite(preview.estimatedStopRisk))return;
  const stopPct=Math.max(0.6,Math.min(1.5,2.2*pick.atr/pick.price*100));
  a=E.open(a,quotes,{symbol:pick.symbol,side:pick.side,notional,stopPct,auto:true,atr:pick.atr});store(a);
  previousBars[pick.symbol+':'+pick.side]=pick.barTime;localStorage.setItem(ENTRY_BARS,JSON.stringify(Object.fromEntries(Object.entries(previousBars).slice(-200))));
  setStatus('Opened VIRTUAL '+pick.side+' '+pick.symbol+'. No fixed dollar take-profit; ATR-based trailing protection activates after a meaningful favorable move.');
 }catch(e){failed++;setStatus('No demo trade placed: '+(e?.message||'Feed unavailable'));}finally{busy=false}}
 $('auto-toggle').addEventListener('click',()=>{running=!running;state();setStatus(running?'Auto demo enabled. Orders only while tab is open.':'Auto demo stopped. Existing positions still need monitoring.');if(running)cycle()});
 $('auto-scan').addEventListener('click',()=>{if(running)cycle();else setStatus('Turn on auto demo to scan and consider virtual entries.');});
 $('paper-reset')?.addEventListener('click',()=>{running=false;state();shortlist=[];try{localStorage.removeItem(ENTRY_BARS)}catch{}});
 state();if(running)cycle();
 // Monitoring of open auto trades runs even when new entries are disabled, but only in an active tab.
 setInterval(()=>{if(!document.hidden)cycle(running)},60000);
})();
