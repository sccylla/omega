'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectQuote}=require('../lib/market-quote');
const NOW=Date.now();
function payload(symbol='ETHUSDT'){return {retCode:0,time:NOW,result:{category:'linear',list:[{symbol,bid1Price:'100.4',ask1Price:'100.6'}]}}}
function fetcher(change){return async()=>{const data=payload();if(change)change(data);return {ok:true,json:async()=>data}}}
test('fresh quote uses only a public GET for the requested linear USDT symbol',async()=>{
 let captured;const quote=await collectQuote('ETH',{now:NOW,fetcher:async(url,options)=>{captured={url,options};return {ok:true,json:async()=>payload()}}});
 assert.deepEqual(quote,{symbol:'ETHUSDT',bid:100.4,ask:100.6,mid:100.5,observedAt:NOW});
 const url=new URL(captured.url);assert.equal(url.origin,'https://api.bybit.com');assert.equal(url.pathname,'/v5/market/tickers');assert.equal(url.searchParams.get('category'),'linear');assert.equal(url.searchParams.get('symbol'),'ETHUSDT');assert.equal(captured.options.method,'GET');assert.equal(captured.options.redirect,'error');assert.ok(captured.options.signal instanceof AbortSignal);assert.equal(captured.options.headers.Authorization,undefined);assert.equal(captured.options.headers['X-BAPI-API-KEY'],undefined);
});
test('invalid symbols fail before making a request',async()=>{
 let calls=0;for(const symbol of ['https://example.com','ETH/USDT','eth',' ETH',null,{}])await assert.rejects(collectQuote(symbol,{fetcher:async()=>{calls++},now:NOW}),/symbol/);assert.equal(calls,0);
});
test('stale, future, rejected or malformed response timestamps cannot close a position',async()=>{
 for(const change of [d=>d.time=NOW-11000,d=>d.time=NOW+2000,d=>d.time=null,d=>d.time='Infinity',d=>d.retCode=10001])await assert.rejects(collectQuote('ETH',{fetcher:fetcher(change),now:NOW}),/stale or invalid/);
});
test('wrong symbol, derivative category or multiple rows fail closed',async()=>{
 for(const change of [d=>d.result.list[0].symbol='BTCUSDT',d=>d.result.category='spot',d=>d.result.list=[],d=>d.result.list.push({...d.result.list[0]})])await assert.rejects(collectQuote('ETH',{fetcher:fetcher(change),now:NOW}),/match/);
});
test('prices must be finite positive bid/ask values in the right order',async()=>{
 for(const [bid,ask] of [[null,'100'],['','100'],[true,'100'],['Infinity','100'],['100','NaN'],['0','1'],['-1','1'],['101','100']])await assert.rejects(collectQuote('ETH',{fetcher:fetcher(d=>{d.result.list[0].bid1Price=bid;d.result.list[0].ask1Price=ask}),now:NOW}),/prices/);
 const locked=await collectQuote('ETH',{fetcher:fetcher(d=>{d.result.list[0].bid1Price='100';d.result.list[0].ask1Price='100'}),now:NOW});assert.equal(locked.mid,100);
});
test('network and HTTP errors never expose underlying request or credential text',async()=>{
 await assert.rejects(collectQuote('ETH',{fetcher:async()=>{throw Error('Authorization: fixture-secret-never-echo')},now:NOW}),error=>error.message==='Public quote temporarily unavailable');
 await assert.rejects(collectQuote('ETH',{fetcher:async()=>({ok:false,status:403,json:async()=>({})}),now:NOW}),/temporarily unavailable/);
});
test('quote API rejects writes and malformed symbols, and exposes safe upstream failures',async()=>{
 const handler=require('../api/quote'),makeRes=()=>({setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}});
 const denied=makeRes();await handler({method:'POST',query:{symbol:'ETH'}},denied);assert.equal(denied.code,405);
 const bad=makeRes();await handler({method:'GET',query:{symbol:'ETH/USDT'}},bad);assert.equal(bad.code,400);
 const previous=global.fetch;global.fetch=async()=>{throw Error('fixture-secret-never-echo')};
 try{const failed=makeRes();await handler({method:'GET',query:{symbol:'ETH'}},failed);assert.equal(failed.code,502);assert.ok(!JSON.stringify(failed.body).includes('fixture-secret'))}finally{global.fetch=previous}
});
