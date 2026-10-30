'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../static/seconds-engine'),S=require('../static/seconds-shadow');
const FIRST=Date.UTC(2026,9,30,12,0,0),SECOND=1000;
function makeBook(symbol,now,price,seq,{wide=false,imbalance=.43}={}){
 const half=wide?1:.009;const bid=price-half,ask=price+half;
 const bids=Array.from({length:6},(_,i)=>[(bid-i*.004).toFixed(5),String(90)]),
       asks=Array.from({length:6},(_,i)=>[(ask+i*.004).toFixed(5),String(40)]);
 return {topic:'orderbook.50.'+symbol,ts:now,type:'snapshot',data:{s:symbol,b:bids,a:asks,u:seq,seq}};
}
function makeTrade(symbol,now,seq,side='Buy'){
 return {topic:'publicTrade.'+symbol,ts:now,type:'snapshot',data:[{T:now,s:symbol,S:side,v:'1.9',p:'100.04',i:'trade-'+seq}]};
}
function rise(){
 const symbol='XRPUSDT',m=E.create([symbol]);let current=FIRST;
 for(let i=0;i<35;i++){
  current=FIRST+i*SECOND;
  assert.equal(m.ingest(makeBook(symbol,current,100+i*.055,i+1),current),true);
  m.ingest(makeTrade(symbol,current,i,'Buy'),current);
 }
 return {m,symbol,current};
}
test('seconds engine validates symbols and never accepts unlisted/duplicated pairs',()=>{
 assert.deepEqual(E.validSymbols('BTCUSDT, ETHUSDT'),['BTCUSDT','ETHUSDT']);
 assert.throws(()=>E.validSymbols('BTCUSDT,BTCUSDT'),/unique/);
 assert.throws(()=>E.validSymbols('BTCUSDT,../../'),/USDT futures/);
 assert.throws(()=>E.validSymbols('AUSDT,BUSDT,CUSDT,DUSDT,EUSDT,FUSDT'),/1–5/);
});
test('fresh rising price, low spread, deep book and buyer aggressor produce a qualified research WATCH',()=>{
 const {m,symbol,current}=rise(),o=m.observation(symbol,current+100);
 assert.equal(o.state,'WATCH',JSON.stringify(o.reasons));
 assert.equal(o.side,'BUY');
 assert.ok(o.move5Bps>0&&o.move15Bps>0&&o.range30Bps>o.requiredMoveBps);
 assert.ok(o.spreadBps<4&&o.roundTripImpactBps<12);
 assert.ok(o.flowPressure>.9&&o.imbalance>.06);
 assert.equal(o.notional,90);
 assert.ok(o.requiredMoveBps>65);
 assert.equal(m.history(symbol).length,35);
 assert.match(o.meaning,/NOT a forecast/);
});
test('stale book, no trades, wide spread, weak depth and out-of-order messages cannot authorize a scalp',()=>{
 const m=E.create(['XRPUSDT']);let current=FIRST;
 for(let i=0;i<35;i++){current=FIRST+i*SECOND;m.ingest(makeBook('XRPUSDT',current,100+i*.055,i+1),current)}
 const noTrades=m.observation('XRPUSDT',current+100);
 assert.notEqual(noTrades.state,'WATCH');assert.match(noTrades.reason,/matched trades/);
 assert.equal(m.observation('XRPUSDT',current+3000).state,'NO_DATA');
 const bad=makeBook('XRPUSDT',current,101,2);bad.type='delta';
 assert.equal(m.ingest(bad,current),false);
 const wide=E.create(['ETHUSDT']);
 for(let i=0;i<35;i++){const n=FIRST+i*SECOND;wide.ingest(makeBook('ETHUSDT',n,100+i*.055,i+1,{wide:true}),n);wide.ingest(makeTrade('ETHUSDT',n,i,'Buy'),n)}
 assert.notEqual(wide.observation('ETHUSDT',FIRST+34000+100).state,'WATCH');
});
test('only listed symbols and real-time matching engine trade timestamps enter the observation window',()=>{
 const m=E.create(['BTCUSDT']);
 const x=makeBook('BTCUSDT',FIRST,100,1);
 assert.equal(m.ingest(x,FIRST),true);
 assert.equal(m.ingest(makeBook('XRPUSDT',FIRST,100,1),FIRST),false);
 const duplicate=makeTrade('BTCUSDT',FIRST,5);
 m.ingest(duplicate,FIRST);m.ingest(duplicate,FIRST);
 assert.equal(m.observation('BTCUSDT',FIRST+100).matchedTrades15s,1);
 const old=makeTrade('BTCUSDT',FIRST-9000,7);
 assert.equal(m.ingest(old,FIRST),false);
});
test('virtual scalps use executable VWAP, not midprice, and close after net $0.50 or $0.75 stop',()=>{
 const {m,symbol,current}=rise(),o=m.observation(symbol,current+100),q=m.execution(symbol,current+100);
 const start=S.step(S.init(),{signals:[o],quotes:{[symbol]:q},now:current+100,connected:true});
 assert.equal(start.events[0].type,'OPEN');
 assert.ok(start.state.open.entry>=q.ask);
 const nextTime=current+SECOND,downBook=makeBook(symbol,nextTime,99.0,101),upBook=makeBook(symbol,nextTime,105.3,102);
 const other=E.create([symbol]);other.ingest(upBook,nextTime);
 const settled=S.step(start.state,{signals:[],quotes:{[symbol]:other.execution(symbol,nextTime)},now:nextTime,connected:true});
 assert.equal(settled.events[0].type,'CLOSED');
 assert.ok(settled.events[0].trade.net>=.50);
 const record=S.stats(settled.state);
 assert.equal(record.count,1);assert.equal(record.validated,false);
 const down=E.create([symbol]);down.ingest(downBook,nextTime);
 const losing=S.step(start.state,{signals:[],quotes:{[symbol]:down.execution(symbol,nextTime)},now:nextTime,connected:true});
 assert.equal(losing.events[0].type,'CLOSED');
 assert.ok(losing.events[0].trade.net<=-.75);
});
test('virtual disconnect marks an open position incomplete rather than manufacturing a win',()=>{
 const {m,symbol,current}=rise(),o=m.observation(symbol,current+100),q=m.execution(symbol,current+100);
 const start=S.step(S.init(),{signals:[o],quotes:{[symbol]:q},now:current+100,connected:true});
 const failed=S.step(start.state,{signals:[],quotes:{},now:current+3000,connected:false});
 assert.equal(failed.events[0].type,'INCOMPLETE');
 assert.equal(S.stats(failed.state).count,0);
 assert.equal(S.stats(failed.state).incomplete,1);
});
test('public seconds lab cannot call private Bybit exchange API or submit funded orders',()=>{
 const root=path.resolve(__dirname,'..');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),
  client=fs.readFileSync(path.join(root,'static/seconds-lab.js'),'utf8');
 for(const id of ['seconds-lab','seconds-toggle','seconds-pairs','seconds-rows','seconds-chart','seconds-shadow-stats'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(client.includes('wss://stream.bybit.com/v5/public/linear'));
 assert.ok(client.includes("['orderbook.50.'+s,'publicTrade.'+s]"));
 assert.ok(client.includes("omega:account-mode"));
 assert.ok(!client.includes('/v5/order/create')&&!client.includes("action:'enter'")&&!client.includes('BYBIT_LIVE_API_KEY'));
});
