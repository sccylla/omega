'use strict';
const crypto=require('node:crypto');
const BASE='https://api.bybit.com';
const GETS=new Set(['/v5/account/wallet-balance','/v5/position/list','/v5/order/realtime','/v5/order/history','/v5/position/closed-pnl','/v5/market/tickers','/v5/market/instruments-info','/v5/market/kline']);
const POSTS=new Set(['/v5/position/set-leverage','/v5/order/create']);
function positive(x,name){const n=Number(x);if(!Number.isFinite(n)||n<=0)throw Error('Invalid broker '+name);return n}
function step(value,increment,up=false){const x=positive(increment,'step'),digits=(String(increment).split('.')[1]||'').length;return ((up?Math.ceil:Math.floor)(value/x+ (up?-1e-10:1e-10))*x).toFixed(Math.min(digits,12))}
class LiveBroker{
 constructor({env=process.env,fetcher=fetch}={}){this.env=env;this.fetcher=fetcher}
 ready(){return !!(this.env.BYBIT_LIVE_API_KEY&&this.env.BYBIT_LIVE_API_SECRET)}
 async request(method,path,data={},signed=true){
  if(!(method==='GET'?GETS:method==='POST'?POSTS:new Set()).has(path))throw Error('Broker operation is not allowed');
  if(signed&&!this.ready())throw Error('Bybit live credentials are not configured');
  const qs=method==='GET'?new URLSearchParams(data).toString():'',body=method==='POST'?JSON.stringify(data):undefined,time=String(Date.now()),headers={Accept:'application/json'};
  if(signed){const key=this.env.BYBIT_LIVE_API_KEY;Object.assign(headers,{'X-BAPI-API-KEY':key,'X-BAPI-TIMESTAMP':time,'X-BAPI-RECV-WINDOW':'5000','X-BAPI-SIGN-TYPE':'2','X-BAPI-SIGN':crypto.createHmac('sha256',this.env.BYBIT_LIVE_API_SECRET).update(time+key+'5000'+(qs||body||'')).digest('hex')})}
  if(body)headers['Content-Type']='application/json';
  let r,d;try{r=await this.fetcher(BASE+path+(qs?'?'+qs:''),{method,headers,body,redirect:'error',signal:AbortSignal.timeout(10000)});d=await r.json()}catch{throw Error('Broker request outcome unavailable; reconcile before retrying')}
  if(!r.ok||d.retCode!==0){if(path==='/v5/position/set-leverage'&&d.retCode===110043)return {};throw Error('Bybit rejected '+path+' (code '+String(d.retCode??r.status)+')')}
  if(!Number.isFinite(d.time)||Math.abs(Date.now()-d.time)>15000)throw Error('Broker response timestamp is stale');
  return d.result||{};
 }
 async snapshot(){
  const start=new Date();start.setUTCHours(0,0,0,0);
  const [wallet,pos,orders,closed]=await Promise.all([
   this.request('GET','/v5/account/wallet-balance',{accountType:'UNIFIED'}),
   this.request('GET','/v5/position/list',{category:'linear',settleCoin:'USDT',limit:'200'}),
   this.request('GET','/v5/order/realtime',{category:'linear',settleCoin:'USDT',openOnly:'0',limit:'50'}),
   this.request('GET','/v5/position/closed-pnl',{category:'linear',startTime:String(start.getTime()),limit:'100'})]);
  if(pos.nextPageCursor||orders.nextPageCursor||closed.nextPageCursor)throw Error('Incomplete account risk snapshot (pagination)');
  if(!Array.isArray(wallet.list)||!Array.isArray(pos.list)||!Array.isArray(orders.list)||!Array.isArray(closed.list))throw Error('Incomplete account risk snapshot');
  const w=wallet.list.find(x=>x.accountType==='UNIFIED');if(!w)throw Error('A unified Bybit account is required');
  const positions=pos.list.filter(p=>positiveOrZero(p.size)>0);
  if(positions.some(p=>Number(p.positionIdx)!==0))throw Error('Only one-way position mode is supported');
  const pending=orders.list.filter(o=>!['Filled','Cancelled','Rejected','Deactivated'].includes(o.orderStatus)&&o.reduceOnly!==true&&o.reduceOnly!=='true');
  const realized=closed.list.reduce((n,p)=>n+finite(p.closedPnl),0),unrealized=positions.reduce((n,p)=>n+Math.min(0,finite(p.unrealisedPnl)),0);
  return {equity:positive(w.totalEquity,'equity'),available:positiveOrZero(w.totalAvailableBalance),positions,pending,pnlToday:realized+unrealized};
 }
 async markets(){const r=await this.request('GET','/v5/market/tickers',{category:'linear'},false);if(!Array.isArray(r.list))throw Error('Missing ticker data');return r.list}
 async candles(symbol){const r=await this.request('GET','/v5/market/kline',{category:'linear',symbol,interval:'5',limit:'100'},false);return (r.list||[]).map(c=>c.slice(0,6).map(Number)).sort((a,b)=>a[0]-b[0])}
 async ticket(symbol,side,plan){
  if(!/^[A-Z0-9]{2,24}USDT$/.test(symbol)||!['Buy','Sell'].includes(side))throw Error('Invalid live market');
  const [instruments,tickers]=await Promise.all([this.request('GET','/v5/market/instruments-info',{category:'linear',symbol},false),this.request('GET','/v5/market/tickers',{category:'linear',symbol},false)]);
  const instrument=instruments.list?.[0],ticker=tickers.list?.[0];
  if(instrument?.symbol!==symbol||instrument?.status!=='Trading'||instrument?.quoteCoin!=='USDT'||instrument?.contractType!=='LinearPerpetual'||ticker?.symbol!==symbol)throw Error('Market is not an active USDT perpetual');
  const ask=positive(ticker.ask1Price,'ask'),bid=positive(ticker.bid1Price,'bid');
  if(ask<bid||(ask-bid)/((ask+bid)/2)*10000>8)throw Error('Spread widened; entry cancelled');
  const mark=positive(ticker.markPrice,'mark'),price=side==='Buy'?ask:bid;
  if(Math.abs(price/plan.price-1)>.003)throw Error('Price moved away from the candle setup');
  const lot=instrument.lotSizeFilter,pf=instrument.priceFilter;
  const qty=step(10/price,lot?.qtyStep),notional=Number(qty)*price;
  if(Number(qty)<positive(lot?.minOrderQty,'minimum quantity')||Number(qty)>positive(lot?.maxMktOrderQty,'maximum quantity')||notional<positive(lot?.minNotionalValue,'minimum notional')-1e-8||notional>10+1e-8)throw Error('Exchange minimum cannot fit the $10 budget; market skipped');
  const direction=side==='Buy'?1:-1;
  const stopLoss=step(price*(1-direction*plan.stopPct/100),pf?.tickSize,direction<0);
  const grossTarget=(plan.targetNet/10+.0016)/(1-.0006);
  const takeProfit=step(price*(1+direction*grossTarget),pf?.tickSize,direction>0);
  if(!(Number(stopLoss)>0&&Number(takeProfit)>0&&direction*(mark-Number(stopLoss))>0&&direction*(Number(takeProfit)-mark)>0))throw Error('Invalid protective order levels');
  return {symbol,side,qty,price,stopLoss,takeProfit,notional};
 }
 async leverage(symbol){return this.request('POST','/v5/position/set-leverage',{category:'linear',symbol,buyLeverage:'1',sellLeverage:'1'})}
 async enter(ticket,link){return this.request('POST','/v5/order/create',{category:'linear',symbol:ticket.symbol,side:ticket.side,qty:ticket.qty,orderType:'Market',positionIdx:0,orderLinkId:link,stopLoss:ticket.stopLoss,takeProfit:ticket.takeProfit,tpslMode:'Full',slTriggerBy:'MarkPrice',tpTriggerBy:'MarkPrice',slOrderType:'Market',tpOrderType:'Market',slippageToleranceType:'Percent',slippageTolerance:'0.05'})}
 async order(symbol,link){
  for(const route of ['/v5/order/realtime','/v5/order/history']){const r=await this.request('GET',route,{category:'linear',symbol,orderLinkId:link});if(r.list?.length)return r.list[0]}return null;
 }
 async close(position,link){
  if(!/^[A-Z0-9]{2,24}USDT$/.test(position.symbol)||!['Buy','Sell'].includes(position.side))throw Error('Invalid managed position');
  positive(position.size,'position size');
  return this.request('POST','/v5/order/create',{category:'linear',symbol:position.symbol,side:position.side==='Buy'?'Sell':'Buy',qty:String(position.size),orderType:'Market',positionIdx:0,reduceOnly:true,orderLinkId:link});
 }
}
function finite(x){if(x===undefined||x===null||x==='')throw Error('Missing broker risk value');const n=Number(x);if(!Number.isFinite(n))throw Error('Invalid broker risk value');return n}
function positiveOrZero(x){const n=finite(x);if(n<0)throw Error('Invalid broker balance/size');return n}
module.exports={LiveBroker,step};
