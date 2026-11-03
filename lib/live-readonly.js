'use strict';
const {summarizeClosedTrades}=require('../static/trade-review');
// Real-money account observation only. This module intentionally contains no trade/write HTTP methods.
const crypto=require('node:crypto');
const bybitBase='https://api.bybit.com',oandaBase='https://api-fxtrade.oanda.com';
const bybitReady=()=>!!(process.env.BYBIT_LIVE_API_KEY&&process.env.BYBIT_LIVE_API_SECRET);
const oandaReady=()=>!!(process.env.OANDA_LIVE_TOKEN&&process.env.OANDA_LIVE_ACCOUNT_ID);
class LiveError extends Error{constructor(status,message){super(message);this.status=status;}}
async function bybitGet(path,query){if(!bybitReady())throw new LiveError(503,'Configure Bybit live read-only API credentials in Vercel');
 if(!['/v5/account/wallet-balance','/v5/position/list','/v5/position/closed-pnl'].includes(path))throw new LiveError(403,'Live endpoint not permitted');
 const qs=new URLSearchParams(query).toString(),timestamp=String(Date.now()),window='5000',key=process.env.BYBIT_LIVE_API_KEY;
 const sign=crypto.createHmac('sha256',process.env.BYBIT_LIVE_API_SECRET).update(timestamp+key+window+qs).digest('hex');
 let r;try{r=await fetch(bybitBase+path+'?'+qs,{redirect:'error',headers:{'X-BAPI-API-KEY':key,'X-BAPI-TIMESTAMP':timestamp,'X-BAPI-RECV-WINDOW':window,'X-BAPI-SIGN':sign,'X-BAPI-SIGN-TYPE':'2'},signal:AbortSignal.timeout(10000)})}catch{throw new LiveError(502,'Bybit live account unavailable')}
 if(!r.ok)throw new LiveError(502,'Bybit live API error HTTP '+r.status);const d=await r.json();if(d.retCode!==0)throw new LiveError(502,'Bybit live account rejected read request');return d.result||{};
}
async function bybitOverview(){const [wallet,positions]=await Promise.all([bybitGet('/v5/account/wallet-balance',{accountType:'UNIFIED'}),bybitGet('/v5/position/list',{category:'linear',settleCoin:'USDT',limit:'100'})]);
 const w=wallet.list?.[0]||{},active=(positions.list||[]).filter(x=>Number(x.size)>0);return {broker:'BYBIT',mode:'LIVE_READ_ONLY',currency:'USD equivalent',equity:Number(w.totalEquity||0),available:Number(w.totalAvailableBalance||0),openPositions:active.length,hasMorePositions:!!positions.nextPageCursor,positions:active.slice(0,20).map(p=>({
 symbol:p.symbol,side:p.side,size:p.size,avgPrice:p.avgPrice,markPrice:p.markPrice,
 positionValue:p.positionValue,unrealisedPnl:p.unrealisedPnl,
 stopLoss:p.stopLoss,takeProfit:p.takeProfit
 })),fetchedAt:Date.now(),ordersEnabled:false};}
async function bybitClosedTrades(){
 const today=Date.now(),weekAgo=today-6*86400000;
 const list=await bybitGet('/v5/position/closed-pnl',{category:'linear',startTime:String(weekAgo),endTime:String(today),limit:'100'});
 if(!Array.isArray(list.list))throw new LiveError(502,'Closed-trade history unavailable or incomplete');
 // Do not follow unlimited pages or present partial results as account-wide.
 const truncated=!!list.nextPageCursor;
 const rows=list.list.map(x=>({
  symbol:x.symbol,side:x.side,net:Number(x.closedPnl),
  closedAt:Number(x.updatedTime||x.createdTime),
  reason:'Exchange-reported closed PnL'
 })).filter(x=>Number.isFinite(x.net)&&Number.isFinite(x.closedAt)&&/^[A-Z0-9]{2,24}USDT$/.test(x.symbol));
 const result=summarizeClosedTrades(rows,{label:'BYBIT',now:today});
 return {...result,periodDays:7,truncated,notice:truncated?'More than 100 closed records are available; this report covers only the newest page.':'Exchange-reported closed-position outcomes from the last seven days only. Broker-reported PnL may differ from fully fee-adjusted net cash result.'};
}

