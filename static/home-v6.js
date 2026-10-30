'use strict';
(()=>{
const $=id=>document.getElementById(id),E=window.OmegaPaper;
const STORAGE=window.OmegaAccount.KEY;
const SYMBOLS=['BTC','ETH','SOL'];
const money=n=>(n<0?'−$':'$')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const price=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const htmlEscape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let saved;try{saved=JSON.parse(localStorage.getItem(STORAGE)||'null')}catch{};
let account=E.restore(saved),quotes={},series={},latestTime={},lastRefresh=0,loading=false;
function chartSVG(rows){
 const candles=(rows||[]).filter(r=>Number.isFinite(r[4])&&r[4]>0);if(candles.length<4)return '<div class="chart-loading">Historical chart unavailable</div>';
 const ys=candles.map(r=>r[4]),min=Math.min(...ys),max=Math.max(...ys),margin=(max-min)*.15||max*.0001;
 const lo=min-margin,hi=max+margin,w=800,h=245,top=15,bottom=220,plot=bottom-top;
 const pts=ys.map((y,i)=>[(i/(ys.length-1)*w).toFixed(2),(bottom-(y-lo)/(hi-lo)*plot).toFixed(2)]);
 const path=pts.map((p,i)=>(i?'L':'M')+p.join(' ')).join(' ');
 const color=ys.at(-1)>=ys[0]?'#70efc0':'#e69b9e';
 const lines=Array.from({length:4},(_,i)=>`<line x1="0" x2="800" y1="${top+i*plot/3}" y2="${top+i*plot/3}" stroke="#33515a" stroke-opacity=".45" stroke-dasharray="4 8"/>`).join('');
 return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Public market price history chart"><defs><linearGradient id="omega-v6-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".25"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${lines}<path d="${path}L800 245L0 245Z" fill="url(#omega-v6-area)"/><path d="${path}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="5" fill="${color}"/></svg>`;
}
function paperStatus(msg){$('paper-ticket-status').textContent=msg;}
function summary(){
 const eq=E.equity(account,quotes),total=eq-E.INITIAL,opened=account.positions.length;
 $('home-demo-equity').textContent=money(eq);$('home-demo-cash').textContent=money(account.cash);
 $('home-demo-open').textContent=opened;$('home-open-positions').textContent=opened+' position'+(opened===1?'':'s');
 $('home-demo-movement').textContent=(total>=0?'+':'')+money(total)+' all-time';
 $('home-demo-movement').className=total<0?'paper-stat-down':'paper-stat-up';
 $('home-today-pnl').textContent=money(E.todayPnl(account));$('home-today-pnl').className=E.todayPnl(account)<0?'paper-stat-down':'paper-stat-up';
 $('demo-equity').textContent=money(eq);$('demo-cash').textContent=money(account.cash);$('demo-total-pnl').textContent=money(total);
 $('demo-total-pnl').className=total<0?'paper-stat-down':'paper-stat-up';$('demo-position-count').textContent=opened+' / '+E.MAX_POSITIONS;
 $('paper-open-count').textContent=opened;
 $('paper-last-update').textContent=opened?'Reference prices: '+new Date(lastRefresh||Date.now()).toLocaleTimeString():'No open positions';
}
function renderPositions(){
 $('paper-open-rows').innerHTML=account.positions.length?account.positions.map(p=>{
 const quote=quotes[p.symbol],unreal=E.markPnl(p,quote||p.entry);
 return `<tr><td><strong>${p.symbol} / USDT</strong></td><td><span class="side-tag ${p.side==='BUY'?'long':'short'}">${p.side==='BUY'?'BUY / LONG':'SELL / SHORT'}</span></td><td>$${price(p.entry)}</td><td>${quote?'$'+price(quote):'—'}</td><td class="${unreal<0?'paper-stat-down':'paper-stat-up'} demo-position-value">${money(unreal-p.entryFee-(quote||p.entry)*p.qty*E.FEE_RATE)}*</td><td>${p.auto?'$'+price(p.stop)+(p.closeOnProfit?' / Any net profit':p.targetNet?' / +$'+p.targetNet.toFixed(2)+' net':' / Trail'):'$'+price(p.stop)+' / $'+price(p.target)}</td><td><button class="paper-close-btn" data-paper-close="${p.id}" ${quote?'':'disabled'}>Close</button></td></tr>`
 }).join(''):'<tr><td colspan="7" class="center">No open demo positions. Practice your first trade above.</td></tr>';
 $('paper-open-rows').querySelectorAll('[data-paper-close]').forEach(el=>el.addEventListener('click',()=>{
 const p=account.positions.find(x=>x.id===el.dataset.paperClose),q=quotes[p?.symbol];if(!p||!Number.isFinite(q))return;
 if(!window.confirm('Close your virtual '+p.symbol+' '+p.side+' position at the latest reported candle price?'))return;
 window.OmegaAccount.transact(a=>E.close(a,p.id,q,'Manual demo close')).catch(e=>paperStatus(e.message));
 }));
 $('paper-history-rows').innerHTML=account.closed.length?account.closed.slice(0,12).map(x=>`<tr><td><strong>${x.symbol} / USDT</strong></td><td>${x.side}</td><td class="${x.net<0?'paper-stat-down':'paper-stat-up'}">${money(x.net)}</td><td>${new Date(x.closedAt).toLocaleString()}</td><td>${htmlEscape(x.reason)}</td></tr>`).join(''):'<tr><td colspan="5" class="center">Completed virtual trades will appear here.</td></tr>';
}
function ticketPreview(){
 const sym=$('paper-symbol').value,size=Number($('paper-size').value),quote=quotes[sym];
 $('paper-fee').textContent=Number.isFinite(size)&&size>0?money(size*E.FEE_RATE):'—';
 $('paper-risk').textContent=Number.isFinite(size)&&size>0?money(size*(.015+2*E.FEE_RATE)):'—';
 const valid=Number.isFinite(quote)&&Date.now()-(latestTime[sym]||0)<900000;
 let error='';try{E.entryPreview(account,quotes,{symbol:sym,side:'BUY',notional:size})}catch(e){error=e.message}
 $('paper-buy').disabled=!valid||!!error;
 $('paper-sell').disabled=!valid||!!error;
 if(!valid)paperStatus('No fresh public reference price. Demo orders are paused.');
 else if(error)paperStatus(error);
 else paperStatus('Virtual trade only · No money or broker orders involved.');
}
function render(){summary();renderPositions();ticketPreview()}
function updateSelected(){
 const sym=$('paper-symbol').value,q=quotes[sym];$('paper-chart-title').textContent=sym+' / USDT';
 $('paper-price').textContent=q?'$'+price(q):'—';$('paper-chart-price').textContent=q?'$'+price(q):'—';
 $('paper-quote-time').textContent=latestTime[sym]?'Fetched '+new Date(latestTime[sym]).toLocaleTimeString():'Checking public feed…';
 $('paper-chart').innerHTML=chartSVG(series[sym]);
 $('paper-feed-status').textContent=latestTime[sym]?'Updated '+new Date(latestTime[sym]).toLocaleTimeString():'No reference available';
 if(quotes.BTC){$('home-btc-price').textContent='$'+price(quotes.BTC);$('home-btc-chart').innerHTML=chartSVG(series.BTC);$('home-btc-fresh').textContent='Updated '+new Date(latestTime.BTC).toLocaleTimeString();}
}
async function quotesRefresh(){
 if(loading)return;loading=true;
 const needed=[...new Set([...SYMBOLS,...account.positions.map(p=>p.symbol)])].slice(0,12);
 const all=await Promise.all(needed.map(async sym=>{
  try{
   const response=await fetch('/api/market?exchange=bybit&symbol='+sym+'&tf=5m&limit=100',{cache:'no-store'});
   const data=await response.json();if(!response.ok||!data.candles?.length)throw Error(data.error||'Public feed unavailable');
   const closed=data.candles.filter(x=>x[0]+300000<=Date.now());const c=closed.at(-1);
   if(!c||Date.now()-(c[0]+300000)>360000)throw Error('Candle too old');
   let quote=Number(c[4]);const position=account.positions.find(p=>p.symbol===sym);
   if(position?.entryEvidence?.strategy==='evidence-v11'){
    const current=await window.OmegaDecision.quote(sym);
    if(current.observedAt<position.openedAt-1000)throw Error('Exit quote predates the position');
    quote=position.side==='BUY'?current.bid:current.ask;
   }
   return {sym,quote,candles:closed.slice(-80),time:Date.now()};
  }catch(err){return {sym,error:err.message}}
 }));
 for(const r of all){if(r.error){delete quotes[r.sym];delete latestTime[r.sym]}else{quotes[r.sym]=r.quote;series[r.sym]=r.candles;latestTime[r.sym]=r.time}}
 // No checks run when browser is closed. Candle samples do not model actual execution or stop fills.
 const contexts={};for(const sym of Object.keys(series)){const p=account.positions.find(x=>x.symbol===sym);if(p&&window.OmegaSignals){const m=window.OmegaSignals.exitContext(series[sym],p.side);if(m)contexts[sym]=m}}
 try{account=await window.OmegaAccount.transact(a=>E.applyQuote(a,quotes,Date.now(),contexts))}catch(e){paperStatus(e.message)}lastRefresh=Date.now();
 $('paper-refresh').textContent='↻';updateSelected();render();loading=false;
}
async function homeOpportunities(){
 const container=$('home-market-candidates');
 try{
  const response=await fetch('/api/scanner?market=futures&page=1&size=12',{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error||'Feed unavailable');
  const picks=(data.rows||[]).filter(x=>['BUY WATCH','SELL WATCH'].includes(x.status)).sort((a,b)=>Math.max(b.buyScore,b.sellScore)-Math.max(a.buyScore,a.sellScore)).slice(0,3);
  if(!picks.length){container.innerHTML='<div class="empty-small">No strong market watchlist candidates right now. Waiting is a valid choice.</div>';return;}
  container.innerHTML=picks.map(x=>{
   const sym=String(x.symbol||'').replace(/[^A-Z0-9]/g,''),buy=x.status==='BUY WATCH';const score=Math.max(0,Math.min(100,Number(buy?x.buyScore:x.sellScore)||0));
   return `<div class="home-candidate"><span class="market-symbol-dot">${htmlEscape(sym.slice(0,2))}</span><div class="candidate-name"><strong>${htmlEscape(sym)}</strong><small>24h technical screening · Futures</small></div><span class="candidate-tag ${buy?'buy':'sell'}">${buy?'↗ BUY WATCH':'↘ SELL WATCH'}</span><span class="candidate-score">${score.toFixed(0)}/100</span></div>`;
  }).join('');
 }catch(e){container.innerHTML='<div class="empty-small">Market scanner temporarily unavailable. No signals assumed.</div>'}
}
$('paper-symbol').addEventListener('change',()=>{updateSelected();ticketPreview()});
$('paper-size').addEventListener('input',()=>{document.querySelectorAll('[data-paper-size]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.paperSize)===Number($('paper-size').value)));ticketPreview()});
document.querySelectorAll('[data-paper-size]').forEach(b=>b.addEventListener('click',()=>{$('paper-size').value=b.dataset.paperSize;$('paper-size').dispatchEvent(new Event('input'))}));
async function submit(side){const sym=$('paper-symbol').value,notional=Number($('paper-size').value);
 try{
  if(Date.now()-(latestTime[sym]||0)>900000)throw Error('Public quote is stale. Refresh first.');
  const p=E.entryPreview(account,quotes,{symbol:sym,side,notional});
  if(!window.confirm(`Open a ${side==='BUY'?'BUY / LONG':'SELL / SHORT'} virtual ${sym} position for ${money(p.notional)}?\n\nEstimated stop risk: ${money(p.estimatedStopRisk)} including fees.\nThis is browser-only demo trading, not a Bybit order.`))return;
  account=await window.OmegaAccount.transact(a=>E.open(a,quotes,{symbol:sym,side,notional}));render();paperStatus('Your '+side+' demo position has been opened.');
 }catch(e){paperStatus(e.message)}
}
$('paper-buy').addEventListener('click',()=>submit('BUY'));
$('paper-sell').addEventListener('click',()=>submit('SELL'));
$('paper-refresh').addEventListener('click',()=>{paperStatus('Refreshing public prices…');quotesRefresh()});
$('paper-reset').addEventListener('click',()=>{if(!window.confirm('Reset your virtual portfolio to $100? All simulated positions and trade history on this device will be erased.'))return;window.OmegaAccount.transact(()=>E.initial()).then(()=>{window.dispatchEvent(new Event('omega:paper-reset'));paperStatus('Virtual balance reset to $100.')}).catch(e=>paperStatus(e.message));});
window.addEventListener('omega:paper-updated',e=>{account=e.detail;render()});
render();updateSelected();quotesRefresh();homeOpportunities();
setInterval(()=>{if(!document.hidden&&['demo','overview'].includes(location.hash.slice(1)))quotesRefresh()},25000);
window.addEventListener('storage',e=>{if(e.key===STORAGE){let next;try{next=JSON.parse(e.newValue||'null')}catch{};account=E.restore(next);render()}});
})();
