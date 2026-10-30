'use strict';
// Telegram is only a secure remote control and notification channel for a
// persistent, public-market-data paper scalper. This module cannot place orders.
const {TelegramDemoEngine}=require('./telegram-demo-engine');
const {TelegramLive}=require('./telegram-live');
const SOURCE='wss://stream.bybit.com/v5/public/linear';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const money=v=>Number.isFinite(v)?(v<0?'-$':'$')+Math.abs(v).toFixed(2):'—';
const keyboard={inline_keyboard:[
 [{text:'▶ Run demo',callback_data:'run'},{text:'■ Pause demo',callback_data:'pause'}],
 [{text:'📊 Status',callback_data:'status'},{text:'💰 Balance',callback_data:'balance'}],
 [{text:'📋 Trades',callback_data:'trades'},{text:'🩺 Feed health',callback_data:'health'}],
 [{text:'🔐 Real connection',callback_data:'realstatus'},{text:'💵 Real balance',callback_data:'realbalance'}]
]};
class PublicBybitDemoFeed{
 constructor({engine,onEvent=()=>{},WebSocketCtor=globalThis.WebSocket,clock=()=>Date.now(),logger=console}={}){
  if(!engine)throw Error('Paper engine required');
  this.engine=engine;this.onEvent=onEvent;this.WebSocketCtor=WebSocketCtor;this.clock=clock;this.logger=logger;
  this.socket=null;this.timer=null;this.retryTimer=null;this.active=false;this.connected=false;
  this.lastConnect=0;this.attempt=0;this.lastHeartbeat=0;
 }
 start(){
  if(this.active)return;
  if(!this.WebSocketCtor)throw Error('Node.js WebSocket support unavailable; Node 24+ required');
  this.active=true;
  this.timer=setInterval(()=>this.cycle(),1000);
  this.connect();
 }
 cycle(){
  if(!this.active)return;
  const now=this.clock();
  if(this.connected&&now-this.lastConnect>16000&&
   (!this.engine.lastFeedAt||now-this.engine.lastFeedAt>16000)){
   this.reconnect('Bybit public feed has no valid recent data');return;
  }
  if(!this.connected&&now-this.lastConnect>14000&&!this.retryTimer){
   this.reconnect('Bybit WebSocket handshake timed out');return;
  }
  if(this.connected&&now-this.lastHeartbeat>=20000){
   this.lastHeartbeat=now;
   try{this.socket.send(JSON.stringify({op:'ping'}))}catch{this.reconnect('Bybit ping failed');return}
  }
  try{
   const events=this.engine.tick(this.connected,now);
   for(const event of events)this.onEvent(event);
   for(const event of this.engine.takeEvents()){
    // Engine records all events for durable reporting. Do not alert twice.
    if(!events.includes(event))this.onEvent(event);
   }
   if(!this.engine.state.running)this.stop();
  }catch(e){
   this.engine.pause('Scanner processing error');
   this.stop();this.onEvent({type:'ERROR',message:String(e.message||e).slice(0,200)});
  }
 }
 connect(){
  if(!this.active)return;
  this.lastConnect=this.clock();
  let ws;
  try{ws=new this.WebSocketCtor(SOURCE)}catch{this.schedule('Cannot establish Bybit WebSocket');return}
  this.socket=ws;
  ws.onopen=()=>{
   if(!this.active||ws!==this.socket)return;
   this.connected=true;this.attempt=0;this.lastHeartbeat=this.clock();
   const topics=this.engine.state.symbols.flatMap(s=>['orderbook.50.'+s,'publicTrade.'+s]);
   for(let i=0;i<topics.length;i+=10){
    try{ws.send(JSON.stringify({op:'subscribe',args:topics.slice(i,i+10)}))}
    catch{this.reconnect('Bybit subscription failed');return}
   }
  };
  ws.onmessage=event=>{
   if(!this.active||ws!==this.socket||!this.connected||typeof event.data!=='string'||event.data.length>900000)return;
   let data;try{data=JSON.parse(event.data)}catch{return}
   if(data.success===false){this.reconnect('Bybit subscription rejected');return}
   try{this.engine.ingest(data,this.clock())}catch{this.reconnect('Invalid Bybit data stream')}
  };
  ws.onerror=()=>{if(this.active&&ws===this.socket)this.reconnect('Bybit socket error')};
  ws.onclose=()=>{if(this.active&&ws===this.socket)this.reconnect('Bybit socket closed')};
 }
 reconnect(reason){
  if(!this.active||this.retryTimer)return;
  this.connected=false;
  if(this.socket){const ws=this.socket;this.socket=null;ws.onclose=null;ws.onerror=null;ws.onmessage=null;ws.onopen=null;try{ws.close()}catch{}}
  this.engine.disconnect(reason);
  this.schedule(reason);
 }
 schedule(reason){
  if(!this.active||this.retryTimer)return;
  this.connected=false;this.attempt++;
  const delay=Math.min(30000,2000*Math.pow(2,Math.min(this.attempt-1,4)));
  if(this.attempt===1||this.attempt%5===0)this.onEvent({type:'FEED',message:reason+'. Auto-retry in '+Math.round(delay/1000)+'s; demo positions cannot be verified offline.'});
  this.retryTimer=setTimeout(()=>{this.retryTimer=null;if(this.active)this.connect()},delay);
 }
 stop(){
  this.active=false;this.connected=false;
  if(this.timer){clearInterval(this.timer);this.timer=null}
  if(this.retryTimer){clearTimeout(this.retryTimer);this.retryTimer=null}
  if(this.socket){const ws=this.socket;this.socket=null;ws.onclose=null;ws.onerror=null;ws.onmessage=null;ws.onopen=null;try{ws.close()}catch{}}
 }
}

