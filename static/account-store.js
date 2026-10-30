'use strict';
(()=>{
 const E=window.OmegaPaper,KEY='omega_trader_v7_browser_paper_account',LOCK='omega-paper-account';
 let mode='checking',shared=null,revision=0,error='',refreshing=false,settled=false,writing=false;
 function local(){try{return E.restore(JSON.parse(localStorage.getItem(KEY)||'null'))}catch{return E.initial()}}
 function read(){return shared&&mode!=='local'?E.restore(shared):local()}
 const updated=account=>window.dispatchEvent(new CustomEvent('omega:paper-updated',{detail:account}));
 function status(){return {mode,revision,error,writable:mode==='local'||mode==='cloud',shared:mode==='cloud'}}
 function render(){
  const node=document.getElementById('paper-sync-state');if(!node)return;
  node.textContent=mode==='cloud'?'Synced account · Visible on your signed-in devices':mode==='local'?'Device-only demo · Sign in to sync your trades':mode==='checking'?'Checking account connection…':'Cloud sync unavailable · Trading paused. '+error;
  node.dataset.state=mode;
  const importer=document.getElementById('paper-import-local');if(importer)importer.hidden=mode!=='cloud'||!shared||activity(shared)||!activity(local());
 }
 function scope(next){const changed=mode!==next;mode=next;render();if(changed&&settled)window.dispatchEvent(new Event('omega:paper-scope'))}
 function publish(data){
  if(!Number.isSafeInteger(data.revision)||data.revision<0||data.account!==null&&!E.valid(data.account))throw Error('Invalid shared demo response');
  if(data.revision<revision)return;
  const changed=data.revision!==revision||!shared;
  revision=data.revision;shared=data.account?E.restore(data.account):null;
  if(changed&&shared)updated(shared);
 }
 async function request(url,{body,signal}={}){
  const controller=new AbortController();let timer,cancel;
  try{
   return await new Promise((resolve,reject)=>{
    cancel=()=>{controller.abort();reject(new DOMException('Account request cancelled','AbortError'))};
    if(signal?.aborted){cancel();return}
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>{controller.abort();reject(Error('Cloud account request timed out'))},10000);
    fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:body?{'Content-Type':'application/json','X-OMEGA-REQUEST':'1'}:{},body:body?JSON.stringify(body):undefined}).then(async response=>{
     const data=await response.json();if(response.status===409&&data.account){publish(data);throw Error(data.error)}
     if(!response.ok){const failure=Error(data.error||'Cloud demo account unavailable');failure.status=response.status;throw failure}return data;
    }).then(resolve,reject).finally(()=>signal?.removeEventListener('abort',cancel));
   });
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort()}
 }
 const activity=a=>a.positions.length||a.closed.length||a.cash!==E.INITIAL;
 async function refresh({checkSession=false}={}){
  if(refreshing||writing)return;refreshing=true;
  try{
   if(checkSession||mode==='checking'){
    const session=await request('/api/demo?action=session');
    if(!session.authenticated){shared=null;revision=0;error='';scope('local');updated(local());return}
   }
   if(mode==='local'&&!checkSession)return;
   const data=await request('/api/paper'),device=local();
   // Initialize/import only an empty shared ledger. Existing cloud trades always
   // win over a stale device copy; Redis CAS arbitrates simultaneous imports.
   if(!data.account){
    try{publish(await request('/api/paper',{body:{action:'save',revision:data.revision,account:device}}))}
    catch(e){if(!shared)throw e}
   }else publish(data);
   error='';scope('cloud');render();updated(read());
  }catch(e){
   error=e.message||'Connection failed';
   if(mode==='checking'&&!e.status){scope('local')}else scope('blocked');
   render();
  }finally{refreshing=false}
 }
 const ready=refresh({checkSession:true}).finally(()=>{settled=true});
 async function transact(change,{requireLock=false,signal}={}){
  await ready;
  const run=async()=>{
   if(signal?.aborted)throw new DOMException('Account update cancelled','AbortError');
   if(mode!=='local'&&mode!=='cloud')throw Error('Cloud sync is unavailable. Reconnect before changing the shared demo account.');
   writing=true;
   try{
    if(mode==='cloud'){
     const snapshot=await request('/api/paper',{signal});publish(snapshot);
     if(!snapshot.account)throw Error('Shared demo account is missing. Reconnect before trading.');
     const current=E.restore(snapshot.account),next=change(current);
     if(next===current)return current;
     if(signal?.aborted)throw new DOMException('Account update cancelled','AbortError');
     const saved=await request('/api/paper',{body:{action:'save',revision:snapshot.revision,account:next},signal});
     publish(saved);return read();
    }
    const current=local(),next=change(current);
    if(next!==current){localStorage.setItem(KEY,JSON.stringify(next));updated(next)}return next;
   }finally{writing=false}
  };
  if(navigator.locks)return navigator.locks.request(LOCK,signal?{signal}:{},run);
  if(requireLock&&mode==='local')throw Error('Device-only automatic entries require browser tab locking. Use a current browser over HTTPS.');
  return run();
 }
 window.OmegaAccount={KEY,read,transact,ready,refresh,status};
 document.getElementById('paper-sync-refresh')?.addEventListener('click',()=>refresh({checkSession:true}));
 document.getElementById('paper-import-local')?.addEventListener('click',()=>transact(current=>{
  if(activity(current))throw Error('The shared account already contains activity; it cannot be replaced by an older device copy.');return local();
 }).then(render).catch(e=>{error=e.message;render()}));
 setInterval(()=>{if(!document.hidden&&mode==='cloud')refresh()},5000);
 setInterval(()=>{if(!document.hidden)refresh({checkSession:true})},30000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh({checkSession:true})});
 render();
})();
