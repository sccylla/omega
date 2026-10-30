'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {FilePaperStore,RedisPaperStore,validateAccount,setLocalStore}=require('../lib/paper-store'),E=require('../lib/paper-engine'),auth=require('../lib/bybit-demo');
function store(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omega-paper-sync-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new FilePaperStore(dir)}
test('shared ledger persists a trade and its history across independent readers and process restart',async t=>{
 const a=store(t),b=new FilePaperStore(path.dirname(a.file));assert.equal((await a.read()).revision,0);
 let account=E.open(E.initial(),{XRP:1},{symbol:'XRP',side:'BUY',notional:100,auto:true,targetNet:5,entryEvidence:{strategy:'evidence-v11'}});
 assert.equal((await a.write(0,account)).saved,true);assert.equal((await b.read()).account.positions[0].notional,100);
 account=E.applyQuote(account,{XRP:1.06});await b.write(1,account);const restarted=new FilePaperStore(path.dirname(a.file));
 assert.ok((await restarted.read()).account.closed[0].netRaw>=5);assert.equal((fs.statSync(a.file).mode&0o777),0o600);
});
test('two devices opening concurrently cannot overwrite or duplicate the first accepted trade',async t=>{
 const a=store(t),b=new FilePaperStore(path.dirname(a.file));await a.write(0,E.initial());
 const before=await a.read(),one=E.open(before.account,{XRP:1},{symbol:'XRP',side:'BUY',notional:100}),two=E.open(before.account,{ETH:1},{symbol:'ETH',side:'SELL',notional:100});
 const results=await Promise.all([a.write(1,one),b.write(1,two)]);assert.equal(results.filter(x=>x.saved).length,1);assert.equal(results.filter(x=>!x.saved).length,1);
 const current=await b.read();assert.equal(current.revision,2);assert.equal(current.account.positions.length,1);
 assert.equal((await a.write(1,E.initial())).saved,false);assert.equal((await a.read()).account.positions.length,1);
});
test('shared account rejects nonfinite balances, malformed positions and invalid history',()=>{
 for(const mutate of [s=>s.cash=NaN,s=>s.starting=10000,s=>s.closed=[{id:'bad'}],s=>s.positions=[{symbol:'<script>'}],s=>s.day='not-a-date']){const s=E.initial();mutate(s);assert.throws(()=>validateAccount(s),/Invalid/)}
});
test('Redis uses authenticated HTTPS and atomic revision comparisons rather than a process cache',async()=>{
 let raw=null;const commands=[],fetcher=async(url,opts)=>{
  assert.equal(url,'https://redis.example/');assert.equal(opts.headers.Authorization,'Bearer fixture-token');const cmd=JSON.parse(opts.body);commands.push(cmd);
  let result;if(cmd[0]==='GET')result=raw;else{assert.equal(cmd[0],'EVAL');assert.match(cmd[1],/redis.call\('GET'/);assert.match(cmd[1],/revision~=/);const revision=raw?JSON.parse(raw).revision:0;if(revision===Number(cmd[4])){raw=cmd[5];result=[1,raw]}else result=[0,raw||'']}
  return {ok:true,json:async()=>({result})};
 };
 const a=new RedisPaperStore({url:'https://redis.example',token:'fixture-token',fetcher}),b=new RedisPaperStore({url:'https://redis.example',token:'fixture-token',fetcher});
 assert.equal((await a.read()).account,null);assert.equal((await a.write(0,E.initial())).saved,true);assert.equal((await b.write(0,E.initial())).saved,false);assert.equal((await b.read()).revision,1);assert.ok(commands.some(c=>c[0]==='EVAL'));
 assert.throws(()=>new RedisPaperStore({url:'http://redis.example',token:'fixture-token'}),/HTTPS/);
 const failing=new RedisPaperStore({url:'https://redis.example',token:'fixture-token',fetcher:async()=>{throw Error('fixture-secret-do-not-expose')}});await assert.rejects(failing.read(),e=>!e.message.includes('fixture-secret')&&e.status===503);
});
test('shared API requires login and same-origin writes, and reports stale device revisions',async t=>{
 const previous={password:process.env.OMEGA_DASHBOARD_PASSWORD,secret:process.env.OMEGA_SESSION_SECRET};
 process.env.OMEGA_DASHBOARD_PASSWORD='fixture-password-for-tests';process.env.OMEGA_SESSION_SECRET='fixture-session-key-with-at-least-32-characters';
 const paper=store(t);setLocalStore(paper);const handler=require('../api/paper'),res=()=>({setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}});
 try{
  const cookie=auth.COOKIE+'='+auth.cookieValue(),headers={cookie,origin:'https://omega.example',host:'omega.example','x-omega-request':'1'};
  let r=res();await handler({method:'GET',headers:{}},r);assert.equal(r.code,401);
  r=res();await handler({method:'POST',headers:{cookie},body:{action:'save',revision:0,account:E.initial()}},r);assert.equal(r.code,403);
  r=res();await handler({method:'POST',headers,body:{action:'save',revision:0,account:E.initial()}},r);assert.equal(r.code,200);
  r=res();await handler({method:'GET',headers},r);assert.equal(r.body.revision,1);assert.equal(r.body.scope,'OWNER_SHARED');
  r=res();await handler({method:'POST',headers,body:{action:'save',revision:0,account:E.initial()}},r);assert.equal(r.code,409);assert.equal(r.body.revision,1);assert.match(r.body.error,/another device/);
 }finally{
  setLocalStore(null);for(const [name,value]of [['OMEGA_DASHBOARD_PASSWORD',previous.password],['OMEGA_SESSION_SECRET',previous.secret]])if(value===undefined)delete process.env[name];else process.env[name]=value;
 }
});
