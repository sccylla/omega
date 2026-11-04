'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {factory,issueArm,verifyArm,guardAccount}=require('../api/auto-live')._test;
const env={OMEGA_SMALL_LIVE_ORDERS_ENABLED:'true',OMEGA_BROWSER_AUTOLIVE_ENABLED:'true',OMEGA_SESSION_SECRET:'q'.repeat(64)};
const now=1800000005000,bar=Math.floor((now-300000)/300000)*300000;
const auth={getCookie:r=>r.headers.cookie==='owner'?'owner':null,isAuthed:r=>r.headers.cookie==='owner',assertOrigin:r=>{if(r.headers.origin!=='https://example.test'||r.headers['x-omega-request']!=='1')throw Object.assign(Error('Origin rejected'),{status:403})}};
const clean=()=>({equity:800,available:800,pnlToday:0,positions:[],pending:[]});
const plan=()=>({symbol:'XRPUSDT',side:'BUY',eligible:true,executionPolicy:'LIVE_STRICT',barTime:bar,expiresAt:now+50000,price:1.01,targetNet:1.2,reason:'All required checks passed'});
function fake(){
 const writes=[];let open=false,pending=false,existing=null;
 const broker={
  ready:()=>true,
  snapshot:async()=>({...clean(),positions:open?[{symbol:'XRPUSDT'}]:[],pending:pending?[{symbol:'XRPUSDT'}]:[]}),
  ticket:async(symbol,side,plan,options)=>{assert.deepEqual(options,{notionalUsd:100,maxNotionalUsd:102});return{symbol:'XRPUSDT',side:'Buy',price:1.01,qty:'100',notional:101,stopLoss:'1.005',takeProfit:'1.027',estimatedRoundTripCostRate:.0022,estimatedTakeProfitNetUsd:plan.targetNet+.001}},
  order:async()=>existing,
  leverage:async()=>{writes.push('leverage')},
  enter:async(ticket,link)=>{writes.push({ticket,link});return{orderId:'id-1'}}
 };
 return{broker,writes,setOpen:x=>open=x,setPending:x=>pending=x,setExisting:x=>existing=x};
}
function res(){return{code:null,setHeader(){},status(n){this.code=n;return this},json(v){this.data=v;return this}}}
async function call(h,method,body,headers={}){const req={method,body,headers:{cookie:'owner',origin:'https://example.test','x-omega-request':'1',...headers}},response=res();await h(req,response);return response}
test('real autopilot arming is explicit, one hour, authenticated and bound to login cookie',async()=>{
 const f=fake(),h=factory({env,broker:f.broker,analyze:async()=>plan(),authentication:auth,clock:()=>now});
 assert.equal((await call(h,'POST',{action:'arm',confirm:'start'})).code,400);
 const armed=await call(h,'POST',{action:'arm',confirm:'START REAL $100 AUTOPILOT'});assert.equal(armed.code,200);assert.equal(armed.data.armed,true);
 assert.equal(f.writes.length,0);
 const token=armed.data.token;
 assert.ok(verifyArm({headers:{cookie:'owner'}},token,env,auth,now));
 assert.throws(()=>verifyArm({headers:{cookie:'wrong'}},token,env,auth,now),/signing in|session/);
 assert.throws(()=>verifyArm({headers:{cookie:'owner'}},token,env,auth,now+3600001),/expired/);
});
test('fresh strict live entry has exchange TP/SL, requires arm and rejects duplicate positions',async()=>{
 const f=fake(),h=factory({env,broker:f.broker,analyze:async()=>plan(),authentication:auth,clock:()=>now});
 const armed=(await call(h,'POST',{action:'arm',confirm:'START REAL $100 AUTOPILOT'})).data;
 assert.equal((await call(h,'POST',{action:'enter',symbol:'XRPUSDT'})).code,403);
 assert.equal(f.writes.length,0);
 const accepted=await call(h,'POST',{action:'enter',symbol:'XRPUSDT',token:armed.token});
 assert.equal(accepted.code,202);assert.equal(accepted.data.submitted,true);
 assert.deepEqual(f.writes.map(x=>typeof x==='string'?x:'enter'),['leverage','enter']);
 assert.ok(f.writes[1].ticket.notional<=102);
 assert.ok(f.writes[1].ticket.stopLoss&&f.writes[1].ticket.takeProfit);
 f.setOpen(true);
 assert.equal((await call(h,'POST',{action:'enter',symbol:'XRPUSDT',token:armed.token})).code,409);
 assert.equal(f.writes.length,2);
});
test('real-money auto execution cannot use demo rules or bypass server kill switches',async()=>{
 const f=fake(),token=issueArm({headers:{cookie:'owner'}},env,auth,now);
 for(const x of [
  {env:{...env,OMEGA_BROWSER_AUTOLIVE_ENABLED:'false'}},
  {analyze:async()=>({...plan(),executionPolicy:'DEMO_FORWARD_TEST'})},
  {analyze:async()=>({...plan(),eligible:false})},
  {analyze:async()=>({...plan(),expiresAt:now-100})}
 ]){
  const h=factory({env:x.env||env,broker:f.broker,analyze:x.analyze||(async()=>plan()),authentication:auth,clock:()=>now});
  const r=await call(h,'POST',{action:'enter',symbol:'XRPUSDT',token});
  assert.notEqual(r.code,202);
 }
 assert.equal(f.writes.length,0);
});
test('existing exposure, pending orders, insufficient margin and daily losses block entry',()=>{
 for(const v of [
  {...clean(),positions:[{symbol:'BTCUSDT'}]},
  {...clean(),pending:[{symbol:'BTCUSDT'}]},
  {...clean(),equity:40},{...clean(),available:4},{...clean(),pnlToday:-1}
 ])assert.throws(()=>guardAccount(v));
});
test('broker replay check refuses a duplicate five-minute order ID',async()=>{
 const f=fake(),token=issueArm({headers:{cookie:'owner'}},env,auth,now);f.setExisting({orderStatus:'Filled'});
 const h=factory({env,broker:f.broker,analyze:async()=>plan(),authentication:auth,clock:()=>now});
 const r=await call(h,'POST',{action:'enter',symbol:'XRPUSDT',token});assert.equal(r.code,409);assert.equal(f.writes.length,0);
});
test('status is observational, never arms or trades',async()=>{
 const f=fake(),h=factory({env,broker:f.broker,authentication:auth,clock:()=>now});
 const r=await call(h,'GET');assert.equal(r.code,200);assert.equal(r.data.mode,'BROWSER_CONTROLLED_LIVE');assert.equal(f.writes.length,0);
});

