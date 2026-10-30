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
 async enter(ticket,link){this.sent.push({ticket,link});if(this.timeout)throw Error('Network timed out after submission');this.orders.push({symbol:ticket.symbol,side:ticket.side,orderLinkId:link,orderStatus:'Filled',cumExecQty:ticket.qty,leavesQty:'0'});this.s.positions=[{symbol:ticket.symbol,side:ticket.side,size:ticket.qty,stopLoss:ticket.stopLoss,takeProfit:ticket.takeProfit,markPrice:String(ticket.price),avgPrice:String(ticket.price)}]}
 async order(symbol,link){return this.orders.find(x=>x.orderLinkId===link)||null}
 async close(position,link){this.sent.push({close:true,link})}
}
function setup(t,options={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'omega-worker-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const broker=new FakeBroker(),env={OMEGA_LIVE_ORDERS_ENABLED:'true',...options};return {directory,broker,env,worker:new TradingWorker({directory,broker,env,analyze:async()=>({eligible:true,rank:10,side:'BUY',price:candles().at(-1)[4],atr:.44,stopPct:.6,targetNet:.1,barTime:candles().at(-1)[0],observedAt:Date.now(),expiresAt:Date.now()+10000,checks:[{label:'Injected strategy fixture',pass:true}],metrics:{},validation:{tradeCount:24,passed:true}})})}}
const activate=w=>w.control({action:'start',confirm:'START REAL $10 BOT',dailyLimit:1});
test('activation requires exact confirmation, server switch and strict loss cap',async t=>{
 const {worker,env}=setup(t);assert.equal(worker.status().active,false);
 await assert.rejects(worker.control({action:'start',confirm:'yes',dailyLimit:1}),/Type START/);
 await assert.rejects(worker.control({action:'start',confirm:'START REAL $10 BOT',dailyLimit:100}),/Daily loss/);
 env.OMEGA_LIVE_ORDERS_ENABLED='false';await assert.rejects(activate(worker),/switch/);
});
test('a live entry is reconciled and may reenter after closing without a candle cooldown',async t=>{
 const {worker,broker}=setup(t);await activate(worker);await worker.cycle();assert.equal(broker.sent.length,1);assert.equal(worker.status().pending,true);
 await worker.cycle();assert.equal(worker.status().pending,false);assert.equal(worker.status().managed.length,1);
 broker.s.positions=[];await worker.cycle();assert.equal(worker.status().managed.length,0);assert.equal(broker.sent.length,2);
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
test('partial fill growth stays pending and terminal fill updates managed size',async t=>{
 const {worker,broker}=setup(t);await activate(worker);await worker.cycle();
 broker.orders[0].orderStatus='PartiallyFilled';broker.orders[0].cumExecQty='.03';broker.orders[0].leavesQty='.06';broker.s.positions[0].size='.03';
 await worker.cycle();assert.equal(worker.status().pending,true);assert.equal(worker.status().active,false);assert.equal(worker.state.managed[0].qty,'.03');
 broker.orders[0].orderStatus='Filled';broker.orders[0].cumExecQty='.09';broker.orders[0].leavesQty='0';broker.s.positions[0].size='.09';
 await worker.cycle();assert.equal(worker.status().pending,false);assert.equal(worker.state.managed[0].qty,'.09');assert.equal(broker.sent.length,1);
});
test('Cancelled and PartiallyFilledCanceled entries with actual fills are managed',async t=>{
 for(const status of ['Cancelled','PartiallyFilledCanceled']){
  const {worker,broker}=setup(t);await activate(worker);await worker.cycle();broker.orders[0].orderStatus=status;broker.orders[0].cumExecQty='.03';broker.orders[0].leavesQty='0';broker.s.positions[0].size='.03';
  await worker.cycle();assert.equal(worker.status().pending,false);assert.equal(worker.state.managed[0].qty,'.03');assert.equal(broker.sent.length,1);
 }
});
test('an uncertain order does not bypass protective checks for a discovered fill',async t=>{
 const {worker,broker}=setup(t);broker.timeout=true;await activate(worker);await worker.cycle();
 const ticket=broker.sent[0].ticket;broker.s.positions=[{symbol:ticket.symbol,side:ticket.side,size:ticket.qty,markPrice:String(ticket.price),avgPrice:String(ticket.price),stopLoss:'0',takeProfit:ticket.takeProfit}];
 await worker.cycle();await worker.cycle();assert.equal(worker.status().pending,true);assert.equal(broker.sent.filter(x=>x.close).length,1);assert.equal(worker.status().active,false);
});
test('positive but widened, infinite, or wrong-side protection triggers one emergency close',async t=>{
 for(const mutate of [p=>p.stopLoss='50',p=>p.stopLoss='Infinity',p=>p.takeProfit='100']){
  const {worker,broker}=setup(t);await activate(worker);await worker.cycle();await worker.cycle();mutate(broker.s.positions[0]);await worker.cycle();await worker.cycle();
  assert.equal(broker.sent.filter(x=>x.close).length,1);assert.equal(worker.status().active,false);
 }
});
test('a legitimately tightened protective stop is retained',async t=>{
 const {worker,broker}=setup(t);await activate(worker);await worker.cycle();await worker.cycle();broker.s.positions[0].markPrice='109';broker.s.positions[0].stopLoss='108';await worker.cycle();
 assert.equal(broker.sent.filter(x=>x.close).length,0);assert.equal(worker.status().managed.length,1);
});
test('malformed persisted limits fail closed and writes leave a private complete ledger',t=>{
 const {worker,broker,directory,env}=setup(t),file=path.join(directory,'state.json');
 assert.equal(fs.statSync(file).mode&0o777,0o600);assert.deepEqual(fs.readdirSync(directory),['state.json']);
 const state=JSON.parse(fs.readFileSync(file));state.dailyLimit=null;fs.writeFileSync(file,JSON.stringify(state));
 assert.throws(()=>new TradingWorker({directory,broker,env}),/state is invalid/);
});
test('order reconciliation verifies identity and a nonnegative executed quantity',async()=>{
 const broker=new LiveBroker();broker.request=async()=>({list:[{symbol:'OTHERUSDT',side:'Buy',orderLinkId:'another-link',orderStatus:'Filled',cumExecQty:'1'}]});
 await assert.rejects(broker.order('XRPUSDT','intended-link'),/identity/);
 broker.request=async()=>({list:[{symbol:'XRPUSDT',side:'Buy',orderLinkId:'intended-link',orderStatus:'Filled',cumExecQty:'NaN'}]});
 await assert.rejects(broker.order('XRPUSDT','intended-link'),/risk value/);
});
test('rounded live quantity targets estimated net profit using actual notional',async()=>{
 const broker=new LiveBroker();broker.request=async(method,route)=>route.includes('instruments')?{list:[{symbol:'XRPUSDT',quoteCoin:'USDT',contractType:'LinearPerpetual',status:'Trading',lotSizeFilter:{qtyStep:'3',minOrderQty:'3',maxMktOrderQty:'100',minNotionalValue:'5'},priceFilter:{tickSize:'.0001'}}]}:{list:[{symbol:'XRPUSDT',ask1Price:'1',bid1Price:'.9999',markPrice:'1'}]};
 const ticket=await broker.ticket('XRPUSDT','Buy',{price:1,stopPct:1,targetNet:.15});assert.equal(ticket.notional,9);
 const gross=(Number(ticket.takeProfit)-ticket.price)*Number(ticket.qty),exitFeeIncrement=(Number(ticket.takeProfit)-ticket.price)*Number(ticket.qty)*.0006;
 assert.ok(gross-ticket.notional*ticket.estimatedRoundTripCostRate-exitFeeIncrement>=.15-1e-9);
 await assert.rejects(broker.ticket('XRPUSDT','Buy',{price:NaN,stopPct:1,targetNet:.15}),/execution plan/);
});
test('unavailable order lookup still protects a discoverable partial fill',async t=>{
 const {worker,broker}=setup(t);await activate(worker);await worker.cycle();
 broker.order=async()=>{throw Error('Order lookup unavailable')};broker.s.positions[0].stopLoss='0';
 await worker.cycle();assert.equal(worker.status().active,false);assert.equal(broker.sent.filter(x=>x.close).length,1);
});
test('incomplete advanced evidence blocks entry without falling back to a simple strategy',async t=>{
 const {worker,broker}=setup(t);worker.analyze=async()=>({eligible:false,side:'BUY',reason:'Order-book evidence missing',checks:[{label:'Fresh executable depth',pass:false}]});
 await activate(worker);await worker.cycle();assert.equal(broker.sent.length,0);assert.equal(worker.status().active,true);assert.match(worker.status().decisions[0].reason,/missing/);
});
test('an expired decision cannot submit a new live order',async t=>{
 const {worker,broker}=setup(t),analyze=worker.analyze;worker.analyze=async symbol=>({...await analyze(symbol),expiresAt:Date.now()-1});
 await activate(worker);await worker.cycle();assert.equal(broker.sent.length,0);assert.equal(worker.status().active,false);assert.match(worker.status().message,/expired/);
});
test('liquid markets are deeply analyzed even without a 24h directional watch label',async t=>{
 const {worker,broker}=setup(t),markets=broker.markets.bind(broker);broker.markets=async()=>{const rows=await markets();rows[0].price24hPcnt='0';return rows};
 await activate(worker);await worker.cycle();assert.equal(broker.sent.length,1);assert.equal(worker.status().coverage.checked,1);
});
test('a second same-direction strongly correlated position is blocked',async t=>{
 const {worker,broker}=setup(t);await activate(worker);await worker.cycle();await worker.cycle();
 const markets=broker.markets.bind(broker),analyze=worker.analyze;
 broker.markets=async()=>{const rows=await markets();rows[0].symbol='ALTUSDT';return rows};
 worker.analyze=async symbol=>({...await analyze(symbol),metrics:{benchmarkCorrelation:.95}});
 await worker.cycle();assert.equal(broker.sent.length,1);assert.equal(worker.status().coverage.complete,true);
});
test('old saved holding limits never trigger a live close while profit/stop protection remains active',async t=>{
 const {worker,broker}=setup(t);await activate(worker);await worker.cycle();await worker.cycle();
 worker.state.managed[0].openedAt=Date.now()-24*60*60000;worker.state.managed[0].maximumHoldMinutes=30;await worker.control({action:'pause'});
 await worker.cycle();await worker.cycle();assert.equal(broker.sent.filter(x=>x.close).length,0);assert.equal(worker.status().active,false);assert.ok(Number(broker.s.positions[0].stopLoss)>0);assert.ok(Number(broker.s.positions[0].takeProfit)>0);
});
test('terminal partially-filled cancellation is not an outstanding entry order',async()=>{
 const broker=new LiveBroker();broker.request=async(method,route)=>{
  if(route.includes('wallet'))return {list:[{accountType:'UNIFIED',totalEquity:'100',totalAvailableBalance:'100'}]};
  if(route.includes('realtime'))return {list:[{orderStatus:'PartiallyFilledCanceled',reduceOnly:false}]};
  return {list:[]};
 };
 const s=await broker.snapshot();assert.equal(s.pending.length,0);
});
test('live worker scans past the first eight pairs and enters the highest-ranked qualified market',async t=>{
 const {worker,broker}=setup(t),oldMarkets=broker.markets.bind(broker),analyze=worker.analyze;
 broker.markets=async()=>{const [r]=await oldMarkets();return Array.from({length:12},(_,i)=>({...r,symbol:'PAIR'+i+'USDT'}))};
 worker.analyze=async symbol=>({...await analyze(symbol),rank:Number(symbol.match(/\d+/)[0])});
 await activate(worker);await worker.cycle();assert.equal(broker.sent[0].ticket.symbol,'PAIR11USDT');assert.equal(worker.status().coverage.checked,12);
});
test('a demo forward-test plan cannot authorize an order from the real worker',async t=>{
 const {worker,broker}=setup(t),original=worker.analyze;
 worker.analyze=async()=>({...await original(),executionPolicy:'DEMO_FORWARD_TEST'});
 await activate(worker);await worker.cycle();assert.equal(broker.sent.length,0);assert.equal(worker.status().active,false);assert.match(worker.status().message,/Demo forward-test decisions cannot authorize real orders/);
});
test('a candidate whose direction flips during the fresh check cannot enter',async t=>{
 const {worker,broker}=setup(t),original=worker.analyze;let calls=0;
 worker.analyze=async()=>({...await original(),side:++calls===1?'BUY':'SELL'});
 await activate(worker);await worker.cycle();assert.equal(broker.sent.length,0);
});
