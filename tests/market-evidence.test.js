'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectEvidence,normalizeSymbol,resetCache}=require('../lib/market-evidence');
const NOW=Date.now();

function responseFor(url){
 const parsed=new URL(url),symbol=parsed.searchParams.get('symbol'),route=parsed.pathname;
 let result;
 if(route==='/v5/market/kline'){
  const period=Number(parsed.searchParams.get('interval'))*60000,start=Math.floor(NOW/period)*period;
  result={category:'linear',symbol,list:Array.from({length:3},(_,i)=>[String(start-(i+1)*period),'100','101','99','100.5','1000','100500'])};
 }else if(route==='/v5/market/orderbook')result={s:symbol,ts:NOW,b:[['100.49','10'],['100.48','20']],a:[['100.51','10'],['100.52','20']]};
 else if(route==='/v5/market/tickers')result={category:'linear',list:[{symbol,bid1Price:'100.49',ask1Price:'100.51',lastPrice:'100.5',turnover24h:'100000000',fundingRate:'.0001',nextFundingTime:String(NOW+3600000)}]};
 else if(route==='/v5/market/open-interest')result={symbol,list:[{openInterest:'100000',timestamp:String(NOW)},{openInterest:'99000',timestamp:String(NOW-300000)}]};
 else if(route==='/v5/market/funding/history')result={category:'linear',list:[{symbol,fundingRate:'.0001',fundingRateTimestamp:String(NOW-3600000)}]};
 else if(route==='/v5/market/instruments-info')result={category:'linear',list:[{symbol,status:'Trading',quoteCoin:'USDT',contractType:'LinearPerpetual',lotSizeFilter:{qtyStep:'.001',minOrderQty:'.001',minNotionalValue:'5'},priceFilter:{tickSize:'.001'}}]};
 else throw Error('Unexpected fixture route '+route);
 return {retCode:0,time:NOW,result};
}
function fixture({mutate,delay=0}={}){
 const calls=[];let active=0,peak=0;
 const fetcher=async(url,options)=>{
  calls.push({url,options});active++;peak=Math.max(peak,active);
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  const data=responseFor(url);if(mutate)mutate(data,new URL(url));
  active--;return {ok:true,status:200,json:async()=>data};
 };
 return {fetcher,calls,get peak(){return peak}};
}
test.beforeEach(resetCache);