class OmegaTelegramBot{
 constructor({directory,env=process.env,fetchImpl=globalThis.fetch,WebSocketCtor=globalThis.WebSocket,
  clock=()=>Date.now(),logger=console,paper,live}={}){
  if(!directory)throw Error('Telegram bot requires persistent state directory');
  this.env=env;this.fetch=fetchImpl;this.clock=clock;this.logger=logger;
  this.token=String(env.OMEGA_TELEGRAM_BOT_TOKEN||'');
  this.owner=String(env.OMEGA_TELEGRAM_OWNER_CHAT_ID||'').trim();
  if(this.token&&!/^\d{5,14}:[A-Za-z0-9_-]{25,}$/.test(this.token))throw Error('Telegram bot token format invalid');
  if(this.owner&&!/^\d{4,18}$/.test(this.owner))throw Error('Telegram owner chat ID must be a positive numeric ID');
  this.paper=paper||new TelegramDemoEngine({directory,now:clock});
  this.live=live||new TelegramLive({directory,env,now:clock});
  this.feed=new PublicBybitDemoFeed({engine:this.paper,onEvent:event=>{this.event(event).catch(()=>{})},WebSocketCtor,clock,logger});
  this.active=false;
  this.polling=null;
  this.abort=null;
 }
 async api(method,args={},timeoutMs=30000){
  if(!this.token)throw Error('Telegram token not configured');
  const url='https://api.telegram.org/bot'+this.token+'/'+method;
  // Never log or return a URL containing the secret.
  const result=await this.fetch(url,{method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify(args),signal:AbortSignal.timeout(timeoutMs)});
  if(!result.ok)throw Error('Telegram '+method+' HTTP '+result.status);
  const value=await result.json();
  if(!value||value.ok!==true)throw Error('Telegram '+method+' rejected request');
  return value.result;
 }
 async send(text,menu=false,chatId=this.owner){
  if(!chatId||!this.token)return;
  return this.api('sendMessage',{chat_id:chatId,text:String(text).slice(0,3900),
   ...(menu?{reply_markup:keyboard}:{})});
 }
 async event(event){
  if(!this.owner)return;
  const p=event.trade;
  let msg;
  if(event.type==='OPEN')msg='🟢 DEMO opened '+event.symbol+' · $15 simulated position. No real order.';
  else if(event.type==='CLOSED')msg='✅ DEMO closed '+p.side+' '+p.symbol+' · '+money(p.net)+' estimated net ('+
   money(p.fees+p.slippage)+' modeled costs) · '+p.reason+'. Not a live exchange fill.';
  else if(event.type==='INCOMPLETE')msg='⚠️ DEMO trade incomplete. '+(event.message||'Price feed interrupted')+'. No profit booked.';
  else if(event.type==='RISK_PAUSE')msg='⛔ DEMO paused: '+event.message;
  else if(event.type==='ERROR')msg='⛔ DEMO stopped: '+event.message;
  else if(event.type==='FEED')msg='📡 '+event.message;
  if(msg)await this.send(msg);
 }
 statusText(){
  const {stats,health}=this.paper.status(this.clock());
  return 'OMEGA / DEMO ONLY\n'+
   'Scanner: '+(health.running?'RUNNING':'PAUSED')+'\n'+
   'Feed: '+health.ready+'/'+health.all+' pairs ready\n'+
   'Virtual capital: '+money(stats.wallet)+'\n'+
   'Estimated equity: '+(stats.estimatedEquity===null?'unpriced position':money(stats.estimatedEquity))+'\n'+
   'Position: '+(stats.open?stats.open.side+' '+stats.open.symbol:'none')+'\n'+
   'Realized net P&L: '+money(stats.totalNetUsd)+'\n'+
   'Closed: '+stats.closedTrades+' · wins: '+(stats.winRatePct===null?'—':stats.winRatePct+'%')+'\n'+
   'Trade: $15 simulated · goal $0.05 net · stop $0.08 modeled\n'+
   'Daily limit: $1; no real trading enabled.';
 }
 balanceText(){
  const {stats}=this.paper.status(this.clock());
  return 'VIRTUAL $88 PRACTICE WALLET\nBalance: '+money(stats.wallet)+
   '\nRealized net since start: '+money(stats.totalNetUsd)+
   '\nToday net: '+money(stats.todayNetUsd)+
   '\nMaximum daily loss: '+money(stats.dailyMaxLossUsd)+
   '\nOpen simulated position: '+(stats.open?stats.open.side+' '+stats.open.symbol:'none')+
   '\nThis is NOT your Bybit account balance.';
 }
 tradesText(){
  const {last}=this.paper.status(this.clock());
  return !last.length?'No completed virtual trades yet.':
   'LAST '+last.length+' VIRTUAL CLOSES\n'+last.slice().reverse().map(t=>t.symbol+' '+t.side+' · '+money(t.net)+' net · '+t.reason).join('\n');
 }
 healthText(){
  const h=this.paper.health(this.clock());
  return 'BYBIT PUBLIC FEED (DEMO)\n'+
   'Scanner: '+(h.running?'RUNNING':'PAUSED')+
   '\nFeed age: '+(h.connectedAgeSeconds===null?'never received':h.connectedAgeSeconds+'s')+
   '\nReady symbols: '+h.ready+'/'+h.all+'\nQualified now: '+h.candidates+
   '\nBlocker: '+h.block+'\n'+
   h.rows.slice(0,8).map(r=>r.symbol+': '+r.reason).join('\n');
 }
 async command(name,args=''){
  switch(name){
   case 'realstatus':{
    const s=this.live.status();
    return {text:'BYBIT REAL ACCOUNT CONNECTION\n'+
     'Credentials: '+(s.configured?'CONFIGURED':'NOT CONFIGURED')+'\n'+
     'Order submission: '+(s.ordersEnabled?'ENABLED BY SERVER OWNER':'DISABLED')+'\n'+
     'Pending order reconciliation: '+(s.pendingIntent?'REQUIRED':'none')+'\n'+
     'Proposed trade: $15, max $16; no leverage above 1x.\n'+
     'Every real trade requires /realtrade SIDE PAIR then /confirmreal CODE. No auto real trading.',menu:true};
   }
   case 'realbalance':{
    const a=await this.live.balance();
    return {text:'BYBIT LIVE ACCOUNT (read only)\n'+
     'Equity: '+money(a.equity)+'\nAvailable: '+money(a.available)+
     '\nToday reported P&L: '+money(a.pnlToday)+
     '\nOpen positions: '+a.positions.length+'\nPending entries: '+a.pending.length,menu:true};
   }
   case 'realpositions':{
    const rows=await this.live.viewPositions();
    return {text:rows.length?'REAL OPEN POSITIONS\n'+rows.map(p=>p.symbol+' '+p.side+
     ' qty '+p.size+' entry '+p.entry+' TP '+(p.takeProfit||'none')+' SL '+(p.stopLoss||'none')).join('\n'):
     'Bybit reports no open linear futures positions.',menu:true};
   }
   case 'realtrade':{
    const [direction,symbol,...other]=String(args||'').toUpperCase().split(/\s+/);
    if(other.length||!['BUY','SELL'].includes(direction)||!symbol)
     throw Error('Use /realtrade BUY XRPUSDT or /realtrade SELL XRPUSDT. This is NOT a demo.');
    const p=await this.live.preview(symbol,direction==='BUY'?'Buy':'Sell');
    return {text:'⚠️ REAL MONEY TRADE PREVIEW\n'+p.ticket.side+' '+p.ticket.symbol+
     '\nEstimated notional: '+money(p.ticket.notional)+
     '\nApprox entry: '+p.ticket.price+
     '\nQuantity: '+p.ticket.qty+
     '\nExchange take-profit trigger: '+p.ticket.takeProfit+
     '\nExchange stop-loss trigger: '+p.ticket.stopLoss+
     '\nModeled maximum stop+costs: '+money(p.risk)+
     '\nExpected net goal after estimated costs: '+money(p.ticket.estimatedTakeProfitNetUsd)+
     '\n⚠️ Exchange market orders can slip and lose more than estimated.\n'+
     'To authorize ONE funded order within 60 seconds, send exactly:\n/confirmreal '+p.code+
     '\nDo not continue if any number is wrong.'};
   }
   case 'confirmreal':{
    const r=await this.live.execute(String(args||'').trim().toUpperCase());
    return {text:'REAL ORDER REQUEST ACKNOWLEDGED (not necessarily filled)\n'+
     r.symbol+' · link '+r.link+'\n'+r.note};
   }
   case 'realorders':{
    const r=await this.live.reconcile();
    return {text:'REAL ORDER CHECK\n'+JSON.stringify(r,null,2)};
   }
   case 'start':case 'menu':case 'help':
    return {text:'OMEGA TELEGRAM · DEMO IS VIRTUAL TRADING ONLY\n'+
     'Demo: /run, /pause, /status, /balance, /trades, /health, /pairs.\n'+
     'Real account: /realstatus, /realbalance, /realpositions, /realtrade BUY XRPUSDT, /confirmreal CODE, /realorders.\n'+
     'Real orders require a private Bybit API connection, server approval and an individual Telegram confirmation.\n'+
     'No automatic real trading is active or promised profitable.',menu:true};
   case 'run':
    {const text=this.paper.start();if(this.paper.state.running&&!this.feed.active)this.feed.start();return {text,menu:true}}
   case 'pause':
    {const text=this.paper.pause();this.feed.stop();return {text,menu:true}}
   case 'status':return {text:this.statusText(),menu:true};
   case 'balance':return {text:this.balanceText(),menu:true};
   case 'trades':return {text:this.tradesText(),menu:true};
   case 'health':return {text:this.healthText(),menu:true};
   case 'pairs':
    if(!args)return {text:'Current DEMO pairs: '+this.paper.state.symbols.join(', ')+
     '\nTo change (when paused): /pairs BTCUSDT,ETHUSDT,SOLUSDT'};
    return {text:this.paper.setPairs(args)};
   default:return {text:'Unknown command. Use /help.'};
  }
 }
 async handle(update){
  const callback=update.callback_query;
  const msg=update.message||callback?.message;
  const chat=msg?.chat;
  if(!chat||chat.type!=='private')return;
  const id=String(chat.id),sender=String(callback?.from?.id||msg?.from?.id||'');
  const raw=String(callback?.data||msg?.text||'').trim();
  const head=raw.split(/\s+/)[0].replace(/^\//,'').split('@')[0].toLowerCase();
  if(callback?.id)await this.api('answerCallbackQuery',{callback_query_id:callback.id}).catch(()=>{});
  if(head==='id'&&id===sender){await this.send('Your private Telegram chat ID: '+id+
   '\nConfigure OMEGA_TELEGRAM_OWNER_CHAT_ID with this number on your private worker.',false,id);return}
  if(!this.owner||id!==this.owner||sender!==this.owner)return;
  try{
   const reply=await this.command(head,raw.slice(raw.indexOf(' ')+1).trim()===raw?
    '':raw.slice(raw.indexOf(' ')+1).trim());
   await this.send(reply.text,Boolean(reply.menu),id);
  }catch(err){await this.send('Request rejected: '+String(err.message||err).slice(0,180),false,id)}
 }
 async pollOnce(){
  const updates=await this.api('getUpdates',{offset:this.paper.state.telegramOffset,limit:25,timeout:20,
   allowed_updates:['message','callback_query']},26000);
  if(!Array.isArray(updates))throw Error('Invalid Telegram update list');
  for(const u of updates){
   if(!Number.isSafeInteger(u.update_id))continue;
   if(u.update_id<this.paper.state.telegramOffset)continue;
   // Persist first so a restarted process cannot replay /run or /pause.
   this.paper.setOffset(u.update_id+1);
   await this.handle(u);
  }
 }
 start(){
  if(this.active)return;
  if(!this.token)return false;
  this.active=true;
  // An intentionally running DEMO may resume after restart, but any former
  // open virtual position was already marked INCOMPLETE on restore.
  if(this.owner&&this.paper.state.running)this.feed.start();
  this.polling=this.pollLoop();
  return true;
 }
 async pollLoop(){
  while(this.active){
   try{await this.pollOnce()}
   catch(err){
    if(this.active){
     // Never include request URLs (which contain bot tokens) in logs.
     this.logger.warn('Telegram polling unavailable: '+String(err.name||'request failure'));
     await sleep(3000);
    }
   }
  }
 }
 stop(){this.active=false;this.feed.stop()}
}
module.exports={OmegaTelegramBot,PublicBybitDemoFeed,keyboard};