test('futures keeps its calculated target and rejects the former tiny-payoff execution',async()=>{
 const f=fake(),ticket=f.broker.ticket;let supplied;
 f.broker.ticket=async(...args)=>{supplied=args[2];return ticket(...args)};
 const token=issueArm({headers:{cookie:'owner'}},env,auth,now);
 const h=factory({env,broker:f.broker,analyze:async()=>plan(),authentication:auth,clock:()=>now});
 const result=await call(h,'POST',{action:'enter',symbol:'XRPUSDT',token});
 assert.equal(result.code,202);assert.equal(supplied.targetNet,plan().targetNet);
 assert.equal(supplied.minimumNetRewardRisk,1.5);
 assert.equal(result.data.estimatedNetProfitTargetUsd,result.data.estimatedTakeProfitNetUsd);
 assert.ok(result.data.estimatedStopRiskUsd>0);
 const bad=fake();bad.broker.ticket=async(...args)=>({...await ticket(...args),estimatedTakeProfitNetUsd:.06});
 const blocked=factory({env,broker:bad.broker,analyze:async()=>plan(),authentication:auth,clock:()=>now});
 const rejected=await call(blocked,'POST',{action:'enter',symbol:'XRPUSDT',token});
 assert.equal(rejected.code,409);assert.match(rejected.data.error,/reward\/risk/);assert.equal(bad.writes.length,0);
});

test('$100 live autopilot can arm with $800 equity, not with $88 equity or <$100 available',async()=>{
 const f=fake();
 const handler=factory({env,broker:f.broker,analyze:async()=>plan(),authentication:auth,clock:()=>now});
 const result=await call(handler,'POST',{action:'arm',confirm:'START REAL $100 AUTOPILOT'});
 assert.equal(result.code,200);
 assert.equal(f.writes.length,0);
 for(const snapshot of [{...clean(),equity:88},{...clean(),available:99},{...clean(),pnlToday:-1.01}])
  assert.throws(()=>guardAccount(snapshot),/equity|margin|loss/i);
});
test('autopilot cannot be armed by legacy phrase or without the small live server switch',async()=>{
 const f=fake();
 const noSwitch=factory({env:{...env,OMEGA_SMALL_LIVE_ORDERS_ENABLED:'false'},broker:f.broker,authentication:auth,clock:()=>now});
 assert.equal((await call(noSwitch,'POST',{action:'arm',confirm:'START REAL $100 AUTOPILOT'})).code,503);
 const valid=factory({env,broker:f.broker,authentication:auth,clock:()=>now});
 assert.equal((await call(valid,'POST',{action:'arm',confirm:'START REAL AUTOPILOT'})).code,400);
 assert.equal(f.writes.length,0);
});
test('browser autopilot UI and research engine do not reference the old $450/$90 order gate',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const ui=fs.readFileSync(path.join(root,'static/live-auto.js'),'utf8');
 const api=fs.readFileSync(path.join(root,'api/auto-live.js'),'utf8');
 const decision=fs.readFileSync(path.join(root,'api/decision.js'),'utf8');
 assert.match(html,/START REAL \$100 AUTOPILOT/);
 assert.match(ui,/mode:'live_small'/);
 assert.match(ui,/account.equity<500\|\|account.available<100/);
 assert.match(api,/notionalUsd:AUTO_TRADE_USD,maxNotionalUsd:AUTO_MAX_TRADE_USD/);
 assert.match(api,/AUTO_MIN_EQUITY_USD=500/);
 assert.match(decision,/mode==='live_small'\?100:90/);
 assert.doesNotMatch(api,/\$90 minimum position requires/);
 assert.doesNotMatch(ui,/account.equity<450/);
});
