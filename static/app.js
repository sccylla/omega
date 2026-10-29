'use strict';
const $ = (id) => document.getElementById(id);
let state = null, selectedSymbol = 'BTC/USDT:USDT', busy = false, lastError = '';
const symbolsShort = s => s ? s.split('/')[0] : '?';
const money = n => Number(n || 0).toLocaleString('en-US', { style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:2 });
const num = (n,d=2) => Number(n).toLocaleString('en-US', { maximumFractionDigits:d });
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when = ts => new Date(ts).toLocaleString([], {month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const request = async (path, body) => window.omegaAction(path,body);
function alertUser(message, error=true){const el=$('alert');el.textContent=message;el.hidden=false;el.style.background=error?'#39222b':'#173a34';el.style.borderColor=error?'#7e4552':'#367d69';clearTimeout(alertUser.timeout);alertUser.timeout=setTimeout(()=>el.hidden=true,8000)}
function signed(el,value){el.textContent=(value>0?'+':'')+money(value);el.classList.toggle('positive',value>0);el.classList.toggle('negative',value<0)}
function render(){if(!state)return;
  $('equity').textContent=money(state.equity);signed($('pnl'),state.total_pnl);signed($('daily'),state.day_pnl);
  $('positions-count').innerHTML=state.positions.length+' <small>/ 2</small>';
  $('runtime-label').textContent=state.running?'● Browser automation active':'Automation paused';
  const toggle=$('toggle');toggle.className='btn '+(state.running?'btn-danger':'btn-green');toggle.textContent=state.running?'■ Stop & flatten':'▶ Start browser bot';
  $('feed-status').textContent=state.last_update?(state.last_error?'● PARTIAL FEED':'● MARKET CONNECTED'):'● WAITING FOR DATA';
  $('feed-status').style.color=state.last_error?'#eac78d':state.last_update?'#46e1ad':'#8395ab';
  $('last-updated').textContent=state.last_update?'FEED: '+when(state.last_update):'NO DATA YET';
  $('exchange-name').textContent=state.settings.exchange.toUpperCase();$('timeframe-tag').textContent='/ '+state.settings.timeframe+' candles';
  if(!state.settings.symbols.includes(selectedSymbol))selectedSymbol=state.settings.symbols[0];
  $('symbols').innerHTML=state.settings.symbols.map(s=>`<button class="${selectedSymbol===s?'selected':''}" data-symbol="${esc(s)}">${symbolsShort(s)}</button>`).join('');
  $('symbols').querySelectorAll('button').forEach(b=>b.onclick=()=>{selectedSymbol=b.dataset.symbol;render()});
  $('symbol-name').textContent=symbolsShort(selectedSymbol)+' / USDT';
  $('market-price').textContent=state.prices[selectedSymbol]?money(state.prices[selectedSymbol]):'—';
  const a=state.analytics[selectedSymbol];
  $('signal').textContent=a?.signal || 'WAITING';$('signal').className='signal-text '+(a?.signal==='BUY'?'long':a?.signal==='SELL'?'short':'');
  $('signal-reason').textContent=a?.reason || 'Fetch market data to begin analysis.';
  $('ema').textContent=a?.ema_fast?num(a.ema_fast,4)+' / '+num(a.ema_slow,4):'—';
  $('trend').textContent=a?.trend||'—';$('rsi').textContent=a?.rsi!=null?num(a.rsi):'—';$('atr').textContent=a?.atr!=null?num(a.atr,5):'—';
  $('chart-source').textContent=state.last_update?state.settings.exchange.toUpperCase()+' · '+when(state.last_update):'No market feed yet';
  $('chart-empty').hidden=!!state.candles[selectedSymbol]?.length;
  $('position-count-label').textContent=state.positions.length+' active';
  $('positions-table').innerHTML=state.positions.length?table(['MARKET','DIRECTION','ENTRY','MARK','P&L'],state.positions.map(p=>[symbolsShort(p.symbol),tag(p.side),money(p.entry),money(p.mark),coloredMoney(p.unrealized)])):'<div class="zero-state">No paper positions open. Trades appear when strategy conditions align.</div>';
  $('trades-table').innerHTML=state.trades.length?table(['MARKET','SIDE','CLOSED','REASON','P&L'],state.trades.slice(0,20).map(t=>[symbolsShort(t.symbol),tag(t.side),when(t.ts),esc(t.reason),coloredMoney(t.pnl)])):'<div class="zero-state">No closed trades yet.</div>';
  $('activity').innerHTML=state.logs.length?state.logs.slice(0,16).map(l=>`<div class="event"><span class="event-time">${when(l.ts)}</span><span class="event-mark ${esc(l.level)}">●</span><span>${esc(l.text)}</span></div>`).join(''):'<div class="zero-state">No recent events. Refresh markets or start the paper bot.</div>';
  drawCandles();drawEquity();
}
function coloredMoney(v){return `<b class="${v>0?'positive':v<0?'negative':''}">${v>0?'+':''}${money(v)}</b>`}
function tag(s){return `<span class="${s==='LONG'?'tag-long':'tag-short'}">${esc(s)}</span>`}
function table(head,rows){return `<table class="data-table"><thead><tr>${head.map(x=>'<th>'+esc(x)+'</th>').join('')}</tr></thead><tbody>${rows.map(cells=>'<tr>'+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')}</tbody></table>`}
function canvasSetup(el){const w=Math.max(100,el.clientWidth),h=Math.max(100,el.clientHeight),dpr=window.devicePixelRatio||1;el.width=Math.round(w*dpr);el.height=Math.round(h*dpr);const ctx=el.getContext('2d');ctx.scale(dpr,dpr);return {ctx,w,h}}
function drawCandles(){const el=$('price-chart');if(!el)return;const {ctx,w,h}=canvasSetup(el);ctx.clearRect(0,0,w,h);const series=state?.candles[selectedSymbol]||[];if(!series.length)return;
  const bars=series.slice(-72), prices=bars.flatMap(c=>[c[2],c[3]]), lo=Math.min(...prices),hi=Math.max(...prices),spread=hi-lo||1;
  const left=12,right=w-67,top=13,bottom=h-29,plotHeight=bottom-top,plotWidth=right-left;
  const yy=p=>top+((hi-p)/spread)*plotHeight;
  ctx.font='10px -apple-system, Arial';ctx.lineWidth=1;ctx.textBaseline='middle';
  for(let j=0;j<=4;j++){let y=top+j*plotHeight/4;ctx.strokeStyle='#263448';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle='#7b90a3';ctx.fillText(num(hi-spread*j/4,2),right+8,y)}
  const space=plotWidth/bars.length,cw=Math.max(2,Math.min(10,space*.64));
  bars.forEach((c,i)=>{const [ts,o,high,low,close]=c,x=left+space*(i+.5),up=close>=o;ctx.strokeStyle=up?'#46e1ad':'#fe7786';ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(x,yy(high));ctx.lineTo(x,yy(low));ctx.stroke();const topBody=Math.min(yy(o),yy(close)),bodyH=Math.max(1.2,Math.abs(yy(o)-yy(close)));ctx.fillRect(x-cw/2,topBody,cw,bodyH)});
  ctx.textBaseline='alphabetic';ctx.fillStyle='#71889c';const steps=4;for(let i=0;i<=steps;i++){const index=Math.min(bars.length-1,Math.floor(i*(bars.length-1)/steps)),x=left+space*(index+.5),t=new Date(bars[index][0]);ctx.fillText(t.toLocaleDateString([],{month:'short',day:'numeric'}),Math.max(5,Math.min(x-17,right-40)),h-7)}
}
function drawEquity(){const el=$('equity-chart');if(!el)return;const {ctx,w,h}=canvasSetup(el);ctx.clearRect(0,0,w,h);const data=state?.equity_curve||[];if(!data.length)return;
  const vals=data.map(d=>d.equity),min=Math.min(...vals)*.999,max=Math.max(...vals)*1.001,spread=max-min||1,px=i=>17+i/(Math.max(1,vals.length-1))*(w-38),py=v=>13+(max-v)/spread*(h-32);
  ctx.strokeStyle='#29394d';ctx.lineWidth=1;for(let i=0;i<4;i++){const y=13+i*(h-32)/3;ctx.beginPath();ctx.moveTo(12,y);ctx.lineTo(w-12,y);ctx.stroke()}
  ctx.beginPath();vals.forEach((v,i)=>{i?ctx.lineTo(px(i),py(v)):ctx.moveTo(px(i),py(v))});ctx.strokeStyle='#46e1ad';ctx.lineWidth=2;ctx.stroke();ctx.lineTo(px(vals.length-1),h-13);ctx.lineTo(px(0),h-13);ctx.closePath();const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'rgba(70,225,173,.17)');grad.addColorStop(1,'rgba(70,225,173,0)');ctx.fillStyle=grad;ctx.fill();
  ctx.fillStyle='#8296a9';ctx.font='10px -apple-system, Arial';ctx.fillText(money(vals[vals.length-1]),Math.max(16,w-115),14)
}
async function refresh(){try{state=await request('/status');render()}catch(e){alertUser('Unable to load paper-trading state: '+e.message)}}
async function action(path,body){if(busy)return;busy=true;try{const result=await request(path,body);alertUser(result.message||'Operation complete',false);await refresh()}catch(e){alertUser(e.message)}finally{busy=false}}
$('refresh').onclick=async()=>{if(busy)return;busy=true;$('refresh').textContent='↻ Connecting…';try{await request('/preview',{});await refresh();alertUser('Exchange candles loaded; paper simulation updated',false)}catch(e){await refresh();alertUser('Market connection failed: '+e.message)}finally{busy=false;$('refresh').textContent='↻ Refresh markets'}};
$('toggle').onclick=()=>action(state?.running?'/stop':'/start',{});
$('settings-form').onsubmit=async e=>{e.preventDefault();const symbols=Array.from(document.querySelectorAll('.check-row input:checked')).map(c=>c.value);await action('/settings',{exchange:$('exchange').value,timeframe:$('timeframe').value,symbols,risk_percent:Number($('risk').value),max_daily_loss_pct:Number($('daily-limit').value),max_leverage:Number($('leverage').value)});};
function syncSettings(){if(!state)return;const s=state.settings;['exchange','timeframe'].forEach(k=>$(k).value=s[k]);$('risk').value=s.risk_percent;$('daily-limit').value=s.max_daily_loss_pct;$('leverage').value=s.max_leverage;document.querySelectorAll('.check-row input').forEach(c=>c.checked=s.symbols.includes(c.value));}
const dialog=$('backtest-dialog');$('close-modal').onclick=()=>dialog.close();
$('run-backtest').onclick=async()=>{dialog.showModal();$('backtest-results').innerHTML='<span class="caption-text">Loading historical market data and running an execution-aware simulation…</span>';try{const x=await request('/backtest',{symbol:selectedSymbol});const result=[['Net return',`${x.return_pct>0?'+':''}${x.return_pct}%`],['Total trades',String(x.trade_count)],['Win rate',`${x.win_rate_pct}%`],['Max drawdown',`${x.max_drawdown_pct}%`],['Final equity',money(x.final)],['Net P&L',money(x.pnl)]];$('backtest-results').innerHTML=`<div class="backtest-kpis">${result.map(([label,value])=>`<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div><p style="color:#879cb0;margin-top:16px">${esc(x.symbol)} · Based on ${x.equity_curve.length} plotted historical samples. Not a live result.</p>`}catch(e){$('backtest-results').textContent='Unable to run backtest: '+e.message}};
const oldRender=render;render=()=>{oldRender();if(state && !document.activeElement?.closest('#settings-form'))syncSettings()};
window.addEventListener('resize',()=>{if(state){drawCandles();drawEquity()}});
refresh();setInterval(()=>{if(!busy && !dialog.open)refresh()},6500);
