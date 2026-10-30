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
 const w=wallet.list?.[0]||{},active=(positions.list||[]).filter(x=>Number(x.size)>0);return {broker:'BYBIT',mode:'LIVE_READ_ONLY',currency:'USD equivalent',equity:Number(w.totalEquity||0),available:Number(w.totalAvailableBalance||0),openPositions:active.length,hasMorePositions:!!positions.nextPageCursor,positions:active.slice(0,20).map(p=>({symbol:p.symbol,side:p.side,size:p.size,stopLoss:p.stopLoss,takeProfit:p.takeProfit})),ordersEnabled:false};}
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

async function oandaOverview(){if(!oandaReady())throw new LiveError(503,'Configure OANDA live read-only credentials in Vercel');const id=process.env.OANDA_LIVE_ACCOUNT_ID;if(!/^[A-Za-z0-9-]{4,80}$/.test(id))throw new LiveError(503,'Invalid OANDA live account ID');let r;try{r=await fetch(oandaBase+'/v3/accounts/'+id+'/summary',{redirect:'error',headers:{Authorization:'Bearer '+process.env.OANDA_LIVE_TOKEN,Accept:'application/json'},signal:AbortSignal.timeout(10000)})}catch{throw new LiveError(502,'OANDA live account unavailable')}
 if(!r.ok)throw new LiveError(r.status===401?401:502,'OANDA live account connection rejected');const d=await r.json(),a=d.account||{};return {broker:'OANDA',mode:'LIVE_READ_ONLY',currency:a.currency||null,equity:Number(a.NAV||0),available:Number(a.marginAvailable||0),openPositions:Number(a.openPositionCount||0),unrealizedPL:Number(a.unrealizedPL||0),ordersEnabled:false};}
module.exports={bybitReady,oandaReady,bybitGet,bybitOverview,bybitClosedTrades,oandaOverview,LiveError,bybitBase,oandaBase};
