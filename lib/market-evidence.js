'use strict';
// Public Bybit evidence only. No credentials, signed requests or order endpoints.
const BASE='https://api.bybit.com';
const CACHE_MS=5000,MAX_CACHE=32,MAX_INFLIGHT=16,MAX_CONCURRENT=4,TIMEOUT_MS=6000;
const cache=new Map(),inflight=new Map(),fetcherIds=new WeakMap();
let nextFetcherId=0,activeRequests=0;
const waiting=[];

function normalizeSymbol(value){
 if(typeof value!=='string'||!value.length||value!==value.trim())throw new TypeError('Unsupported market symbol');
 const symbol=value.endsWith('USDT')?value:value+'USDT';
 if(!/^[A-Z0-9]{2,24}USDT$/.test(symbol))throw new TypeError('Unsupported market symbol');
 return symbol;
}
function numeric(value){return (typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))}
function fail(code){const error=new Error(code);error.code=code;throw error}
function ensureSymbol(result,symbol,{book=false}={}){
 if(!result||typeof result!=='object'||(book?result.s:result.symbol)!==symbol)fail('SYMBOL_MISMATCH');
 if(result.category!==undefined&&result.category!=='linear')fail('CATEGORY_MISMATCH');
}
function list(result){if(!Array.isArray(result?.list)||!result.list.length)fail('MISSING_DATA');return result.list}
function candles(result,symbol,period){
 ensureSymbol(result,symbol);
 const rows=list(result).map(row=>{
  if(!Array.isArray(row)||row.length<6||!row.slice(0,6).every(numeric))fail('MALFORMED_CANDLES');
  const r=row.slice(0,6).map(Number);
  if(!Number.isSafeInteger(r[0])||r[0]<=0||r.slice(1,5).some(x=>x<=0)||r[5]<0||r[2]<Math.max(r[1],r[4])||r[3]>Math.min(r[1],r[4]))fail('MALFORMED_CANDLES');
  return r;
 }).sort((a,b)=>a[0]-b[0]);
 if(rows.some((row,i)=>row[0]%period!==0||i>0&&row[0]-rows[i-1][0]!==period))fail('INCOMPLETE_CANDLES');
 return rows;
}
function single(result,symbol){
 if(result?.category!==undefined&&result.category!=='linear')fail('CATEGORY_MISMATCH');
 const rows=list(result);if(rows.length!==1||rows[0]?.symbol!==symbol)fail('SYMBOL_MISMATCH');
 return rows[0];
}
function book(result,symbol){
 ensureSymbol(result,symbol,{book:true});
 if(!numeric(result.ts)||Number(result.ts)<=0||!Array.isArray(result.b)||!Array.isArray(result.a)||!result.b.length||!result.a.length)fail('MALFORMED_BOOK');
 const levels=side=>side.map(level=>{
  if(!Array.isArray(level)||level.length<2||!level.slice(0,2).every(numeric)||Number(level[0])<=0||Number(level[1])<=0)fail('MALFORMED_BOOK');
  return level.slice(0,2); // Preserve exchange decimal precision; decision code normalizes it.
 });
 const bids=levels(result.b),asks=levels(result.a);
 if(bids.some((x,i)=>i&&Number(x[0])>=Number(bids[i-1][0]))||asks.some((x,i)=>i&&Number(x[0])<=Number(asks[i-1][0]))||Number(bids[0][0])>=Number(asks[0][0]))fail('MALFORMED_BOOK');
 return {...result,b:bids,a:asks,ts:Number(result.ts)};
}
function interest(result,symbol){
 ensureSymbol(result,symbol);
 return list(result).map(row=>{
  if(!numeric(row.openInterest)||Number(row.openInterest)<=0||!numeric(row.timestamp)||Number(row.timestamp)<=0)fail('MALFORMED_OPEN_INTEREST');
  return {...row};
 });
}
function funding(result,symbol){
 if(result?.category!==undefined&&result.category!=='linear')fail('CATEGORY_MISMATCH');
 return list(result).map(row=>{
  if(row.symbol!==symbol)fail('SYMBOL_MISMATCH');
  if(!numeric(row.fundingRate)||!numeric(row.fundingRateTimestamp)||Number(row.fundingRateTimestamp)<=0)fail('MALFORMED_FUNDING');
  return {...row};
 });
}
function emptyEvidence(symbol,now){return {symbol,observedAt:now,five:null,quarter:null,hour:null,fourHour:null,benchmarkFive:null,book:null,ticker:null,openInterest:null,fundingHistory:null,instrument:null,sourceTimes:{},errors:[]}}
function schedule(fn){
 return new Promise((resolve,reject)=>{waiting.push({fn,resolve,reject});drain()});
}
function drain(){
 while(activeRequests<MAX_CONCURRENT&&waiting.length){
  const task=waiting.shift();activeRequests++;
  Promise.resolve().then(task.fn).then(task.resolve,task.reject).finally(()=>{activeRequests--;drain()});
 }
}
async function request(path,params,fetcher,now,collectionSignal){
 return schedule(async()=>{
  if(collectionSignal.aborted)fail('COLLECTION_DEADLINE');
  let response,payload;
  try{
   response=await fetcher(BASE+path+'?'+new URLSearchParams(params),{method:'GET',redirect:'error',headers:{Accept:'application/json','User-Agent':'OmegaTraderEvidence/11.0'},signal:AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS),collectionSignal])});
   if(!response?.ok)fail('UPSTREAM_HTTP_ERROR');
   payload=await response.json();
  }catch(error){if(error?.code==='UPSTREAM_HTTP_ERROR')throw error;fail('NETWORK_OR_JSON_UNAVAILABLE')}
  if(payload?.retCode!==0)fail('UPSTREAM_REJECTED');
  if(!numeric(payload.time)||Number(payload.time)<=0||Math.abs(Number(payload.time)-now)>60000)fail('STALE_RESPONSE_TIMESTAMP');
  if(!payload.result||typeof payload.result!=='object')fail('MISSING_DATA');
  return {result:payload.result,time:Number(payload.time)};
 });
}
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child)}return value}
function id(fetcher){if(!fetcherIds.has(fetcher))fetcherIds.set(fetcher,++nextFetcherId);return fetcherIds.get(fetcher)}
async function build(symbol,fetcher,now){
 const evidence=emptyEvidence(symbol,now);
 const collectionSignal=AbortSignal.timeout(20000);
 const resources=[
  ['five','/v5/market/kline',{category:'linear',symbol,interval:'5',limit:'1000'},r=>candles(r,symbol,300000)],
  ['quarter','/v5/market/kline',{category:'linear',symbol,interval:'15',limit:'300'},r=>candles(r,symbol,900000)],
  ['hour','/v5/market/kline',{category:'linear',symbol,interval:'60',limit:'200'},r=>candles(r,symbol,3600000)],
  ['fourHour','/v5/market/kline',{category:'linear',symbol,interval:'240',limit:'100'},r=>candles(r,symbol,14400000)],
  ['book','/v5/market/orderbook',{category:'linear',symbol,limit:'50'},r=>book(r,symbol)],
  ['ticker','/v5/market/tickers',{category:'linear',symbol},r=>single(r,symbol)],
  ['openInterest','/v5/market/open-interest',{category:'linear',symbol,intervalTime:'5min',limit:'12'},r=>interest(r,symbol)],
  ['fundingHistory','/v5/market/funding/history',{category:'linear',symbol,limit:'8'},r=>funding(r,symbol)],
  ['instrument','/v5/market/instruments-info',{category:'linear',symbol},r=>{
   const item=single(r,symbol);
   if(item.status!=='Trading'||item.quoteCoin!=='USDT'||item.contractType!=='LinearPerpetual')fail('UNSUPPORTED_INSTRUMENT');
   return item;
  }]
 ];
 if(symbol!=='BTCUSDT')resources.push(['benchmarkFive','/v5/market/kline',{category:'linear',symbol:'BTCUSDT',interval:'5',limit:'200'},r=>candles(r,'BTCUSDT',300000)]);
 await Promise.all(resources.map(async([source,path,params,parse])=>{
  try{const response=await request(path,params,fetcher,now,collectionSignal);evidence[source]=parse(response.result);evidence.sourceTimes[source]=response.time}
  catch(error){evidence.errors.push({source,code:error?.code||'SOURCE_UNAVAILABLE'})}
 }));
 if(symbol==='BTCUSDT'&&evidence.five){evidence.benchmarkFive=evidence.five.slice(-200);evidence.sourceTimes.benchmarkFive=evidence.sourceTimes.five}
 evidence.errors.sort((a,b)=>a.source.localeCompare(b.source));
 return deepFreeze(evidence);
}
function collectEvidence(value,{fetcher=fetch,now=Date.now(),fresh=false}={}){
 let symbol;try{symbol=normalizeSymbol(value)}catch(error){return Promise.reject(error)}
 if(typeof fetcher!=='function'||!Number.isFinite(now))return Promise.reject(new TypeError('Invalid evidence request'));
 const key=id(fetcher)+':'+symbol,entry=cache.get(key);
 if(!fresh&&entry&&now-entry.observedAt>=0&&now-entry.observedAt<CACHE_MS)return Promise.resolve(entry);
 if(inflight.has(key))return inflight.get(key);
 if(inflight.size>=MAX_INFLIGHT){const unavailable=emptyEvidence(symbol,now);unavailable.errors.push({source:'collector',code:'COLLECTOR_BUSY'});return Promise.resolve(deepFreeze(unavailable))}
 const promise=build(symbol,fetcher,now).then(result=>{
  cache.delete(key);cache.set(key,result);
  while(cache.size>MAX_CACHE)cache.delete(cache.keys().next().value);
  return result;
 }).finally(()=>inflight.delete(key));
 inflight.set(key,promise);return promise;
}
function resetCache(){cache.clear()}
module.exports={collectEvidence,normalizeSymbol,resetCache};
