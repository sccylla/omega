'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evidence,demoEvidence,NOW}=require('./fixtures/advanced-evidence');
const {decide,holdout}=require('../lib/advanced-decision');
const News=require('../static/news-context'),Wallet=require('../static/demo-seconds-account');
const {factory}=require('../api/news');
const symbol='XRPUSDT',signal={symbol,state:'WATCH',side:'BUY',score:90};
function addEvent(e,title='XRP network hacked after a security breach'){
 e.news.articles[0]={...e.news.articles[0],title,publishedAt:NOW-60000};return e;
}
function res(){return {setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}}}
test('news event and coverage are mandatory entry gates in demo and both live policies',()=>{
 for(const mode of ['demo','live','live_small']){
  const fixture=mode==='demo'?demoEvidence:evidence;
  const baseline=decide(fixture(),{mode,now:NOW});
  assert.equal(baseline.eligible,true,mode);
  for(const changed of [addEvent(fixture()),{...fixture(),news:null},{...fixture(),news:{...fixture().news,observedAt:NOW-120001}}]){
   const plan=decide(changed,{mode,now:NOW});assert.equal(plan.eligible,false);assert.equal(plan.decision,'WAIT');
   assert.ok(plan.blockers.some(x=>/news/.test(x)));assert.equal(plan.news.blocked,true);
  }
  const goodHeadline=addEvent(evidence(),'XRP rallies as adoption expands');goodHeadline.book=null;
  assert.equal(decide(goodHeadline,{mode,now:NOW}).eligible,false,'positive headlines cannot bypass missing market data');
 }
});
test('today’s news and movement filters are not fabricated into a historical holdout',()=>{
 const e=evidence(),prior=holdout(e,{now:NOW});addEvent(e);
 assert.deepEqual(holdout(e,{now:NOW}),prior);
 const plan=decide(e,{now:NOW});assert.equal(plan.news.events[0].title,e.news.articles[0].title);
 assert.ok(plan.movement.metrics.efficiency>0);assert.equal(plan.validation.passed,true);assert.equal(plan.eligible,false);
});
test('news endpoint validates inputs and returns per-market risk without fetching user URLs',async()=>{
 let calls=0;const handler=factory({collect:async()=>{calls++;return addEvent(evidence()).news},clock:()=>NOW});
 for(const req of [{method:'POST',query:{}},{method:'GET',query:{symbols:'https://evil.example'}},{method:'GET',query:{symbols:['BTC']}},{method:'GET',query:{symbols:Array(21).fill('BTC').join(',')}}]){
  const r=res();await handler(req,r);assert.ok([400,405].includes(r.code));
 }
 assert.equal(calls,0);
 const r=res();await handler({method:'GET',query:{symbols:'XRP,BTCUSDT'}},r);
 assert.equal(r.code,200);assert.equal(calls,1);assert.equal(r.body.markets.XRPUSDT.blocked,true);assert.equal(r.body.markets.BTCUSDT.blocked,false);
});
test('browser news requests coalesce, throttle, expire, and reject incomplete or future responses',async()=>{
 let now=NOW,count=0,payload={observedAt:NOW,markets:{[symbol]:{ready:true,blocked:false,status:'READY',reason:'No event detected'}}};
 const client=News.create({clock:()=>now,fetcher:async()=>{count++;return {ok:true,json:async()=>payload}}});
 assert.equal(client.filter([signal])[0].state,'WAIT','missing context blocks');
 const first=client.refresh([symbol]),same=client.refresh([symbol]);assert.equal(first,same);await first;
 assert.equal(count,1);assert.equal(client.filter([signal])[0].state,'WATCH');
 await client.refresh([symbol]);assert.equal(count,1);
 now+=120001;assert.equal(client.filter([signal])[0].state,'WAIT');
 payload={observedAt:now+1,markets:payload.markets};await client.refresh([symbol]);assert.equal(client.assessment(symbol).blocked,true);
 now+=30000;payload={observedAt:now,markets:{}};await client.refresh([symbol]);assert.equal(client.assessment(symbol).ready,false);
 now+=30000;payload={observedAt:now,markets:{[symbol]:{ready:true}}};await client.refresh([symbol]);assert.equal(client.assessment(symbol).blocked,true,'missing blocked field is not clear');
});
test('changing the news market during an in-flight request queues the newly selected market',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve}),calls=[];
 const client=News.create({clock:()=>NOW,fetcher:async url=>{
  const requested=new URL(url,'http://local').searchParams.get('symbols');calls.push(requested);
  if(calls.length===1)await gate;
  return {ok:true,json:async()=>({observedAt:NOW,markets:{[requested]:{ready:true,blocked:false,status:'READY',reason:'No event'}}})};
 }});
 const first=client.refresh(['BTCUSDT']),second=client.refresh(['ETHUSDT']);release();
 await Promise.all([first,second]);assert.deepEqual(calls,['BTCUSDT','ETHUSDT']);
 assert.equal(client.assessment('ETHUSDT').blocked,false);
});
test('news veto blocks new Demo entries while existing positions can still close at fresh quotes',async()=>{
 let now=NOW,blocked=false;
 const client=News.create({clock:()=>now,fetcher:async()=>({ok:true,json:async()=>({observedAt:now,markets:{[symbol]:{ready:true,blocked,status:blocked?'EVENT_RISK':'READY',reason:blocked?'Recent exploit headline':'No event detected'}}})})});
 await client.refresh([symbol]);
 const quote=(price)=>({symbol,bidVwap:price,askVwap:price+.02,observedAt:now,notional:90,requiredMoveBps:80});
 const entered=Wallet.step(Wallet.initial(now),{now,signals:client.filter([signal]),quotes:{[symbol]:quote(100)},connected:true});
 assert.equal(entered.events[0].type,'OPEN');
 now+=30000;blocked=true;await client.refresh([symbol]);const signals=client.filter([signal]);
 assert.equal(signals[0].state,'WAIT');assert.equal(signals[0].side,null);
 const denied=Wallet.step(Wallet.initial(now),{now,signals,quotes:{[symbol]:quote(100)},connected:true});assert.equal(denied.events.length,0);
 const exited=Wallet.step(entered.account,{now,signals,quotes:{[symbol]:quote(102)},connected:true});assert.equal(exited.events[0].type,'CLOSED');assert.ok(exited.events[0].trade.net>0);
});
