'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const lib=require('../lib/bybit-demo');const handler=require('../api/demo');
function instrument(){return {status:'Trading',lotSizeFilter:{qtyStep:'0.001',minOrderQty:'0.001',maxMktOrderQty:'10',minNotionalValue:'5'},priceFilter:{tickSize:'0.1'}}}
function req(method,action,body={},extraHeaders={}){return {method,query:{action},body,headers:{host:'example.com',origin:'https://example.com','x-omega-request':'1',...extraHeaders}}}
function res(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this},json(b){this.body=b;return this}}}
test('broker host is a hardcoded Bybit demo hostname',()=>{assert.equal(lib.DEMO_BASE,'https://api-demo.bybit.com');assert.ok(!lib.DEMO_BASE.includes('api.bybit.com'));});
test('no unconfigured credentials may sign requests or start trading',async()=>{delete process.env.BYBIT_DEMO_API_KEY;delete process.env.BYBIT_DEMO_API_SECRET;delete process.env.BYBIT_DEMO_ORDERS_ENABLED;assert.equal(lib.keyReady(),false);assert.equal(lib.canTrade(),false);await assert.rejects(()=>lib.api('GET','/v5/account/wallet-balance',{accountType:'UNIFIED'}),/keys/);await assert.rejects(()=>lib.executePreview({confirm:'PLACE DEMO ORDER'}),/disabled/);});
test('strict market, stop, leverage and risk bounds',()=>{for(const p of [{symbol:'DOGEUSDT',side:'Buy'},{symbol:'BTCUSDT',side:'Hold'},{symbol:'BTCUSDT',side:'Buy',riskPct:10},{symbol:'BTCUSDT',side:'Buy',leverage:25},{symbol:'BTCUSDT',side:'Sell',stopPct:0.1}])assert.throws(()=>lib.validateChoice(p));});
test('risk engine limits notional, 2 positions, daily loss and new pending orders',()=>{const v=lib.prepareOrder({symbol:'BTCUSDT',side:'Buy',riskPct:.5,stopPct:1.5,leverage:2},10000,10000,0,instrument(),50000,0,0);assert.ok(v.notional<=2000.01);assert.equal(v.stopLoss,'49250.0');assert.equal(v.takeProfit,'51125.0');assert.throws(()=>lib.prepareOrder({symbol:'BTCUSDT',side:'Buy'},10000,10000,2,instrument(),50000,0,0),/Maximum/);assert.throws(()=>lib.prepareOrder({symbol:'BTCUSDT',side:'Buy'},10000,10000,0,instrument(),50000,-200,0),/daily loss/);assert.throws(()=>lib.prepareOrder({symbol:'BTCUSDT',side:'Buy'},10000,10000,0,instrument(),50000,0,1),/Pending/);});
test('quantity steps are rounded down, never up',()=>{assert.equal(lib.fixedStep(0.0589,'0.001'),'0.058');assert.equal(lib.fixedStep(147.129,'0.01'),'147.12');});
test('unauthenticated action blocked and cross-site post blocked',async()=>{const a=res();await handler(req('GET','account'),a);assert.equal(a.statusCode,401);const b=res();await handler(req('POST','preview',{}, {origin:'https://bad.example.com'}),b);assert.equal(b.statusCode,403);});
test('new order endpoint is blocked unless explicitly enabled',async()=>{const out=res();await handler(req('POST','order',{confirm:'PLACE DEMO ORDER'}),out);assert.equal(out.statusCode,401);});
test('authenticated V5 signing uses demo domain and correct HMAC input',async()=>{
  process.env.BYBIT_DEMO_API_KEY='test-demo-key';process.env.BYBIT_DEMO_API_SECRET='test-demo-secret';
  const previous=global.fetch;let captured;
  global.fetch=async(url,options)=>{captured={url,options};return {ok:true,json:async()=>({retCode:0,retMsg:'OK',result:{ok:true}})}};
  try{assert.deepEqual(await lib.api('GET','/v5/account/wallet-balance',{accountType:'UNIFIED'}),{ok:true});assert.ok(captured.url.startsWith('https://api-demo.bybit.com/'));const h=captured.options.headers;const expected=crypto.createHmac('sha256','test-demo-secret').update(h['X-BAPI-TIMESTAMP']+'test-demo-key'+'5000'+'accountType=UNIFIED').digest('hex');assert.equal(h['X-BAPI-SIGN'],expected);}finally{global.fetch=previous;delete process.env.BYBIT_DEMO_API_KEY;delete process.env.BYBIT_DEMO_API_SECRET;}
});
test('server never supports a live broker hostname from inputs',async()=>{await assert.rejects(()=>lib.api('GET','https://api.bybit.com/v5/order/create'),/Invalid/);await assert.rejects(()=>lib.api('GET','/v5/../../order/create'),/Invalid/);});