// Read-only, paginated history of closed USDT perpetual positions.
// Bybit limits a single closed-PnL query to seven days; adjacent seven-day
// windows can be selected without pretending a partial page is all-time P&L.
const HISTORY_WEEK_MS=7*86400000;
function historyWindow(weeksAgo=0,now=Date.now()){
 const week=Number(weeksAgo);
 if(!Number.isInteger(week)||week<0||week>25)throw new LiveError(400,'Choose a history window from 0 to 25 weeks ago');
 if(!Number.isFinite(now)||now<Date.UTC(2020,0,1))throw new LiveError(400,'Invalid history request time');
 const end=now-week*HISTORY_WEEK_MS,start=end-HISTORY_WEEK_MS+1;
 return {weeksAgo:week,start,end};
}
function normalizeBybitClosedRow(p){
 if(!p||typeof p!=='object'||!/^[A-Z0-9]{2,24}USDT$/.test(p.symbol)||
  !['Buy','Sell'].includes(p.side))return null;
 const closedAt=Number(p.updatedTime||p.createdTime),net=Number(p.closedPnl),
  entry=Number(p.avgEntryPrice),exit=Number(p.avgExitPrice),qty=Number(p.closedSize),
  entryValue=Number(p.cumEntryValue);
 if(!Number.isFinite(closedAt)||closedAt<Date.UTC(2020,0,1)||!Number.isFinite(net)||
  !Number.isFinite(entry)||entry<=0||!Number.isFinite(exit)||exit<=0||
  !Number.isFinite(qty)||qty<=0)return null;
 const fee=x=>x===undefined||x===null||x===''?null:Number.isFinite(Number(x))&&Number(x)>=0?Number(x):null;
 const openFee=fee(p.openFee),closeFee=fee(p.closeFee);
 // Bybit records the side of the closing order, opposite of the position.
 return {id:typeof p.orderId==='string'&&p.orderId.length<=140?p.orderId:
   p.symbol+':'+closedAt+':'+p.side+':'+qty,
  source:'Bybit',symbol:p.symbol,side:p.side==='Sell'?'LONG':'SHORT',
  entry,exit,quantity:qty,notional:Number.isFinite(entryValue)&&entryValue>0?entryValue:entry*qty,
  net,closedAt,openedAt:null,reason:'Bybit closed-position P&L',
  openFee,closeFee,fees:openFee!==null&&closeFee!==null?openFee+closeFee:null};
}
async function bybitHistory({weeksAgo=0,cursor='',now=Date.now(),fetchClosed=bybitGet}={}){
 const window=historyWindow(weeksAgo,now);
 if(typeof cursor!=='string'||cursor.length>1600||cursor&&!/^[\x21-\x7E]+$/.test(cursor))
  throw new LiveError(400,'Invalid history page cursor');
 const query={category:'linear',startTime:String(window.start),
  endTime:String(window.end),limit:'100'};
 if(cursor)query.cursor=cursor;
 const result=await fetchClosed('/v5/position/closed-pnl',query);
 if(!Array.isArray(result?.list)||result.list.length>100)
  throw new LiveError(502,'Incomplete Bybit closed-position history response');
 const nextCursor=result.nextPageCursor||'';
 if(typeof nextCursor!=='string'||nextCursor.length>1600)
  throw new LiveError(502,'Invalid Bybit pagination response');
 const records=result.list.map(normalizeBybitClosedRow).filter(Boolean)
  .filter(r=>r.closedAt>=window.start-1000&&r.closedAt<=window.end+1000)
  .sort((a,b)=>b.closedAt-a.closedAt);
 return {broker:'BYBIT',source:'BYBIT_CLOSED_PNL',windowStart:window.start,
  windowEnd:window.end,weeksAgo:window.weeksAgo,rows:records,
  rejectedRows:result.list.length-records.length,
  nextCursor,hasMore:!!nextCursor,fetchedAt:now,
  note:'Bybit closed-position P&L for this seven-day window, not all-time trade history. A close-side Sell is a LONG exit; a close-side Buy is a SHORT exit. Funding, commissions and final account cash movements may differ. Bot attribution is not available from this endpoint.'};
}

async function oandaOverview(){if(!oandaReady())throw new LiveError(503,'Configure OANDA live read-only credentials in Vercel');const id=process.env.OANDA_LIVE_ACCOUNT_ID;if(!/^[A-Za-z0-9-]{4,80}$/.test(id))throw new LiveError(503,'Invalid OANDA live account ID');let r;try{r=await fetch(oandaBase+'/v3/accounts/'+id+'/summary',{redirect:'error',headers:{Authorization:'Bearer '+process.env.OANDA_LIVE_TOKEN,Accept:'application/json'},signal:AbortSignal.timeout(10000)})}catch{throw new LiveError(502,'OANDA live account unavailable')}
 if(!r.ok)throw new LiveError(r.status===401?401:502,'OANDA live account connection rejected');const d=await r.json(),a=d.account||{};return {broker:'OANDA',mode:'LIVE_READ_ONLY',currency:a.currency||null,equity:Number(a.NAV||0),available:Number(a.marginAvailable||0),openPositions:Number(a.openPositionCount||0),unrealizedPL:Number(a.unrealizedPL||0),ordersEnabled:false};}
module.exports={bybitReady,oandaReady,bybitGet,bybitOverview,bybitClosedTrades,bybitHistory,historyWindow,normalizeBybitClosedRow,oandaOverview,LiveError,bybitBase,oandaBase};
