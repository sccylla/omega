'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {factory,makePreview,verifyPreview,risk,idForBar}=require('../api/manual-live')._test;
const env={OMEGA_MANUAL_LIVE_ORDERS_ENABLED:'true',OMEGA_SESSION_SECRET:'z'.repeat(64)};
const current=Date.now(),bar=Math.floor((current-500000)/300000)*300000;
const plan={symbol:'XRPUSDT',side:'BUY',eligible:true,executionPolicy:'LIVE_STRICT',barTime:bar,expiresAt:current+50000,reason:'Verified trend and cost checks',price:1.01,targetNet:0.12};
function fake(){let writes=[],snapshots=0;const broker={ready:()=>true,snapshot:async()=>{snapshots++;return{equity:100,available:50,pnlToday:0,positions:[],pending:[]}},ticket:async()=>({symbol:'XRPUSDT',side:'Buy',qty:'9.90',price:1.01,notional:9.999,stopLoss:'1.005',takeProfit:'1.04',estimatedRoundTripCostRate:.0022}),leverage:async()=>{writes.push('leverage')},enter:async(ticket,link)=>{writes.push({ticket,link});return{orderId:'accepted'}},order:async()=>({orderStatus:'New'})};return{broker,writes,get snapshots(){return snapshots}}}
function responder(){const r={statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},json(v){this.payload=v;return this}};return r}
const auth={isAuthed:r=>r.headers?.cookie==='session',assertOrigin:r=>{if(r.headers?.origin!=='https://example.test'||r.headers?.['x-omega-request']!=='1')throw Object.assign(Error('Origin denied'),{status:403})}};
async function call(handler,body,{method='POST',cookie='session',origin='https://example.test'}={}){const req={method,body,headers:{cookie,origin,'x-omega-request':'1'}};const res=responder();await handler(req,res);return res}
test('signed preview cannot be edited, replayed after expiration, or forged',()=>{
 const token=makePreview({symbol:'XRPUSDT',side:'BUY',barTime:bar,price:1.01,stopLoss:1.005,takeProfit:1.04},env,current);
 assert.equal(verifyPreview(token,env,current+100).symbol,'XRPUSDT');
 assert.throws(()=>verifyPreview(token.slice(0,-2)+'ab',env,current),/not issued|signature/);
 assert.throws(()=>verifyPreview(token,env,current+61000),/expired/);
 assert.equal(idForBar(bar,env),idForBar(bar,env));
 assert.notEqual(idForBar(bar,env),idForBar(bar+300000,env));
});
test('preview never writes to live Bybit and requires authenticated same-origin session',async()=>{
 const f=fake(),h=factory({env,broker:f.broker,analyze:async()=>plan,authentication:auth,clock:()=>current});
 const denied=await call(h,{action:'preview',symbol:'XRPUSDT'},{cookie:'none'});
 assert.equal(denied.statusCode,401);
 const forbidden=await call(h,{action:'preview',symbol:'XRPUSDT'},{origin:'https://evil.test'});
 assert.equal(forbidden.statusCode,403);
 const good=await call(h,{action:'preview',symbol:'XRPUSDT'});
 assert.equal(good.statusCode,200);assert.equal(good.payload.notional,9.999);assert.equal(f.writes.length,0);
});
test('execution requires signed preview, exact confirmation and another strict fresh decision',async()=>{
 const f=fake(),h=factory({env,broker:f.broker,analyze:async()=>plan,authentication:auth,clock:()=>current});
 const preview=(await call(h,{action:'preview',symbol:'XRPUSDT'})).payload;
 const missing=await call(h,{action:'execute',confirm:'yes',previewToken:preview.previewToken});
 assert.equal(missing.statusCode,400);assert.equal(f.writes.length,0);
 const submitted=await call(h,{action:'execute',confirm:'PLACE REAL $10 TRADE',previewToken:preview.previewToken});
 assert.equal(submitted.statusCode,202);assert.equal(submitted.payload.orderStatus,'New');
 assert.deepEqual(f.writes.map(x=>typeof x==='string'?x:'enter'),['leverage','enter']);
 assert.equal(f.writes[1].ticket.takeProfit,'1.04');assert.equal(f.writes[1].ticket.stopLoss,'1.005');
});
test('no switch, stale signal, broker exposure and low equity always block funded orders',async()=>{
 for(const version of [
 {env:{...env,OMEGA_MANUAL_LIVE_ORDERS_ENABLED:'false'}},
 {analyze:async()=>({...plan,executionPolicy:'DEMO_FORWARD_TEST'})},
 {analyze:async()=>({...plan,eligible:false,reason:'No signal'})},
 {broker:{snapshot:async()=>({equity:40,available:35,pnlToday:0,positions:[],pending:[]})}},
 {broker:{snapshot:async()=>({equity:100,available:50,pnlToday:0,positions:[{symbol:'BTCUSDT'}],pending:[]})}}
 ]){
  const f=fake(),broker={...f.broker,...version.broker},h=factory({env:version.env||env,broker,analyze:version.analyze||(async()=>plan),authentication:auth,clock:()=>current});
  const r=await call(h,{action:'preview',symbol:'XRPUSDT'});assert.notEqual(r.statusCode,200);assert.equal(f.writes.length,0);
 }
});
test('cost-adjusted stop exposure and daily losses are enforced',()=>{
 const ticket={price:1.01,qty:'9.9',stopLoss:'0.98',notional:10,estimatedRoundTripCostRate:.0022};
 assert.throws(()=>risk({equity:50,available:15,pnlToday:0,positions:[],pending:[]},ticket),/risk/);
 assert.throws(()=>risk({equity:100,available:15,pnlToday:-1,positions:[],pending:[]},ticket),/Daily loss/);
 assert.throws(()=>risk({equity:100,available:15,pnlToday:0,positions:[],pending:[{}]},ticket),/pending/);
});
test('get status does not activate or trade',async()=>{
 const f=fake(),h=factory({env,broker:f.broker,analyze:async()=>plan,authentication:auth,clock:()=>current});
 const r=await call(h,null,{method:'GET'});assert.equal(r.statusCode,200);assert.equal(r.payload.mode,'MANUAL_LIVE_ONLY');assert.equal(f.writes.length,0);
});
