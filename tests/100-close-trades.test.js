'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Demo=require('../static/demo-seconds-account'),Shadow=require('../static/seconds-shadow');
const Paper=require('../lib/paper-engine');
const {factory}=require('../lib/live-position-close')._test;
const now=1800000004000;
const event=(symbol,score)=>({symbol,state:'WATCH',side:'BUY',score});
const quote=(t,price=100)=>({bidVwap:price-.01,askVwap:price+.01,notional:100,observedAt:t,requiredMoveBps:24});
const env={OMEGA_SESSION_SECRET:'s'.repeat(64)};
const auth={isAuthed:req=>req.headers.cookie?.includes('session=stub'),assertOrigin:req=>{if(req.headers.origin!=='https://site.test'||req.headers['x-omega-request']!=='1')throw Object.assign(Error('CSRF'),{status:403})}};
const request=body=>({method:'POST',headers:{cookie:'__Host-omega_demo_session=stub; session=stub',origin:'https://site.test','x-omega-request':'1'},body});
async function call(handler,body){const res={code:200,setHeader(){return this},status(v){this.code=v;return this},json(v){this.data=v;return this}};await handler(request(body),res);return res}
const position=(size='1')=>({symbol:'XRPUSDT',side:'Buy',size,avgPrice:'100',markPrice:'100',positionIdx:0});
test('automatic demo positions use exactly $100 from $1500 virtual balances',()=>{
 assert.equal(Paper.MIN_NOTIONAL_USD,100);
 assert.equal(Demo.SMALL_TRADE_USD,100);
 const s=Demo.smallInitial(now);
 assert.equal(s.starting,1500);assert.equal(Paper.initial().starting,1500);
 const q={BTCUSDT:quote(now),ETHUSDT:quote(now)};
 const output=Demo.step(s,{now,signals:[event('BTCUSDT',90),event('ETHUSDT',80)],quotes:q});
 assert.equal(Shadow.openList(output.account.ledger).length,2);
 assert.equal(Shadow.openList(output.account.ledger)[0].notional,100);
 assert.equal(Shadow.openList(output.account.ledger)[1].notional,100);
 const futures=Paper.open(Paper.initial(),{BTC:100},{symbol:'BTC',side:'BUY',auto:true,notional:100});
 assert.equal(futures.positions[0].notional,100);
});
test('closing one virtual scalp leaves every other virtual position open and credits only actual modeled exit',()=>{
 const q={BTCUSDT:quote(now),ETHUSDT:quote(now)},signals=[event('BTCUSDT',90),event('ETHUSDT',80)];
 const before=Demo.step(Demo.smallInitial(now),{now,signals,quotes:q}).account;
 const old=Shadow.openList(before.ledger),net=Shadow.pnl(old[0],quote(now+1000,101));
 const after=Demo.closeOne(before,'BTCUSDT',quote(now+1000,101),now+1000);
 assert.equal(Shadow.openList(after.ledger).length,1);
 assert.equal(Shadow.openList(after.ledger)[0].symbol,'ETHUSDT');
 assert.equal(after.closedTrades,1);
 assert.ok(Math.abs(after.cash-(before.cash+Number(net.toFixed(4))))<.00001);
 assert.throws(()=>Demo.closeOne(after,'ETHUSDT',quote(now,100),now+6000),/fresh executable/i);
 assert.throws(()=>Demo.closeOne(after,'BTCUSDT',quote(now+1000,101),now+1000),/no longer open/i);
});
test('real Close preview requires signed owner session, preserves order-free preview, then sends exact reduce-only close once',async()=>{
 const calls=[],broker={ready:()=>true,
  snapshot:async()=>({equity:1000,available:500,positions:[position()],pending:[],pnlToday:0}),
  order:async()=>null,
  close:async(p,link)=>{calls.push({p,link});return {orderId:'bybit-close-1'}}
 };
 const handler=factory({broker,authentication:auth,env,clock:()=>now});
 const preview=await call(handler,{action:'preview_close',symbol:'XRPUSDT'});
 assert.equal(preview.code,200);assert.equal(preview.data.side,'Buy');assert.equal(calls.length,0);
 assert.equal((await call(handler,{action:'close_position',symbol:'XRPUSDT',previewToken:preview.data.previewToken,confirm:'BAD'})).code,400);
 const close=await call(handler,{action:'close_position',symbol:'XRPUSDT',previewToken:preview.data.previewToken,confirm:'CLOSE REAL XRPUSDT'});
 assert.equal(close.code,202);assert.equal(close.data.submitted,true);
 assert.equal(calls.length,1);assert.deepEqual(calls[0].p,{symbol:'XRPUSDT',side:'Buy',size:'1'});
 assert.ok(calls[0].link.startsWith('omclose'));
});
test('real close must re-check same position, reject invalidated size and uncertain reconciliation',async()=>{
 let size='1',prior=null,closes=0;
 const broker={ready:()=>true,snapshot:async()=>({equity:1000,available:500,positions:[position(size)],pending:[],pnlToday:0}),order:async()=>prior,close:async()=>{closes++;return {orderId:'X'}}};
 const h=factory({broker,authentication:auth,env,clock:()=>now});
 const first=(await call(h,{action:'preview_close',symbol:'XRPUSDT'})).data;
 size='2';
 assert.equal((await call(h,{action:'close_position',symbol:'XRPUSDT',previewToken:first.previewToken,confirm:'CLOSE REAL XRPUSDT'})).code,409);
 size='1';prior={orderStatus:'Filled'};
 assert.equal((await call(h,{action:'close_position',symbol:'XRPUSDT',previewToken:first.previewToken,confirm:'CLOSE REAL XRPUSDT'})).code,409);
 assert.equal(closes,0);
});
test('real close does not require or create a funded ENTRY order',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../lib/live-position-close.js'),'utf8');
 assert.match(source,/broker\.close\(/);assert.doesNotMatch(source,/broker\.enter\(/);
 const api=require('node:fs').readFileSync(require('node:path').join(__dirname,'../api/auto-live.js'),'utf8');
 assert.match(api,/preview_close/);assert.match(api,/close_position/);
});
