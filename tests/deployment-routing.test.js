'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),{NOW,evidence}=require('./fixtures/advanced-evidence');
const newsModule=require('../lib/market-news-api');
function response(){return {code:200,headers:{},setHeader(name,value){this.headers[name]=value},status(code){this.code=code;return this},json(body){this.body=body;return this}}}
async function withDecision(news,collectEvidence,run){
 const newsPath=require.resolve('../lib/market-news-api'),evidencePath=require.resolve('../lib/market-evidence'),decisionPath=require.resolve('../api/decision');
 const previousNews=require.cache[newsPath].exports,previousEvidence=require.cache[evidencePath].exports,previousDecision=require.cache[decisionPath];
 try{
  require.cache[newsPath].exports=news;
  if(collectEvidence)require.cache[evidencePath].exports={...previousEvidence,collectEvidence};
  delete require.cache[decisionPath];
  await run(require(decisionPath));
 }finally{
  require.cache[newsPath].exports=previousNews;require.cache[evidencePath].exports=previousEvidence;
  if(previousDecision)require.cache[decisionPath]=previousDecision;else delete require.cache[decisionPath];
 }
}
test('Hobby deployment preserves the public news URL while exposing exactly twelve functions',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
 const ignored=new Set(fs.readFileSync(path.join(root,'.vercelignore'),'utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')));
 const functions=fs.readdirSync(path.join(root,'api')).filter(name=>name.endsWith('.js')).map(name=>'api/'+name).filter(name=>!ignored.has(name));
 assert.equal(functions.length,12);assert.deepEqual(Object.keys(config.functions).sort(),functions.sort());
 assert.equal(ignored.has('api/news.js'),true);assert.equal(ignored.has('lib/market-news-api.js'),false);
 assert.deepEqual(config.rewrites.find(r=>r.source==='/api/news'),{source:'/api/news',destination:'/api/decision?context=news'});
 assert.equal(config.functions['api/decision.js'].maxDuration,25);
});
test('shared news entry forwards symbols and preserves the local route factory',async()=>{
 assert.equal(require('../api/news'),newsModule);assert.equal(typeof require('../api/news').factory,'function');
 let collections=0;
 const news=newsModule.factory({collect:async()=>{collections++;return evidence().news},clock:()=>NOW});
 await withDecision(news,async()=>{throw Error('Ordinary decision collection must not run')},async handler=>{
  const r=response();await handler({method:'GET',query:{context:'news',symbols:'BTC,ETHUSDT,BTC',symbol:'invalid ordinary parameter'}},r);
  assert.equal(r.code,200);assert.deepEqual(Object.keys(r.body.markets),['BTCUSDT','ETHUSDT']);assert.equal(r.body.observedAt,NOW);
  assert.equal(r.body.markets.BTCUSDT.ready,true);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(collections,1);
  const defaultMarket=response();await handler({method:'GET',query:{context:'news'}},defaultMarket);
  assert.deepEqual(Object.keys(defaultMarket.body.markets),['BTCUSDT']);
 });
});
test('rewritten news route rejects writes and invalid symbol queries before collection',async()=>{
 let collections=0;
 const news=newsModule.factory({collect:async()=>{collections++;return evidence().news},clock:()=>NOW});
 await withDecision(news,null,async handler=>{
  for(const req of [{method:'POST',query:{context:'news',symbols:'BTC'}},{method:'GET',query:{context:'news',symbols:'https://evil.example'}},{method:'GET',query:{context:'news',symbols:['BTC','ETH']}},{method:'GET',query:{context:'news',symbols:Array(21).fill('BTC').join(',')}}]){
   const r=response();await handler(req,r);assert.equal(r.code,req.method==='POST'?405:400);
  }
  assert.equal(collections,0);
 });
});
test('ordinary decision route retains its validation and response contract',async()=>{
 let collections=0;
 await withDecision(async()=>{throw Error('News-only handler must not run')},async symbol=>{collections++;return {...evidence(Date.now()),symbol}},async handler=>{
  for(const context of [undefined,'ordinary']){
   const r=response();await handler({method:'GET',query:{symbol:'XRP',mode:'live',...(context?{context}:{})}},r);
   assert.equal(r.code,200);assert.equal(r.body.symbol,'XRPUSDT');assert.equal(r.body.decision.executionPolicy,'LIVE_STRICT');
  }
  for(const req of [{method:'POST',query:{symbol:'XRP'}},{method:'GET',query:{symbol:'https://evil.example',context:['news']}},{method:'GET',query:{symbol:'XRP',mode:'unsupported'}}]){
   const r=response();await handler(req,r);assert.equal(r.code,req.method==='POST'?405:400);
  }
  assert.equal(collections,2);
 });
});
test('the deployed dependency graph includes the shared handler without ignored API wrappers',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8')),seen=new Set();
 function visit(file){
  if(seen.has(file))return;seen.add(file);
  assert.ok(!file.endsWith(path.join('api','news.js'))&&!file.endsWith(path.join('api','bot.js')),'Ignored route must not be a deployed dependency: '+file);
  const source=fs.readFileSync(file,'utf8');
  for(const [,specifier]of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)){
   if(!specifier.startsWith('.'))continue;
   let dependency=path.resolve(path.dirname(file),specifier);if(!path.extname(dependency))dependency+='.js';
   assert.equal(fs.existsSync(dependency),true,'Missing runtime dependency '+dependency);visit(dependency);
  }
 }
 for(const file of Object.keys(config.functions))visit(path.join(root,file));
 assert.equal(seen.has(path.join(root,'lib/market-news-api.js')),true);
});
test('the deployment pins Node24 without adding dependencies or build commands',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 assert.equal(pkg.private,true);assert.equal(pkg.engines.node,'24.x');
 assert.equal(Object.keys(pkg.dependencies||{}).length,0);assert.equal(Object.keys(pkg.devDependencies||{}).length,0);
 assert.equal(pkg.scripts?.build,undefined);
});
