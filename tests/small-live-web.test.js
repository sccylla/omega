'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {factory,verifyPreview,risk}=require('../lib/small-live')._test;
const secret='s'.repeat(64);
const cookie='session-cookie-012345678901234567890123456789';
const TIME=Date.UTC(2026,9,31,9,0,0);
const previewConfirm='PLACE REAL $15 TRADE';
function fakes(){
 const calls=[];
 const state={equity:88,available:88,pnlToday:0,positions:[],pending:[]};
 const orders=new Map();
 const broker={
  ready:()=>true,
  snapshot:async()=>structuredClone(state),
  request:async(method,p,{symbol})=>{
   assert.equal(method,'GET');assert.equal(p,'/v5/market/tickers');
   return {list:[{symbol,bid1Price:'99.99',ask1Price:'100.01'}]};
  },
  ticket:async(symbol,side,plan,opts)=>{
   calls.push({type:'ticket',symbol,side,plan,opts});
   assert.equal(opts.notionalUsd,15);assert.equal(opts.maxNotionalUsd,16);
   return {symbol,side,notional:15,qty:'0.15',price:side==='Buy'?100.01:99.99,
    stopLoss:side==='Buy'?'99.71':'100.29',
    takeProfit:side==='Buy'?'100.61':'99.39',
    estimatedTakeProfitNetUsd:.056,estimatedRoundTripCostRate:.0022};
  },
  leverage:async(symbol)=>{calls.push({type:'leverage',symbol})},
  enter:async(ticket,link)=>{calls.push({type:'order',ticket,link});orders.set(link,
   {symbol:ticket.symbol,orderLinkId:link,orderStatus:'Filled',cumExecQty:ticket.qty});return {orderId:'BYBIT-123'}},
  order:async(symbol,link)=>{calls.push({type:'lookup',symbol,link});return orders.get(link)||null}
 };
 return {broker,state,calls,orders};
}
function res(){return {statusCode:200,headers:{},setHeader(n,v){this.headers[n]=v;return this},
 status(s){this.statusCode=s;return this},json(value){this.body=value;return this}}}