test('symbols are validated before network access, with a fixed USDT destination',async()=>{
 assert.equal(normalizeSymbol('BTC'),'BTCUSDT');assert.equal(normalizeSymbol('ETHUSDT'),'ETHUSDT');
 let count=0;
 for(const value of ['btc',' BTC','BTC ','https://evil.example','BTC/USDT','USDT','A','BTC?symbol=ETH',null,{},['BTC']])await assert.rejects(collectEvidence(value,{fetcher:async()=>{count++},now:NOW}),/symbol/);
 assert.equal(count,0);
});
test('all ten evidence sources use GET-only fixed public endpoints and preserve timestamps',async()=>{
 const f=fixture(),data=await collectEvidence('ETH',{fetcher:f.fetcher,now:NOW});
 assert.equal(f.calls.length,10);assert.equal(data.symbol,'ETHUSDT');assert.equal(data.observedAt,NOW);assert.deepEqual(data.errors,[]);
 for(const call of f.calls){const url=new URL(call.url);assert.equal(url.origin,'https://api.bybit.com');assert.ok(url.pathname.startsWith('/v5/market/'));assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'error');assert.ok(call.options.signal instanceof AbortSignal);assert.equal(call.options.headers.Authorization,undefined);assert.equal(call.options.headers['X-BAPI-API-KEY'],undefined)}
 for(const key of ['five','quarter','hour','fourHour','benchmarkFive']){assert.equal(data[key].length,3);assert.ok(data[key][0][0]<data[key][1][0]);assert.ok(data[key].every(row=>row.every(Number.isFinite)));assert.equal(data.sourceTimes[key],NOW)}
 assert.equal(data.book.ts,NOW);assert.equal(data.openInterest[0].timestamp,String(NOW));assert.equal(data.fundingHistory[0].fundingRateTimestamp,String(NOW-3600000));
 const queries=f.calls.map(call=>new URL(call.url).searchParams);
 assert.ok(queries.some(q=>q.get('interval')==='5'&&q.get('limit')==='1000'));
 assert.ok(queries.some(q=>q.get('interval')==='15'&&q.get('limit')==='300'));
 assert.ok(queries.some(q=>q.get('interval')==='60'&&q.get('limit')==='200'));
 assert.ok(queries.some(q=>q.get('symbol')==='BTCUSDT'&&q.get('limit')==='200'));
 assert.throws(()=>data.book.a.push(['1','1']),TypeError);
});
test('BTC reuses its own candle history instead of inventing or refetching a benchmark',async()=>{
 const f=fixture(),data=await collectEvidence('BTC',{fetcher:f.fetcher,now:NOW});
 assert.equal(f.calls.length,9);assert.deepEqual(data.benchmarkFive,data.five);assert.equal(data.sourceTimes.benchmarkFive,data.sourceTimes.five);
});
test('concurrent collections share one global four-request concurrency limit',async()=>{
 const f=fixture({delay:3});
 const [a,b]=await Promise.all(['ETH','SOL'].map(symbol=>collectEvidence(symbol,{fetcher:f.fetcher,now:NOW})));
 assert.equal(f.calls.length,20);assert.equal(f.peak,4);assert.equal(a.errors.length,0);assert.equal(b.errors.length,0);
});
test('in-flight requests deduplicate, cached snapshots expire, and fresh bypasses completed cache',async()=>{
 const f=fixture({delay:1}),options={fetcher:f.fetcher,now:NOW};
 const first=collectEvidence('ETH',options),same=collectEvidence('ETHUSDT',options);assert.equal(first,same);
 const a=await first,b=await collectEvidence('ETH',{...options,now:NOW+1000});assert.equal(a,b);assert.equal(f.calls.length,10);
 await collectEvidence('ETH',{...options,now:NOW+1001,fresh:true});assert.equal(f.calls.length,20);
 await collectEvidence('ETH',{...options,now:NOW+7000});assert.equal(f.calls.length,30);
 const other=fixture();await collectEvidence('ETH',{fetcher:other.fetcher,now:NOW+7000});assert.equal(other.calls.length,10);
});
test('completed cache is bounded and cannot retain an unlimited symbol universe',async()=>{
 const f=fixture();
 for(let i=0;i<33;i++)await collectEvidence('A'+i,{fetcher:f.fetcher,now:NOW});
 assert.equal(f.calls.length,330);
 await collectEvidence('A0',{fetcher:f.fetcher,now:NOW});assert.equal(f.calls.length,340);
});
test('excess in-flight symbols fail closed instead of growing an unbounded request queue',async()=>{
 const f=fixture({delay:1}),pending=Array.from({length:16},(_,i)=>collectEvidence('Q'+i,{fetcher:f.fetcher,now:NOW}));
 const busy=await collectEvidence('OVERLOAD',{fetcher:f.fetcher,now:NOW});
 assert.deepEqual(busy.errors,[{source:'collector',code:'COLLECTOR_BUSY'}]);assert.equal(busy.five,null);assert.equal(busy.book,null);
 await Promise.all(pending);assert.equal(f.calls.length,160);assert.equal(f.peak,4);
});
test('a mismatched market or malformed source remains null with explicit diagnostic errors',async()=>{
 const f=fixture({mutate:(data,url)=>{
  if(url.pathname==='/v5/market/tickers')data.result.list[0].symbol='OTHERUSDT';
  if(url.pathname==='/v5/market/kline'&&url.searchParams.get('interval')==='15')data.result.list[0][3]=null;
  if(url.pathname==='/v5/market/open-interest')data.result.list=[];
  if(url.pathname==='/v5/market/orderbook')data.result.a[0][0]='1';
 }}),data=await collectEvidence('ETH',{fetcher:f.fetcher,now:NOW});
 assert.equal(data.ticker,null);assert.equal(data.quarter,null);assert.equal(data.openInterest,null);assert.equal(data.book,null);assert.ok(data.five);
 assert.deepEqual(data.errors.map(e=>e.source),['book','openInterest','quarter','ticker']);
 assert.ok(data.errors.every(e=>typeof e.code==='string'&&!('message' in e)));
});
test('wrong derivative product and stale response timestamps do not masquerade as usable data',async()=>{
 const bad=fixture({mutate:(data,url)=>{if(url.pathname==='/v5/market/instruments-info')data.result.list[0].contractType='InversePerpetual'}});
 const result=await collectEvidence('ETH',{fetcher:bad.fetcher,now:NOW});assert.equal(result.instrument,null);assert.ok(result.errors.some(e=>e.code==='UNSUPPORTED_INSTRUMENT'));
 const stale=fixture({mutate:data=>{data.time=NOW-120000}}),data=await collectEvidence('ETH',{fetcher:stale.fetcher,now:NOW});
 assert.equal(data.five,null);assert.equal(data.errors.length,10);assert.ok(data.errors.every(e=>e.code==='STALE_RESPONSE_TIMESTAMP'));
});
test('network failures expose safe source codes without copying error text or substituting data',async()=>{
 const data=await collectEvidence('ETH',{fetcher:async()=>{throw Error('Authorization: fixture-value-do-not-expose')},now:NOW});
 assert.equal(data.errors.length,10);assert.equal(data.five,null);assert.equal(data.book,null);assert.ok(!JSON.stringify(data).includes('fixture-value'));
});
test('public decision endpoint rejects writes and invalid inputs before collecting market data',async()=>{
 const handler=require('../api/decision'),result=()=>({setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}});
 const denied=result();await handler({method:'POST',query:{symbol:'BTC'}},denied);assert.equal(denied.code,405);
 for(const query of [{symbol:'https://evil.example'},{symbol:'BTC',side:'LONG'},{symbol:['BTC','ETH']},{symbol:'BTC',mode:'unsafe'}]){const r=result();await handler({method:'GET',query},r);assert.equal(r.code,400)}
});
test('public API applies demo history policy explicitly and defaults to strict live policy',async()=>{
 const evidencePath=require.resolve('../lib/market-evidence'),apiPath=require.resolve('../api/decision'),previous=require.cache[evidencePath].exports;
 const e=require('./fixtures/advanced-evidence').evidence(Date.now());e.five=e.five.slice(-500);
 try{
  require.cache[evidencePath].exports={...previous,collectEvidence:async()=>e};delete require.cache[apiPath];const handler=require(apiPath);
  for(const mode of [undefined,'live','demo']){
   const res={setHeader(){},status(n){this.code=n;return this},json(d){this.body=d;return this}};
   await handler({method:'GET',query:{symbol:'XRP',...(mode?{mode}:{})}},res);
   assert.equal(res.code,200);assert.equal(res.body.decision.eligible,mode==='demo');assert.equal(res.body.decision.validation.passed,false);
   assert.equal(res.body.decision.executionPolicy,mode==='demo'?'DEMO_FORWARD_TEST':'LIVE_STRICT');
  }
 }finally{require.cache[evidencePath].exports=previous;delete require.cache[apiPath]}
});
