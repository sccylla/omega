'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Evidence=require('../lib/scalp-evidence');
const {factory}=require('../api/auto-live')._test;
const NOW=1800000005000;
const env={OMEGA_SMALL_LIVE_ORDERS_ENABLED:'true',OMEGA_BROWSER_AUTOLIVE_ENABLED:'true',OMEGA_SESSION_SECRET:'r'.repeat(64)};
const auth={getCookie:r=>r.headers.cookie==='owner'?'owner':null,isAuthed:r=>r.headers.cookie==='owner',
 assertOrigin:r=>{if(r.headers.origin!=='https://test.example'||r.headers['x-omega-request']!=='1')
  throw Object.assign(new Error('Origin rejected'),{status:403})}};
function favorable(){
 const t=NOW,book={s:'XRPUSDT',ts:t,b:[['100','120'],['99.99','100']],a:[['100.01','40'],['100.02','30']]};
 const trades=Array.from({length:60},(_,i)=>({T:t-(59-i)*1000,p:String(100+i*.014),v:'8',S:i%9===0?'Sell':'Buy'}));
 return {trades,book};
}
function response(){return{code:200,setHeader(){return this},status(v){this.code=v;return this},json(v){this.data=v;return this}}}
async function call(h,body){const res=response();await h({method:'POST',body,headers:{cookie:'owner',origin:'https://test.example','x-omega-request':'1'}},res);return res}
function fake(){
 const orders=[];
 const broker={
  ready:()=>true,
  snapshot:async()=>({equity:88,available:88,pnlToday:0,positions:[],pending:[]}),
  ticket:async(symbol,side,plan,options)=>{
   assert.deepEqual(options,{notionalUsd:15,maxNotionalUsd:16});
   return{symbol,side,qty:'0.15',price:100.01,notional:15,stopLoss:'99.71',takeProfit:'100.7',estimatedRoundTripCostRate:.0022,estimatedTakeProfitNetUsd:.06};
  },
  order:async()=>null,leverage:async()=>{},
  enter:async(ticket,link)=>{orders.push({ticket,link});return{orderId:'bybit-ack'}},
 };
 const plan={symbol:'XRPUSDT',eligible:true,executionPolicy:'LIVE_STRICT',side:'BUY',
  barTime:Math.floor((NOW-300000)/300000)*300000,expiresAt:NOW+50000,price:100.01,stopPct:.3,targetNet:.06};
 return {broker,orders,plan};
}
test('server independently confirms recent trend, bid/ask depth, aggressive flow and fees',()=>{
 const q=favorable(),d=Evidence.decide({...q,now:NOW,side:'Buy'});
 assert.equal(d.eligible,true,JSON.stringify(d.checks));
 assert.ok(d.pressure>=.63);
 assert.ok(d.rangeBps>d.requiredMoveBps);
 assert.equal(Evidence.decide({...q,now:NOW,side:'Sell'}).eligible,false);
 assert.equal(Evidence.decide({...q,trades:q.trades.slice(0,5),now:NOW,side:'Buy'}).eligible,false);
 assert.equal(Evidence.decide({...q,book:{...q.book,a:[['101','40']]},now:NOW,side:'Buy'}).eligible,false);
});
test('separate real scalp authorization never places a trade until a fresh eligible server recheck',async()=>{
 const f=fake(),h=factory({env,broker:f.broker,authentication:auth,clock:()=>NOW,
  analyze:async()=>f.plan,scalpValidate:async()=>({side:'Buy',eligible:true})});
 const armed=await call(h,{action:'arm',confirm:'START REAL $15 SCALPER'});
 assert.equal(armed.code,200);assert.equal(armed.data.purpose,'scalper');assert.equal(f.orders.length,0);
 const denied=await call(h,{action:'enter_scalp',symbol:'XRPUSDT',side:'Buy'});
 assert.equal(denied.code,403);
 const accepted=await call(h,{action:'enter_scalp',symbol:'XRPUSDT',side:'Buy',token:armed.data.token});
 assert.equal(accepted.code,202,JSON.stringify(accepted.data));
 assert.equal(accepted.data.strategy,'SCALPER');
 assert.equal(f.orders.length,1);
 assert.equal(f.orders[0].ticket.notional,15);
 assert.equal(f.orders[0].ticket.stopLoss,'99.71');
 assert.ok(f.orders[0].link.startsWith('oms'));
});
test('scalp token cannot authorize a futures trade; futures token cannot authorize a scalp',async()=>{
 const f=fake(),h=factory({env,broker:f.broker,authentication:auth,clock:()=>NOW,
  analyze:async()=>f.plan,scalpValidate:async()=>({side:'Buy'})});
 const scalp=(await call(h,{action:'arm',confirm:'START REAL $15 SCALPER'})).data.token;
 const future=(await call(h,{action:'arm',confirm:'START REAL $15 AUTOPILOT'})).data.token;
 assert.equal((await call(h,{action:'enter',symbol:'XRPUSDT',token:scalp})).code,403);
 assert.equal((await call(h,{action:'enter_scalp',symbol:'XRPUSDT',side:'Buy',token:future})).code,403);
 assert.equal(f.orders.length,0);
});
test('server rejects scalp when public flow or mandatory strict futures checks fail',async()=>{
 const f=fake(),base={env,broker:f.broker,authentication:auth,clock:()=>NOW,analyze:async()=>f.plan};
 const veto=factory({...base,scalpValidate:async()=>{throw Error('No confirming order flow')}});
 const tok=(await call(veto,{action:'arm',confirm:'START REAL $15 SCALPER'})).data.token;
 assert.notEqual((await call(veto,{action:'enter_scalp',symbol:'XRPUSDT',side:'Buy',token:tok})).code,202);
 const bad=factory({...base,scalpValidate:async()=>({side:'Buy'}),analyze:async()=>({...f.plan,eligible:false})});
 assert.equal((await call(bad,{action:'enter_scalp',symbol:'XRPUSDT',side:'Buy',token:tok})).code,409);
 assert.equal(f.orders.length,0);
});
test('both Demo and Real workspaces contain exactly one Scalper and one Futures Trader',()=>{
 const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const demo=html.slice(html.indexOf('id="view-demo"'),html.indexOf('id="view-real"'));
 const live=html.slice(html.indexOf('id="view-real"'));
 for(const x of ['id="demo-seconds-lab"','id="demo-auto-panel"'])assert.match(demo,new RegExp(x));
 for(const x of ['id="seconds-lab"','id="live-autopilot"','id="seconds-trade-toggle"'])assert.match(live,new RegExp(x));
 assert.match(html,/static\/live-scalper\.js/);
 assert.match(html,/static\/demo-seconds-lab\.js/);
 assert.match(html,/static\/auto-v7\.js/);
 assert.match(html,/static\/two-tools\.css/);
 const css=fs.readFileSync(path.join(root,'static/two-tools.css'),'utf8');
 assert.match(css,/#view-demo>#demo-auto-panel/);
 assert.match(css,/#view-real>#seconds-lab/);
});
