'use strict';
// OMEGA TRADER / Bybit demo ONLY. Never accept a configurable host or use real-money API domains.
const crypto = require('node:crypto');
const DEMO_BASE = 'https://api-demo.bybit.com';
const SYMBOLS = new Set(['BTCUSDT','ETHUSDT','SOLUSDT']);
const COOKIE = '__Host-omega_demo_session';
const LOGIN_MAX_AGE = 6*60*60;
const MAX_RISK_PCT = 0.5;
const MAX_LEVERAGE = 2;
const MAX_DAILY_LOSS_PCT = 2;
const MAX_POSITION_NOTIONAL_PCT = 20;
const MAX_POSITIONS = 2;
const RETRY_WINDOW = 5000;
const attempts=new Map(); // Best-effort local limiter; use Vercel deployment protection/WAF for distributed defense.
function safeCompare(a,b){const x=crypto.createHash('sha256').update(String(a)).digest(),y=crypto.createHash('sha256').update(String(b)).digest();return crypto.timingSafeEqual(x,y);}
function hmac(str,key=process.env.OMEGA_SESSION_SECRET||''){return crypto.createHmac('sha256',key).update(str).digest('hex');}
function signingReady(){return (process.env.OMEGA_SESSION_SECRET||'').length>=32;}
function passwordReady(){return (process.env.OMEGA_DASHBOARD_PASSWORD||'').length>=16 && signingReady();}
function keyReady(){return !!process.env.BYBIT_DEMO_API_KEY && !!process.env.BYBIT_DEMO_API_SECRET;}
function canTrade(){return process.env.BYBIT_DEMO_ORDERS_ENABLED==='true';}
function cookieValue(){const exp=Date.now()+LOGIN_MAX_AGE*1000;const data='demo.'+exp+'.'+crypto.randomUUID();return data+'.'+hmac(data);}
function getCookie(req){const header=req.headers.cookie||''; const pair=header.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));return pair?pair.slice(COOKIE.length+1):null;}
function isAuthed(req){if(!passwordReady())return false;const value=getCookie(req);if(!value)return false;const i=value.lastIndexOf('.');if(i<0)return false;const payload=value.slice(0,i),sig=value.slice(i+1),parts=payload.split('.');return parts[0]==='demo' && /^\d{13}$/.test(parts[1]) && Number(parts[1])>Date.now() && Number(parts[1])<Date.now()+LOGIN_MAX_AGE*1000 && safeCompare(sig,hmac(payload));}
function setCookie(res,value,maxAge){res.setHeader('Set-Cookie',`${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);}
function assertOrigin(req){const origin=req.headers.origin,host=req.headers.host; if(!host||!origin||new URL(origin).protocol!=='https:'||new URL(origin).host!==host||req.headers['x-omega-request']!=='1')throw new HttpError(403,'Cross-site requests are not allowed');}
function checkAttempts(ip){const key=String(ip||'unknown').slice(0,90);const now=Date.now();const hit=attempts.get(key)||{count:0,until:now+900000};if(now>hit.until){hit.count=0;hit.until=now+900000;}if(hit.count>=6)throw new HttpError(429,'Too many login attempts; retry later');return {key,hit};}
function failedAttempt(record){record.hit.count++;attempts.set(record.key,record.hit);if(attempts.size>1000)attempts.clear();}
function httpErrorString(error){return String(error?.message||error).replace(/(api[_-]?key|api[_-]?secret|authorization)\s*[:=]\s*\S+/ig,'[REDACTED]').slice(0,180);}
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
function positive(n,name){const v=Number(n);if(!Number.isFinite(v)||v<=0)throw new HttpError(409,'Invalid '+name+' returned by exchange');return v;}
async function api(method,path,data={}, {signed=true}={}){
  if(!/^\/v5\/[a-z-]+\/[a-z-]+$/.test(path))throw new HttpError(500,'Invalid Bybit API path');
  if(signed&&!keyReady())throw new HttpError(503,'Demo keys have not been configured in Vercel');
  const qs=method==='GET'?new URLSearchParams(data).toString():'';
  const body=method==='POST'?JSON.stringify(data):'';
  const time=String(Date.now());
  const key=process.env.BYBIT_DEMO_API_KEY||'', secret=process.env.BYBIT_DEMO_API_SECRET||'';
  const headers={'Accept':'application/json','Cache-Control':'no-store'};
  if(signed){const message=time+key+RETRY_WINDOW+(method==='GET'?qs:body);Object.assign(headers,{'X-BAPI-API-KEY':key,'X-BAPI-TIMESTAMP':time,'X-BAPI-RECV-WINDOW':String(RETRY_WINDOW),'X-BAPI-SIGN':crypto.createHmac('sha256',secret).update(message).digest('hex'),'X-BAPI-SIGN-TYPE':'2'});}
  if(method==='POST')headers['Content-Type']='application/json';
  let response,payload;
  try{response=await fetch(DEMO_BASE+path+(qs?'?'+qs:''),{method,headers,body:method==='POST'?body:undefined,redirect:'error',signal:AbortSignal.timeout(12000)});payload=await response.json();}catch(e){throw new HttpError(502,'Bybit demo connectivity error: '+httpErrorString(e));}
  if(!response.ok)throw new HttpError(502,'Bybit demo endpoint returned HTTP '+response.status);
  if(payload?.retCode!==0)throw new HttpError(502,'Bybit demo rejected the request ('+String(payload.retCode)+'): '+String(payload.retMsg||'unknown error').slice(0,110));
  return payload.result||{};
}
function validateChoice(input){
  const symbol=String(input?.symbol||'');const side=String(input?.side||'');
  if(!SYMBOLS.has(symbol)||!['Buy','Sell'].includes(side))throw new HttpError(400,'Unsupported demo market or direction');
  const riskPct=Number(input?.riskPct??0.25),stopPct=Number(input?.stopPct??1.5),leverage=Number(input?.leverage??1);
  if(!Number.isFinite(riskPct)||riskPct<0.1||riskPct>MAX_RISK_PCT)throw new HttpError(400,'Risk per trade must be 0.1%–0.5%');
  if(!Number.isFinite(stopPct)||stopPct<1||stopPct>3)throw new HttpError(400,'Stop distance must be 1%–3%');
  if(!Number.isInteger(leverage)||leverage<1||leverage>MAX_LEVERAGE)throw new HttpError(400,'Demo leverage must be 1x or 2x');
  return {symbol,side,riskPct,stopPct,leverage};
}
function fixedStep(value,step,method='floor'){
  const x=positive(step,'order step');const places=(String(step).split('.')[1]||'').length;
  const factor=10**Math.min(places,10);
  const valueUnits=Math[method](value*factor/(x*factor)+ (method==='floor'?1e-9:0));
  return (valueUnits*x).toFixed(places);
}
function prepareOrder(input,equity,available,existingPositionCount,instrument,mark,pnlToday,pendingCount=0){
  const c=validateChoice(input);
  const e=positive(equity,'equity'),a=positive(available,'available balance'),price=positive(mark,'market price');
  if(!Number.isFinite(pnlToday))throw new HttpError(409,'Cannot establish daily P&L; new orders blocked');
  if(pnlToday<=-e*MAX_DAILY_LOSS_PCT/100)throw new HttpError(409,'Demo daily loss limit reached');
  if(existingPositionCount>=MAX_POSITIONS)throw new HttpError(409,'Maximum of two open positions');
  if(pendingCount>0)throw new HttpError(409,'Pending entry orders found; new orders blocked');
  const distance=price*c.stopPct/100;
  const riskUsdt=e*c.riskPct/100;
  const byStopRisk=riskUsdt/distance;
  const byExposure=e*MAX_POSITION_NOTIONAL_PCT/100/price;
  const byMargin=a*c.leverage*0.8/price;
  const lot=instrument?.lotSizeFilter, pf=instrument?.priceFilter;
  if(!lot||!pf||instrument.status!=='Trading')throw new HttpError(409,'Market not actively tradeable');
  const maxMarketQty=positive(lot.maxMktOrderQty||lot.maxOrderQty,'maximum market order quantity');
  const qty=positive(fixedStep(Math.min(byStopRisk,byExposure,byMargin,maxMarketQty),lot.qtyStep),'size');
  if(qty<positive(lot.minOrderQty,'minimum order quantity'))throw new HttpError(409,'Trade size below exchange minimum under risk limits');
  const notional=qty*price;
  if(notional<Number(lot.minNotionalValue||0))throw new HttpError(409,'Trade notional below exchange minimum');
  const direction=c.side==='Buy'?1:-1;
  const stopLoss=fixedStep(price-direction*distance,pf.tickSize);
  const takeProfit=fixedStep(price+direction*distance*1.5,pf.tickSize);
  if(Number(stopLoss)<=0||Number(takeProfit)<=0||(direction===1 && !(Number(stopLoss)<price&&Number(takeProfit)>price))||(direction===-1 && !(Number(stopLoss)>price&&Number(takeProfit)<price)))throw new HttpError(409,'Stop or target failed safety validation');
  return {...c,price,qty:String(qty),stopLoss,takeProfit,riskUsdt:Number((qty*distance).toFixed(4)),notional:Number(notional.toFixed(2)),equity:e,available:a};
}
async function snapshot(symbol){
  const today=new Date();today.setUTCHours(0,0,0,0);
  const [balance,pos,orders,closed,ticker,instruments]=await Promise.all([
    api('GET','/v5/account/wallet-balance',{accountType:'UNIFIED'}),
    api('GET','/v5/position/list',{category:'linear',settleCoin:'USDT',limit:'100'}),
    api('GET','/v5/order/realtime',{category:'linear',settleCoin:'USDT',openOnly:'0',limit:'50'}),
    api('GET','/v5/position/closed-pnl',{category:'linear',startTime:String(today.getTime()),endTime:String(Date.now()),limit:'100'}),
    api('GET','/v5/market/tickers',{category:'linear',symbol}),
    api('GET','/v5/market/instruments-info',{category:'linear',symbol})]);
  if(pos.nextPageCursor||orders.nextPageCursor||closed.nextPageCursor)throw new HttpError(409,'Risk checks incomplete because exchange results are paginated');
  const wallet=balance.list?.find(x=>x.accountType==='UNIFIED')||balance.list?.[0];
  if(!wallet)throw new HttpError(409,'No unified demo balance found');
  const equity=positive(wallet.totalEquity,'account equity');
  const available=positive(wallet.totalAvailableBalance,'available margin');
  const positions=(pos.list||[]).filter(p=>Number(p.size)>0);
  const pending=(orders.list||[]).filter(o=>o.reduceOnly!==true && o.reduceOnly!=='true' && ['New','PartiallyFilled','Untriggered'].includes(o.orderStatus));
  const unrealized=positions.reduce((sum,p)=>sum+Number(p.unrealisedPnl||0),0);
  const realized=(closed.list||[]).reduce((sum,p)=>sum+Number(p.closedPnl||0),0);
  if(!Number.isFinite(realized)||!Number.isFinite(unrealized))throw new HttpError(409,'Could not verify demo P&L');
  const pnlToday=realized+Math.min(0,unrealized);
  return {equity,available,positions,pending,pnlToday,mark:positive(ticker.list?.[0]?.markPrice,'mark price'),instrument:instruments.list?.[0],symbol};
}
async function createPreview(body){
  if(!passwordReady())throw new HttpError(503,'Dashboard authentication is not configured');
  const c=validateChoice(body),s=await snapshot(c.symbol);
  if(s.positions.some(p=>p.symbol===c.symbol))throw new HttpError(409,'Position already exists for this symbol');
  const p=prepareOrder(c,s.equity,s.available,s.positions.length,s.instrument,s.mark,s.pnlToday,s.pending.length);
  const tokenBody={choice:c,quantity:p.qty,marketPrice:p.price,iat:Date.now(),id:crypto.randomUUID()};
  const encoded=Buffer.from(JSON.stringify(tokenBody)).toString('base64url');
  return {...p,expiresAt:tokenBody.iat+45000,previewToken:encoded+'.'+hmac(encoded),mode:'BYBIT_DEMO_ONLY',ordersEnabled:canTrade()};
}
function verifyPreview(token){
  if(typeof token!=='string'||token.length>3000)throw new HttpError(400,'Missing demo preview token');
  const index=token.lastIndexOf('.');if(index<0)throw new HttpError(400,'Invalid preview token');
  const payload=token.slice(0,index),signature=token.slice(index+1);
  if(!safeCompare(signature,hmac(payload)))throw new HttpError(403,'Invalid preview signature');
  let item;try{item=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));}catch{throw new HttpError(400,'Malformed preview token');}
  if(!item||!Number.isFinite(item.iat)||Date.now()-item.iat>45000||item.iat>Date.now()+1000||!crypto.validateUUID?.(item.id) && !/^[0-9a-f-]{36}$/i.test(item.id||''))throw new HttpError(409,'Preview expired; refresh before trading');
  validateChoice(item.choice);return item;
}
async function executePreview(body){
  if(!canTrade())throw new HttpError(403,'Demo order placement is disabled by server kill switch');
  if(body?.confirm!=='PLACE DEMO ORDER')throw new HttpError(400,'Explicit demo order confirmation required');
  const q=verifyPreview(body.previewToken),c=q.choice;
  const s=await snapshot(c.symbol);
  if(s.positions.some(p=>p.symbol===c.symbol))throw new HttpError(409,'Position already exists');
  if(Math.abs(s.mark/q.marketPrice-1)>0.003)throw new HttpError(409,'Mark price changed; refresh trade preview');
  const p=prepareOrder(c,s.equity,s.available,s.positions.length,s.instrument,s.mark,s.pnlToday,s.pending.length);
  const qty=fixedStep(Math.min(Number(p.qty),Number(q.quantity)),s.instrument.lotSizeFilter.qtyStep);
  if(Number(qty)<Number(s.instrument.lotSizeFilter.minOrderQty))throw new HttpError(409,'Quantity below allowed minimum');
  const lev=String(c.leverage);
  try{await api('POST','/v5/position/set-leverage',{category:'linear',symbol:c.symbol,buyLeverage:lev,sellLeverage:lev});}
  catch(e){if(!/110043/.test(e.message))throw e;} // Same leverage is already configured.
  const link='omd'+q.id.replace(/-/g,'').slice(0,30);
  const order=await api('POST','/v5/order/create',{category:'linear',symbol:c.symbol,side:c.side,orderType:'Market',qty,positionIdx:0,takeProfit:p.takeProfit,stopLoss:p.stopLoss,tpslMode:'Full',tpTriggerBy:'MarkPrice',slTriggerBy:'MarkPrice',tpOrderType:'Market',slOrderType:'Market',orderLinkId:link});
  return {mode:'BYBIT_DEMO_ONLY',orderId:order.orderId,orderLinkId:link,message:'Demo order accepted by Bybit (asynchronous). Verify it filled and protective orders are active in Bybit.'};
}
async function accountOverview(){
  if(!keyReady())throw new HttpError(503,'Demo keys are not configured');
  const [balance,pos,orders]=await Promise.all([api('GET','/v5/account/wallet-balance',{accountType:'UNIFIED'}),api('GET','/v5/position/list',{category:'linear',settleCoin:'USDT',limit:'100'}),api('GET','/v5/order/realtime',{category:'linear',settleCoin:'USDT',openOnly:'0',limit:'50'})]);
  const wallet=balance.list?.[0]||{};
  return {mode:'BYBIT_DEMO_ONLY',connected:true,ordersEnabled:canTrade(),equity:wallet.totalEquity||'0',available:wallet.totalAvailableBalance||'0',positions:(pos.list||[]).filter(p=>Number(p.size)>0).map(p=>({symbol:p.symbol,side:p.side,size:p.size,entryPrice:p.avgPrice,markPrice:p.markPrice,unrealisedPnl:p.unrealisedPnl,stopLoss:p.stopLoss,takeProfit:p.takeProfit})),orders:(orders.list||[]).filter(p=>['New','PartiallyFilled','Untriggered'].includes(p.orderStatus)).slice(0,20).map(o=>({symbol:o.symbol,orderId:o.orderId,orderStatus:o.orderStatus,side:o.side,qty:o.qty,reduceOnly:o.reduceOnly})),updated:Date.now()};
}
async function cancelDemoOrders(body){
  if(body?.confirm!=='CANCEL DEMO ORDERS')throw new HttpError(400,'Explicit cancellation confirmation required');
  if(!keyReady())throw new HttpError(503,'Demo credentials are not configured');
  const outcomes=[];
  for(const symbol of SYMBOLS){const result=await api('POST','/v5/order/cancel-all',{category:'linear',symbol});outcomes.push({symbol,count:result.list?.length??0});}
  return {mode:'BYBIT_DEMO_ONLY',message:'Sent cancellation requests for demo orders; existing positions are NOT closed',outcomes};
}
module.exports={DEMO_BASE,COOKIE,HttpError,passwordReady,keyReady,canTrade,cookieValue,getCookie,isAuthed,setCookie,assertOrigin,checkAttempts,failedAttempt,safeCompare,api,validateChoice,prepareOrder,fixedStep,snapshot,createPreview,verifyPreview,executePreview,accountOverview,cancelDemoOrders};
