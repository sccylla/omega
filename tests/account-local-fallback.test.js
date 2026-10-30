'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.resolve(__dirname,'../static/account-store.js'),'utf8');
function fixture({authenticated=true,responses=[]}={}){
 const storage=new Map(),node={textContent:'',dataset:{}},E={INITIAL:100};
 E.initial=()=>({version:7,starting:100,cash:100,positions:[],closed:[]});
 E.restore=a=>a||E.initial();
 E.valid=a=>!!a&&Number.isFinite(a.cash)&&Array.isArray(a.positions)&&Array.isArray(a.closed);
 let n=0;
 const fetch=async(url)=>{
  if(url.startsWith('/api/demo'))return {status:200,ok:true,json:async()=>({authenticated})};
  if(url.startsWith('/api/paper')){
   const p=responses[Math.min(n++,responses.length-1)]||{status:503,body:{configured:false,error:'Shared demo storage is not configured.'}};
   return {status:p.status,ok:p.status>=200&&p.status<300,json:async()=>p.body};
  }
  throw Error('Unexpected request '+url);
 };
 const window={OmegaPaper:E,dispatchEvent(){}},document={getElementById:id=>id==='paper-sync-state'?node:null,addEventListener(){}};
 const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
 const navigator={locks:{request:async(name,options,callback)=>callback()}};
 vm.runInNewContext(code,{window,document,localStorage,navigator,fetch,AbortController,DOMException,CustomEvent:class{},setTimeout,clearTimeout,setInterval:()=>0,Date,JSON,Promise});
 return {account:window.OmegaAccount,node,storage,E};
}
test('signed-in demo stays writable in device-only mode when Redis was never configured',async()=>{
 const {account,node,storage}=fixture();
 await account.ready;
 assert.equal(account.status().mode,'local');assert.equal(account.status().writable,true);
 assert.match(node.textContent,/Upstash Redis not connected/);
 await account.transact(a=>({...a,cash:105}),{requireLock:true});
 assert.equal(account.read().cash,105);
 assert.ok(storage.has(account.KEY));
});
test('a storage outage without explicit unconfigured status keeps trading blocked',async()=>{
 const {account,node}=fixture({responses:[{status:503,body:{error:'Redis unavailable'}}]});
 await account.ready;
 assert.equal(account.status().mode,'blocked');assert.equal(account.status().writable,false);
 assert.match(node.textContent,/Trading paused/);
});
test('loss of previously active cloud storage cannot silently fork signed-in ledger',async()=>{
 const E={version:7,starting:100,cash:112,positions:[],closed:[]};
 const {account}=fixture({responses:[
  {status:200,body:{revision:4,account:E,configured:true}},
  {status:503,body:{configured:false,error:'Storage missing'}}
 ]});
 await account.ready;
 assert.equal(account.status().mode,'cloud');assert.equal(account.read().cash,112);
 await account.refresh({checkSession:true});
 assert.equal(account.status().mode,'blocked');assert.equal(account.status().writable,false);
});
