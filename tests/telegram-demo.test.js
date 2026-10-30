'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {TelegramDemoEngine}=require('../lib/telegram-demo-engine');
const {OmegaTelegramBot,PublicBybitDemoFeed}=require('../lib/telegram-demo-bot');
const START=Date.UTC(2026,9,30,16,0),SYMBOL='BTCUSDT';
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'omega-telegram-'))}
function cleanup(dir){fs.rmSync(dir,{recursive:true,force:true})}
function market(p,t,i){
 return [
  {topic:'orderbook.50.'+SYMBOL,ts:t,type:'snapshot',
   data:{s:SYMBOL,u:i+1,seq:i+1,b:[[(p-.005).toFixed(6),'1000']],
    a:[[(p+.005).toFixed(6),'350']]}},
  {topic:'publicTrade.'+SYMBOL,ts:t,type:'snapshot',
   data:[{s:SYMBOL,S:'Buy',T:t,p:p.toFixed(6),v:'20',i:'tg-trade-'+i}]}
 ];
}
test('fresh Telegram paper engine is $88 DEMO only; never activates on construction',()=>{
 const dir=temp();try{
  const e=new TelegramDemoEngine({directory:dir,now:()=>START});
  assert.equal(e.state.running,false);
  assert.equal(e.status(START).stats.wallet,88);
  assert.equal(e.status(START).stats.tradeNotional,15);
  assert.equal(e.status(START).stats.dailyMaxLossUsd,1);
  assert.equal(e.state.symbols.length,6);
  assert.equal(fs.existsSync(path.join(dir,'telegram-demo-state.json')),true);
 }finally{cleanup(dir)}
});
test('standalone persistent engine consumes public 1s price feed and opens $15 virtual position',()=>{
 const dir=temp();try{
  let current=START;const e=new TelegramDemoEngine({directory:dir,now:()=>current});
  assert.match(e.start(),/Demo scanning armed/);
  for(let i=0;i<=64;i++){
   current=START+i*1000;
   const p=100+(i<=20?.30*i/20:i<=45?.30-.20*(i-20)/25:.10+(i-45)*.008);
   for(const msg of market(p,current,i))assert.equal(e.ingest(msg,current),true);
   e.tick(true,current+100);
  }
  const open=e.state.wallet.ledger.open;
  assert.ok(open,'Expected qualified virtual order');
  assert.equal(open.notional,15);
  assert.equal(open.targetNet,.05);
  assert.equal(e.state.wallet.cash,88);
  assert.ok(e.takeEvents().some(x=>x.type==='OPEN'));
  const recovered=new TelegramDemoEngine({directory:dir,now:()=>current+5000});
  assert.equal(recovered.state.wallet.ledger.open,null);
  assert.equal(recovered.state.wallet.ledger.incomplete,1);
  assert.equal(recovered.state.wallet.cash,88);
  assert.equal(recovered.state.running,true); // demo may resume on worker restart
 }finally{cleanup(dir)}
});
test('owner pause preserves settled virtual funds, flags unverified fills incomplete',()=>{
 const dir=temp();try{
  let now=START;const e=new TelegramDemoEngine({directory:dir,now:()=>now});
  e.start();
  for(let i=0;i<=64;i++){
   now=START+i*1000;
   const p=100+(i<=20?.30*i/20:i<=45?.30-.20*(i-20)/25:.10+(i-45)*.008);
   for(const msg of market(p,now,i))e.ingest(msg,now);
   e.tick(true,now+100);
  }
  assert.ok(e.state.wallet.ledger.open);
  const response=e.pause();
  assert.match(response,/marked INCOMPLETE/);
  assert.equal(e.state.running,false);
  assert.equal(e.state.wallet.ledger.open,null);
  assert.equal(e.state.wallet.ledger.incomplete,1);
  assert.equal(e.state.wallet.closedTrades,0);
  assert.equal(e.state.wallet.cash,88);
 }finally{cleanup(dir)}
});
test('Telegram pairs can be updated only while paused and are validated',()=>{
 const dir=temp();try{
  const e=new TelegramDemoEngine({directory:dir,now:()=>START});
  assert.match(e.setPairs('BTCUSDT,ETHUSDT'),/BTCUSDT/);
  assert.deepEqual(e.state.symbols,['BTCUSDT','ETHUSDT']);
  e.start();
  assert.throws(()=>e.setPairs('XRPUSDT'),/Pause/);
  e.pause();
  assert.throws(()=>e.setPairs('BTCUSDT,BTCUSDT'),/unique/);
  assert.throws(()=>e.setPairs('BTCUSDT,../../'),/USDT futures/);
 }finally{cleanup(dir)}
});
test('Telegram chat authorization: no one can arm DEMO except numeric owner in private chat',async()=>{
 const dir=temp(),calls=[];
 try{
  const env={OMEGA_TELEGRAM_BOT_TOKEN:'12345678:'+ 'A'.repeat(35),OMEGA_TELEGRAM_OWNER_CHAT_ID:'12345678'};
  const fetchImpl=async(url,opts)=>{
   calls.push({method:url.split('/').at(-1),args:JSON.parse(opts.body)});
   return {ok:true,json:async()=>({ok:true,result:true})};
  };
  const bot=new OmegaTelegramBot({directory:dir,env,fetchImpl,WebSocketCtor:class {}});
  await bot.handle({message:{chat:{id:9999,type:'private'},from:{id:9999},text:'/run'}});
  assert.equal(bot.paper.state.running,false);
  await bot.handle({message:{chat:{id:12345678,type:'group'},from:{id:12345678},text:'/run'}});
  assert.equal(bot.paper.state.running,false);
  await bot.handle({message:{chat:{id:12345678,type:'private'},from:{id:9999},text:'/run'}});
  assert.equal(bot.paper.state.running,false);
  await bot.handle({message:{chat:{id:12345678,type:'private'},from:{id:12345678},text:'/status'}});
  assert.equal(calls.some(c=>c.method==='sendMessage'),true);
  assert.equal(bot.paper.state.running,false);
  // Authorized command changes only local DEMO state; no external broker order.
  await bot.handle({message:{chat:{id:12345678,type:'private'},from:{id:12345678},text:'/pairs BTCUSDT,ETHUSDT'}});
  assert.deepEqual(bot.paper.state.symbols,['BTCUSDT','ETHUSDT']);
 }finally{cleanup(dir)}
});
test('unpaired bot can respond to /id but refuses trading commands',async()=>{
 const dir=temp(),messages=[];
 try{
  const env={OMEGA_TELEGRAM_BOT_TOKEN:'12345678:'+'A'.repeat(35)};
  const fetchImpl=async(url,opts)=>{messages.push({url:url.split('/').at(-1),body:JSON.parse(opts.body)});
   return {ok:true,json:async()=>({ok:true,result:true})}};
  const bot=new OmegaTelegramBot({directory:dir,env,fetchImpl,WebSocketCtor:class {}});
  await bot.handle({message:{chat:{id:2345678,type:'private'},from:{id:2345678},text:'/id'}});
  assert.match(messages[0].body.text,/2345678/);
  await bot.handle({message:{chat:{id:2345678,type:'private'},from:{id:2345678},text:'/run'}});
  assert.equal(bot.paper.state.running,false);
 }finally{cleanup(dir)}
});
test('Telegram update offset persists before any command is dispatched',async()=>{
 const dir=temp();try{
  const env={OMEGA_TELEGRAM_BOT_TOKEN:'12345678:'+'A'.repeat(35),OMEGA_TELEGRAM_OWNER_CHAT_ID:'12345678'};
  const calls=[];
  const fetchImpl=async(url,opts)=>{
   const method=url.split('/').at(-1);const body=JSON.parse(opts.body);
   calls.push({method,body});
   const data=method==='getUpdates'?[{update_id:42,message:{chat:{id:12345678,type:'private'},
    from:{id:12345678},text:'/status'}}]:true;
   return {ok:true,json:async()=>({ok:true,result:data})};
  };
  const bot=new OmegaTelegramBot({directory:dir,env,fetchImpl,WebSocketCtor:class {}});
  await bot.pollOnce();
  assert.equal(bot.paper.state.telegramOffset,43);
  assert.equal(new TelegramDemoEngine({directory:dir,now:()=>START}).state.telegramOffset,43);
 }finally{cleanup(dir)}
});
test('no private Bybit exchange URLs, live order keys or live trading permissions in Telegram sources',()=>{
 for(const file of ['lib/telegram-demo-engine.js','lib/telegram-demo-bot.js']){
  const s=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  for(const forbidden of ['/v5/order/create','BYBIT_LIVE_API_KEY','BYBIT_LIVE_API_SECRET','OMEGA_LIVE_ORDERS_ENABLED']){
   assert.ok(!s.includes(forbidden),file+' must not contain '+forbidden);
  }
 }
});
