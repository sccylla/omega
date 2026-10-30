'use strict';
// One authenticated owner ledger, shared across devices. No broker orders.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const E=require('./paper-engine');
class StoreError extends Error{constructor(status,message){super(message);this.status=status}}
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const positive=x=>finite(x)&&x>0;
const symbol=x=>typeof x==='string'&&/^[A-Z0-9]{2,24}$/.test(x)&&!x.endsWith('USDT');
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x);
function validateAccount(account){
 if(!E.valid(account)||account.starting!==100||!positive(account.createdAt)||!positive(account.dayStartEquity)||!/^\d{4}-\d{2}-\d{2}$/.test(account.day)||!Number.isFinite(Date.parse(account.day))||Math.abs(account.cash)>1000000||account.closed.length>100)throw new StoreError(400,'Invalid shared demo account');
 for(const p of account.positions){
  if(!id(p.id)||!positive(p.notional)||p.notional<100||!positive(p.entryFee)||!positive(p.openedAt)||![p.entry,p.qty,p.stop,p.target].every(positive)||Math.abs(p.entry*p.qty-p.notional)>Math.max(.00001,p.notional*1e-8)||p.slippageBps!==undefined&&(!finite(p.slippageBps)||p.slippageBps<0||p.slippageBps>50)||p.targetNet!==undefined&&!positive(p.targetNet))throw new StoreError(400,'Invalid shared demo position');
 }
 for(const p of account.closed){
  if(!id(p.id)||!symbol(p.symbol)||!['BUY','SELL'].includes(p.side)||![p.entry,p.exit,p.notional,p.openedAt,p.closedAt].every(positive)||!finite(p.net)||!finite(p.netRaw)||Math.abs(p.net-PaperRound(p.netRaw))>.001||typeof p.reason!=='string'||p.reason.length>500)throw new StoreError(400,'Invalid shared demo history');
 }
 if(Buffer.byteLength(JSON.stringify(account))>60000)throw new StoreError(413,'Demo account is too large');
 return E.restore(account);
}
const PaperRound=n=>Math.round((n+Number.EPSILON)*100)/100;
function validateEnvelope(value){
 if(value===null)return {revision:0,account:null,updatedAt:null};
 if(!value||!Number.isSafeInteger(value.revision)||value.revision<1||!positive(value.updatedAt))throw new StoreError(503,'Shared demo ledger needs recovery');
 try{return {...value,account:validateAccount(value.account)}}catch{throw new StoreError(503,'Shared demo ledger needs recovery')}
}
const envelope=(revision,account)=>({revision,account:validateAccount(account),updatedAt:Date.now()});
// Atomic compare-and-set works across Vercel instances, not merely one process.
const CAS=`local current=redis.call('GET',KEYS[1])
local revision=0
if current then revision=cjson.decode(current).revision end
if revision~=tonumber(ARGV[1]) then return {0,current or ''} end
redis.call('SET',KEYS[1],ARGV[2])
return {1,ARGV[2]}`;
class RedisPaperStore{
 constructor({url,token,key='omega:paper:v1:owner',fetcher=fetch}){
  let parsed;try{parsed=new URL(url)}catch{throw new StoreError(503,'Shared demo storage URL is invalid')}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||!token)throw new StoreError(503,'Shared demo storage requires HTTPS and a server token');
  this.url=parsed.href;this.token=token;this.key=key;this.fetcher=fetcher;
 }
 async command(command){
  try{
   const response=await this.fetcher(this.url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(8000)});
   const data=await response.json();if(!response.ok||data.error)throw Error('Storage request failed');return data.result;
  }catch{throw new StoreError(503,'Shared demo storage is unavailable; no changes were saved locally')}
 }
 async read(){const raw=await this.command(['GET',this.key]);try{return validateEnvelope(raw===null?null:JSON.parse(raw))}catch(e){if(e instanceof StoreError)throw e;throw new StoreError(503,'Shared demo ledger needs recovery')}}
 async write(expectedRevision,account){
  const next=envelope(expectedRevision+1,account),result=await this.command(['EVAL',CAS,'1',this.key,String(expectedRevision),JSON.stringify(next)]);
  if(!Array.isArray(result)||result.length!==2)throw new StoreError(503,'Invalid shared demo storage response');
  return {saved:Number(result[0])===1,...validateEnvelope(result[1]?JSON.parse(result[1]):null)};
 }
}
class FilePaperStore{
 constructor(directory){fs.mkdirSync(directory,{recursive:true,mode:0o700});this.file=path.join(directory,'paper-account.json')}
 async read(){return validateEnvelope(fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):null)}
 async write(expectedRevision,account){
  // Synchronous read/CAS/write is indivisible within the persistent server process.
  // scripts/server.js holds an exclusive process lock for this data directory.
  const current=validateEnvelope(fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):null);
  if(current.revision!==expectedRevision)return {saved:false,...current};
  const next=envelope(expectedRevision+1,account),tmp=this.file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';let fd;
  try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,this.file);const dir=fs.openSync(path.dirname(this.file),'r');try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp)}
  return {saved:true,...next};
 }
}
let local=null,redis=null,signature=null;
function setLocalStore(store){local=store}
function configuredStore(env=process.env){
 const url=env.UPSTASH_REDIS_REST_URL||env.KV_REST_API_URL,token=env.UPSTASH_REDIS_REST_TOKEN||env.KV_REST_API_TOKEN;
 if(url&&token){
  const account=env.OMEGA_PAPER_ACCOUNT_ID||'owner';if(!/^[A-Za-z0-9_-]{1,64}$/.test(account))throw new StoreError(503,'Invalid shared demo account namespace');
  const next=url+'\n'+token+'\n'+account;
  if(next!==signature){redis=new RedisPaperStore({url,token,key:'omega:paper:v1:'+account});signature=next}return redis;
 }
 return local;
}
async function handleStore(store,method,body){
 if(method==='GET')return {status:200,body:{...await store.read(),scope:'OWNER_SHARED',configured:true}};
 if(body?.action!=='save'||!Number.isSafeInteger(body.revision)||body.revision<0||body.revision>=Number.MAX_SAFE_INTEGER)throw new StoreError(400,'Invalid shared demo revision');
 const result=await store.write(body.revision,validateAccount(body.account));
 return {status:result.saved?200:409,body:{...result,scope:'OWNER_SHARED',configured:true,...(!result.saved?{error:'Demo account changed on another device. Its latest state has been loaded; retry your action.'}:{})}};
}
module.exports={StoreError,RedisPaperStore,FilePaperStore,validateAccount,configuredStore,setLocalStore,handleStore};
