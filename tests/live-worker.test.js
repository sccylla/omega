'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {TradingWorker,setController}=require('../lib/trading-worker'),{LiveBroker}=require('../lib/live-broker');
const candles=()=>{const now=Math.floor(Date.now()/300000)*300000;return Array.from({length:100},(_,i)=>{const c=100+i*.08+Math.sin(i*.7)*.05;return [now-(100-i)*300000,c-.02,c+.22,c-.22,c,1000]})};
class FakeBroker{
 constructor(){this.sent=[];this.orders=[];this.s={equity:1000,available:1000,positions:[],pending:[],pnlToday:0};this.timeout=false}
 ready(){return true}async snapshot(){return structuredClone(this.s)}
 async markets(){return [{symbol:'XRPUSDT',lastPrice:'107.9',bid1Price:'107.89',ask1Price:'107.9',turnover24h:'100000000',price24hPcnt:'.05',fundingRate:'.0001'}]}
 async candles(){return candles()}async ticket(symbol,side,plan){return {symbol,side,qty:'.09',price:plan.price,notional:9.8,stopLoss:'106',takeProfit:'110'}}
 async leverage(){}
 async enter(ticket,link){this.sent.push({ticket,link});if(this.timeout)throw Error('Network timed out after submission');this.orders.push({orderLinkId:link,orderStatus:'Filled'});this.s.positions=[{symbol:ticket.symbol,side:ticket.side,size:ticket.qty,stopLoss:ticket.stopLoss,takeProfit:ticket.takeProfit,markPrice:String(ticket.price)}]}
 async order(symbol,link){return this.orders.find(x=>x.orderLinkId===link)||null}
 async close(position,link){this.sent.push({close:true,link})}
}
function setup(t,options={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'omega-worker-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const broker=new FakeBroker(),env={OMEGA_LIVE_ORDERS_ENABLED:'true',...options};return {directory,broker,env,worker:new TradingWorker({directory,broker,env})}}
const activate=w=>w.control({action:'start',confirm:'START REAL $10 BOT',dailyLimit:1});
test('activation requires exact confirmation, server switch and strict loss cap',async t=>{
 const {worker,env}=setup(t);assert.equal(worker.status().active,false);
 await assert.rejects(worker.control({action:'start',confirm:'yes',dailyLimit:1}),/Type START/);
 await assert.rejects(worker.control({action:'start',confirm:'START REAL $10 BOT',dailyLimit:100}),/Daily loss/);
 env.OMEGA_LIVE_ORDERS_ENABLED='false';await assert.rejects(activate(worker),/switch/);
});
test('a successful live entry is reconciled and cannot reopen on the same candle',async t=>{
 const {worker,broker}=setup(t);await activate(worker);await worker.cycle();assert.equal(broker.sent.length,1);assert.equal(worker.status().pending,true);
 await worker.cycle();assert.equal(worker.status().pending,false);assert.equal(worker.status().managed.length,1);
 broker.s.positions=[];await worker.cycle();assert.equal(worker.status().managed.length,0);assert.equal(broker.sent.length,1);
});
test('ambiguous entry survives restart without resubmitting',async t=>{
 const {worker,broker,env,directory}=setup(t);broker.timeout=true;await activate(worker);await worker.cycle();assert.equal(broker.sent.length,1);assert.equal(worker.status().active,false);
 const restarted=new TradingWorker({directory,broker,env});assert.equal(restarted.status().pending,true);await restarted.cycle();assert.equal(broker.sent.length,1);await assert.rejects(activate(restarted),/unresolved/);
});
test('daily drawdown and other account exposure prevent orders',async t=>{
 const {worker,broker}=setup(t);await activate(worker);broker.s.pnlToday=-1;await worker.cycle();assert.equal(worker.status().active,false);assert.equal(broker.sent.length,0);
 broker.s.pnlToday=0;broker.s.positions=[{symbol:'OTHERUSDT'}];await assert.rejects(activate(worker),/unmanaged/);
});
test('missing protection submits only one durable reduce-only close intent',async t=>{
 const {worker,broker}=setup(t);await activate(worker);await worker.cycle();await worker.cycle();broker.s.positions[0].stopLoss='0';await worker.cycle();await worker.cycle();
 assert.equal(broker.sent.filter(x=>x.close).length,1);assert.equal(worker.status().active,false);
});
test('pause stops new entries and a restart always disarms',async t=>{
 const {worker,broker,env,directory}=setup(t);await activate(worker);await worker.control({action:'pause'});await worker.cycle();assert.equal(broker.sent.length,0);
 await activate(worker);const fresh=new TradingWorker({directory,broker,env});assert.equal(fresh.status().active,false);
});
test('broker signs the exact live request and refuses arbitrary operations',async()=>{
 const env={BYBIT_LIVE_API_KEY:'fixture-key',BYBIT_LIVE_API_SECRET:'fixture-secret'};let captured;
 const broker=new LiveBroker({env,fetcher:async(url,options)=>{captured={url,options};return {ok:true,json:async()=>({retCode:0,time:Date.now(),result:{}})}}});
 await broker.request('GET','/v5/account/wallet-balance',{accountType:'UNIFIED'});
 const h=captured.options.headers;assert.equal(captured.url,'https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED');
 assert.equal(h['X-BAPI-SIGN'],crypto.createHmac('sha256',env.BYBIT_LIVE_API_SECRET).update(h['X-BAPI-TIMESTAMP']+'fixture-key5000accountType=UNIFIED').digest('hex'));
 await assert.rejects(broker.request('POST','/v5/asset/withdraw/create'),/not allowed/);
 await broker.close({symbol:'XRPUSDT',side:'Buy',size:1},'fixture-close');const body=JSON.parse(captured.options.body);assert.equal(body.reduceOnly,true);assert.equal(body.side,'Sell');
});
test('live sizing rounds down and skips exchange minimums exceeding $10',async()=>{
 const broker=new LiveBroker();let minimum='5';broker.request=async(method,route)=>route.includes('instruments')?{list:[{symbol:'XRPUSDT',quoteCoin:'USDT',contractType:'LinearPerpetual',status:'Trading',lotSizeFilter:{qtyStep:'.1',minOrderQty:'.1',maxMktOrderQty:'100',minNotionalValue:minimum},priceFilter:{tickSize:'.001'}}]}:{list:[{symbol:'XRPUSDT',ask1Price:'1.003',bid1Price:'1.0029',markPrice:'1.003'}]};
 const ticket=await broker.ticket('XRPUSDT','Buy',{price:1.003,stopPct:1,targetNet:.15});assert.ok(ticket.notional<=10);assert.ok(ticket.notional>=5);assert.ok(Number(ticket.stopLoss)<ticket.price&&Number(ticket.takeProfit)>ticket.price);
 minimum='11';await assert.rejects(broker.ticket('XRPUSDT','Buy',{price:1.003,stopPct:1,targetNet:.15}),/minimum/);
});
test('bot controls reject unauthenticated calls even if a worker is installed',async()=>{
 setController({control(){throw Error('Must not reach worker')}});const handler=require('../api/bot'),res={setHeader(){},status(n){this.code=n;return this},json(d){this.body=d;return this}};
 try{await handler({method:'POST',headers:{},body:{action:'start'}},res);assert.equal(res.code,401)}finally{setController(null)}
});
test('per-trade risk and remaining dollar budget are checked before submission',async t=>{
 const {worker,broker}=setup(t);broker.s.equity=50;broker.s.available=50;await activate(worker);await worker.cycle();assert.equal(broker.sent.length,0);assert.match(worker.status().message,/stop risk/);
 broker.s.equity=1000;broker.s.available=1000;
 await worker.control({action:'start',confirm:'START REAL $10 BOT',dailyLimit:.1});await worker.cycle();assert.equal(broker.sent.length,0);assert.match(worker.status().message,/budget/);
});
test('broker fails on stale successful responses and incomplete account pages',async()=>{
 const broker=new LiveBroker({env:{BYBIT_LIVE_API_KEY:'fixture-key',BYBIT_LIVE_API_SECRET:'fixture-secret'},fetcher:async()=>({ok:true,json:async()=>({retCode:0,time:Date.now()-60000,result:{}})})});
 await assert.rejects(broker.request('GET','/v5/account/wallet-balance'),/stale/);
 broker.request=async()=>({list:[],nextPageCursor:'more'});await assert.rejects(broker.snapshot(),/pagination/);
});
test('authenticated bot control still requires a same-origin CSRF request',async()=>{
 const auth=require('../lib/bybit-demo'),handler=require('../api/bot');
 const before=[process.env.OMEGA_DASHBOARD_PASSWORD,process.env.OMEGA_SESSION_SECRET];
 process.env.OMEGA_DASHBOARD_PASSWORD='fixture-password-only';process.env.OMEGA_SESSION_SECRET='fixture-session-signing-key-not-a-real-secret';
 let calls=0;setController({control:async()=>{calls++;return {active:false}}});
 const cookie=auth.COOKIE+'='+auth.cookieValue();
 const res=()=>({setHeader(){},status(n){this.code=n;return this},json(d){this.body=d;return this}});
 try{
  const denied=res();await handler({method:'POST',headers:{cookie,host:'desk.example',origin:'https://elsewhere.example','x-omega-request':'1'},body:{action:'pause'}},denied);assert.equal(denied.code,403);assert.equal(calls,0);
  const ok=res();await handler({method:'POST',headers:{cookie,host:'desk.example',origin:'https://desk.example','x-omega-request':'1'},body:{action:'pause'}},ok);assert.equal(ok.code,200);assert.equal(calls,1);
 }finally{setController(null);for(const [i,key] of ['OMEGA_DASHBOARD_PASSWORD','OMEGA_SESSION_SECRET'].entries()){if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i]}}
});
test('pause during a market request prevents the later entry and overlapping cycles are skipped',async t=>{
 const {worker,broker}=setup(t);let release,started;
 const began=new Promise(resolve=>started=resolve),wait=new Promise(resolve=>release=resolve),markets=broker.markets.bind(broker);
 broker.markets=async()=>{started();await wait;return markets()};await activate(worker);
 const cycle=worker.cycle();await began;
 await worker.cycle(); // Must resolve without queuing another slow scan.
 await worker.control({action:'pause'});release();await cycle;
 assert.equal(broker.sent.length,0);assert.equal(worker.status().active,false);
});
