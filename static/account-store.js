'use strict';
// Serialize mutations across tabs; never replace an account using a pre-fetch snapshot.
(()=>{
 const KEY='omega_trader_v6_browser_paper_account',LOCK='omega-paper-account';
 function read(){return window.OmegaPaper.restore(JSON.parse(localStorage.getItem(KEY)||'null'))}
 async function transact(change,{requireLock=false,signal}={}){
  const run=()=>{if(signal?.aborted)throw new DOMException('Account update cancelled','AbortError');const current=read(),next=change(current);if(next!==current){localStorage.setItem(KEY,JSON.stringify(next));window.dispatchEvent(new CustomEvent('omega:paper-updated',{detail:next}))}return next};
  if(navigator.locks)return navigator.locks.request(LOCK,signal?{signal}:{},run);
  if(requireLock)throw Error('Automatic entries require browser tab locking. Use a current browser over HTTPS.');
  return run();
 }
 window.OmegaAccount={KEY,read,transact};
})();
