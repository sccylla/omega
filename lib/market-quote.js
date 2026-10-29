'use strict';
// Fresh public liquidation references only; no credentials or order submission.
const {normalizeSymbol}=require('./market-evidence');
const BASE='https://api.bybit.com/v5/market/tickers';
function numeric(value){return (typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))}
async function collectQuote(value,{fetcher=fetch,now=Date.now()}={}){
 const symbol=normalizeSymbol(value),started=Date.now();
 if(typeof fetcher!=='function'||!Number.isFinite(now))throw new TypeError('Invalid quote request');
 let response,payload;
 try{
  response=await fetcher(BASE+'?'+new URLSearchParams({category:'linear',symbol}),{method:'GET',redirect:'error',headers:{Accept:'application/json','User-Agent':'OmegaTraderQuote/11.0'},signal:AbortSignal.timeout(5000)});
  if(!response?.ok)throw Error('Upstream quote unavailable');
  payload=await response.json();
 }catch{throw Error('Public quote temporarily unavailable')}
 const checkedAt=now+Math.max(0,Date.now()-started);
 if(payload?.retCode!==0||!numeric(payload.time)||Number(payload.time)<=0||checkedAt-Number(payload.time)>10000||Number(payload.time)>checkedAt+1000)throw Error('Quote response is stale or invalid');
 const result=payload.result,rows=result?.list;
 if(result?.category!=='linear'||!Array.isArray(rows)||rows.length!==1||rows[0]?.symbol!==symbol)throw Error('Quote market does not match the request');
 const item=rows[0];
 if(!numeric(item.bid1Price)||!numeric(item.ask1Price))throw Error('Quote prices are invalid');
 const bid=Number(item.bid1Price),ask=Number(item.ask1Price);
 if(bid<=0||ask<=0||bid>ask)throw Error('Quote prices are invalid');
 const mid=bid+(ask-bid)/2;if(!Number.isFinite(mid))throw Error('Quote prices are invalid');
 return {symbol,bid,ask,mid,observedAt:Number(payload.time)};
}
module.exports={collectQuote};
