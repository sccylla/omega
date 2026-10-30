'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {TelegramLive}=require('../lib/telegram-live');
const {OmegaTelegramBot}=require('../lib/telegram-demo-bot');
const {LiveBroker}=require('../lib/live-broker');
const t=Date.UTC(2026,9,30,20,0,0);
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'omega-tgreal-'));
function fake(){
 const calls=[],state={equity:88,available:88,pnlToday:0,positions:[],pending:[]};
 const ticket={symbol:'XRPUSDT',side:'Buy',qty:'0.15',price:100,notional:15,
  stopLoss:'99.7',takeProfit:'100.6',estimatedTakeProfitNetUsd:.056};
 const broker={
  ready:()=>true,
  snapshot:async()=>structuredClone(state),
  request:async(method,endpoint)=>{assert.equal(method,'GET');assert.equal(endpoint,'/v5/market/tickers');
   return {list:[{symbol:'XRPUSDT',bid1Price:'99.99',ask1Price:'100.01'}]}},
  ticket:async(symbol,side,plan,options)=>{
   calls.push({kind:'ticket',symbol,side,plan,options});
   assert.equal(options.notionalUsd,15);assert.equal(options.maxNotionalUsd,16);
   return {...ticket,symbol,side,price:side==='Buy'?100.01:99.99,
    stopLoss:side==='Buy'?'99.71':'100.29',
    takeProfit:side==='Buy'?'100.61':'99.39'};
  },
  leverage:async(symbol)=>{calls.push({kind:'leverage',symbol})},
  enter:async(order,link)=>{calls.push({kind:'ENTER',order,link});return {orderId:'realack'}},
  order:async(symbol,link)=>{calls.push({kind:'reconcile',symbol,link});return {orderStatus:'Filled'}},
 };
 return {calls,state,broker};
}
function create(dir,fixture,enabled=false,clock=()=>t){
 const env={OMEGA_TELEGRAM_REAL_ORDERS_ENABLED:enabled?'true':'false'};
 return new TelegramLive({directory:dir,env,broker:fixture.broker,now:clock});
}
test('credentials and order switch are separate; no order on balance and preview',async()=>{
 const dir=tmp();try{
  const f=fake(),bot=create(dir,f);
  assert.equal(bot.status().configured,true);
  assert.equal(bot.status().ordersEnabled,false);
  const balance=await bot.balance();
  assert.equal(balance.equity,88);
  const preview=await bot.preview('XRPUSDT','Buy');
  assert.equal(preview.ticket.notional,15);
  assert.ok(preview.risk<=.15);
  assert.equal(f.calls.filter(x=>x.kind==='ENTER').length,0);
  await assert.rejects(bot.execute(preview.code),/switch is OFF/);
  assert.equal(f.calls.filter(x=>x.kind==='ENTER').length,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('explicit correct code permits only one $15 funded order with attached TP and SL',async()=>{
 const dir=tmp();try{
  const f=fake(),bot=create(dir,f,true);
  const p=await bot.preview('XRPUSDT','Buy');
  await assert.rejects(bot.execute('AAAAAAAAAA'),/code missing, invalid or expired/);
  const done=await bot.execute(p.code);
  assert.equal(done.symbol,'XRPUSDT');
  assert.equal(f.calls.filter(x=>x.kind==='ENTER').length,1);
  assert.equal(f.calls.filter(x=>x.kind==='leverage').length,1);
  assert.match(done.note,/NOT a verified fill/);
  await assert.rejects(bot.execute(p.code),/code missing, invalid or expired/);
  await assert.rejects(bot.preview('XRPUSDT','Buy'),/Previous live order/);
  const check=await bot.reconcile();
  assert.equal(check.positionOpen,false);
  assert.equal(check.cleared,false||undefined); // still locked until safe reconciliation age
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('pending live intent survives restart and disallows a second order',async()=>{
 const dir=tmp();try{
  const f=fake(),bot=create(dir,f,true);
  const p=await bot.preview('XRPUSDT','Buy');
  await bot.execute(p.code);
  const second=create(dir,f,true);
  assert.equal(second.status().pendingIntent,true);
  await assert.rejects(second.preview('XRPUSDT','Buy'),/Previous live order/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('funded entry blocked for insufficient capital, existing position, daily loss or nonzero pending orders',async()=>{
 for(const changes of [{equity:70},{available:10},{pnlToday:-1},{positions:[{symbol:'BTCUSDT',size:'1'}]},{pending:[{symbol:'ETHUSDT'}]}]){
  const dir=tmp();try{
   const f=fake();Object.assign(f.state,changes);
   const bot=create(dir,f,true);
   await assert.rejects(bot.preview('XRPUSDT','Buy'));
   assert.equal(f.calls.filter(x=>x.kind==='ENTER').length,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
 }
});
test('unknown pair or spread above micro-scalp cap fails without execution',async()=>{
 const dir=tmp();try{
  const f=fake(),bot=create(dir,f,true);
  await assert.rejects(bot.preview('FAKEUSDT','Buy'),/Pair not available/);
  f.broker.request=async()=>({list:[{symbol:'XRPUSDT',bid1Price:'99.90',ask1Price:'100.10'}]});
  await assert.rejects(bot.preview('XRPUSDT','Buy'),/Spread exceeds/);
  assert.equal(f.calls.filter(x=>x.kind==='ENTER').length,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('new Bybit order sizing option preserves legacy $90 default',async()=>{
 const calls=[],env={BYBIT_LIVE_API_KEY:'unused',BYBIT_LIVE_API_SECRET:'unused'};
 const live=new LiveBroker({env,fetcher:async(url)=>{
  calls.push(url);
  const isInstrument=url.includes('instruments-info');
  return {ok:true,json:async()=>({retCode:0,time:Date.now(),result:isInstrument?
   {list:[{symbol:'XRPUSDT',status:'Trading',quoteCoin:'USDT',contractType:'LinearPerpetual',
    lotSizeFilter:{qtyStep:'.001',minOrderQty:'.001',maxMktOrderQty:'99999',minNotionalValue:'5'},
    priceFilter:{tickSize:'.0001'}}]}:
   {list:[{symbol:'XRPUSDT',bid1Price:'1',ask1Price:'1.0001',markPrice:'1.00005'}]}})};
 }});
 const plan={price:1.0001,stopPct:.3,targetNet:.05,slippageBps:5};
 const micro=await live.ticket('XRPUSDT','Buy',plan,{notionalUsd:15,maxNotionalUsd:16});
 assert.ok(micro.notional>=15&&micro.notional<=16);
 const legacy=await live.ticket('XRPUSDT','Buy',{...plan,targetNet:.5});
 assert.ok(legacy.notional>=90&&legacy.notional<=91);
 assert.equal(calls.length,4);
});
test('Telegram commands expose real balance and two-step trade only to owner',async()=>{
 const dir=tmp();try{
  const f=fake(),live=create(dir,f,false),sent=[];
  const token='12345678:'+ 'A'.repeat(35);
  const bot=new OmegaTelegramBot({directory:dir,env:{
   OMEGA_TELEGRAM_BOT_TOKEN:token,OMEGA_TELEGRAM_OWNER_CHAT_ID:'12345678'},
   live,fetchImpl:async(url,options)=>{
    sent.push({method:url.split('/').at(-1),body:JSON.parse(options.body)});
    return {ok:true,json:async()=>({ok:true,result:true})};
   },WebSocketCtor:class {}});
  await bot.handle({message:{chat:{id:87654321,type:'private'},from:{id:87654321},text:'/realtrade BUY XRPUSDT'}});
  assert.equal(sent.length,0);
  await bot.handle({message:{chat:{id:12345678,type:'private'},from:{id:12345678},text:'/realbalance'}});
  assert.match(sent.at(-1).body.text,/LIVE ACCOUNT/);
  await bot.handle({message:{chat:{id:12345678,type:'private'},from:{id:12345678},text:'/realtrade BUY XRPUSDT'}});
  assert.match(sent.at(-1).body.text,/REAL MONEY TRADE PREVIEW/);
  assert.equal(f.calls.filter(x=>x.kind==='ENTER').length,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