const authentication={
 isAuthed:req=>req.headers.cookie===cookie,
 getCookie:req=>req.headers.cookie,
 assertOrigin:req=>{
  if(req.headers.origin!=='https://omega.example.test'||req.headers['x-omega-request']!=='1')
   throw Object.assign(Error('CSRF blocked'),{status:403});
 }
};
function build(fake,{on=false,now=TIME}={}){
 const env={OMEGA_SESSION_SECRET:secret,OMEGA_SMALL_LIVE_ORDERS_ENABLED:on?'true':'false'};
 const handler=factory({env,broker:fake.broker,authentication,clock:()=>now});
 const req=async(body,{cookieValue=cookie,method=body?'POST':'GET',query={},origin='https://omega.example.test'}={})=>{
  const r=res();await handler({method,body,query,
   headers:{cookie:cookieValue,origin,'x-omega-request':'1'}},r);return r;
 };
 return {req,env};
}
test('website live state is read-only by default; $88 balance allows a $15 preview but not a funded order',async()=>{
 const fake=fakes(),{req}=build(fake);
 const info=await req(undefined);
 assert.equal(info.statusCode,200);
 assert.equal(info.body.enabled,false);
 assert.equal(info.body.minEquityUsd,75);
 assert.equal(info.body.tradeUsd,15);
 const preview=await req({action:'preview',symbol:'XRPUSDT',side:'Buy'});
 assert.equal(preview.statusCode,200);
 assert.equal(preview.body.notional,15);
 assert.ok(preview.body.estimatedStopRiskUsd<=.15);
 assert.equal(fake.calls.filter(x=>x.type==='order').length,0);
 const blocked=await req({action:'execute',confirm:previewConfirm,previewToken:preview.body.previewToken});
 assert.equal(blocked.statusCode,503);
 assert.equal(fake.calls.filter(x=>x.type==='order').length,0);
});
test('funded order requires same signed-in session, exact phrase and new broker risk checks',async()=>{
 const fake=fakes(),{req,env}=build(fake,{on:true});
 const p=await req({action:'preview',symbol:'XRPUSDT',side:'Buy'});
 assert.equal(p.statusCode,200);
 const p2=await req({action:'execute',confirm:'trade now',previewToken:p.body.previewToken});
 assert.equal(p2.statusCode,400);
 const stolen=await req({action:'execute',confirm:previewConfirm,previewToken:p.body.previewToken},
  {cookieValue:'another-cookie-012345678901234567890123456789'});
 assert.equal(stolen.statusCode,401);
 const r=await req({action:'execute',confirm:previewConfirm,previewToken:p.body.previewToken});
 assert.equal(r.statusCode,202);
 assert.equal(r.body.submitted,true);
 assert.equal(r.body.notional,15);
 assert.equal(fake.calls.filter(x=>x.type==='order').length,1);
 assert.equal(fake.calls.filter(x=>x.type==='leverage').length,1);
 const retry=await req({action:'execute',confirm:previewConfirm,previewToken:p.body.previewToken});
 assert.equal(retry.statusCode,409);
 assert.equal(fake.calls.filter(x=>x.type==='order').length,1);
 const reconciliation=await req(undefined,{query:{action:'order',symbol:'XRPUSDT',link:r.body.orderLinkId}});
 assert.equal(reconciliation.body.status,'Filled');
 assert.equal(reconciliation.body.filledQty,'0.15');
 assert.match(r.body.message,/not proof of a fill/);
 assert.equal(verifyPreview(p.body.previewToken,env,authentication,
  {headers:{cookie}},TIME).symbol,'XRPUSDT');
});
test('insufficient funds, pending orders, other positions, and daily loss all prevent live orders',async()=>{
 for(const change of [{equity:74},{available:10},{pnlToday:-1},
   {positions:[{symbol:'BTCUSDT',side:'Buy',size:'1'}]},{pending:[{symbol:'ETHUSDT'}]}]){
  const fake=fakes();Object.assign(fake.state,change);const {req}=build(fake,{on:true});
  const response=await req({action:'preview',symbol:'XRPUSDT',side:'Buy'});
  assert.equal(response.statusCode,409);
  assert.equal(fake.calls.filter(x=>x.type==='order').length,0);
 }
});
test('bad symbol, wide spread, invalid quantity and risk budget reject previews',async()=>{
 const fake=fakes(),{req}=build(fake,{on:true});
 assert.equal((await req({action:'preview',symbol:'FAKEUSDT',side:'Buy'})).statusCode,400);
 fake.broker.request=async()=>({list:[{symbol:'XRPUSDT',bid1Price:'99.9',ask1Price:'100.1'}]});
 assert.equal((await req({action:'preview',symbol:'XRPUSDT',side:'Buy'})).statusCode,409);
 fake.broker.request=async()=>({list:[{symbol:'XRPUSDT',bid1Price:'99.99',ask1Price:'100.01'}]});
 fake.broker.ticket=async()=>({symbol:'XRPUSDT',side:'Buy',notional:20,qty:'0.2',
  price:100.01,stopLoss:'99.71',takeProfit:'100.61',estimatedTakeProfitNetUsd:.05});
 assert.equal((await req({action:'preview',symbol:'XRPUSDT',side:'Buy'})).statusCode,409);
 assert.throws(()=>risk({equity:88,available:88,pnlToday:0,positions:[],pending:[]},
  {notional:15,qty:'0.15',price:100,stopLoss:'95',takeProfit:'102',estimatedTakeProfitNetUsd:.05}),
  /risk limit/);
});
test('webpage presents $88 controls, explicit confirmation and no Telegram runtime',()=>{
 const root=path.resolve(__dirname,'..');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'static/small-live.js'),'utf8');
 const server=fs.readFileSync(path.join(root,'scripts/server.js'),'utf8');
 const router=fs.readFileSync(path.join(root,'api/manual-live.js'),'utf8');
 for(const id of ['small-live-panel','small-live-equity','small-live-available','small-live-preview','small-live-confirm','small-live-submit','small-live-reconcile'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/small-live\.js/);
 assert.match(html,/PLACE REAL \$15 TRADE/);
 assert.match(js,/post|action:'preview'/);
 assert.match(js,/action:'execute',confirm:'PLACE REAL \$15 TRADE'/);
 assert.match(js,/previewToken/);
 assert.match(router,/profile==='small'/);
 assert.match(js,/\/api\/manual-live\?profile=small/);
 assert.ok(!server.includes('telegram-demo-bot'));
 assert.ok(!fs.existsSync(path.join(root,'lib/telegram-demo-bot.js')));
});
