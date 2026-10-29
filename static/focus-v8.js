'use strict';
(()=>{
  const auto=document.getElementById('demo-tab-auto'),manual=document.getElementById('demo-tab-manual');
  const a=document.getElementById('demo-auto-panel'),m=document.getElementById('demo-manual-panel');
  if(!auto||!manual||!a||!m)return;
  function select(mode){
    const isAuto=mode==='auto';
    a.hidden=!isAuto;m.hidden=isAuto;
    auto.classList.toggle('selected',isAuto);manual.classList.toggle('selected',!isAuto);
    auto.setAttribute('aria-selected',String(isAuto));manual.setAttribute('aria-selected',String(!isAuto));
    try{sessionStorage.setItem('omega_v8_demo_view',mode)}catch{}
  }
  auto.addEventListener('click',()=>select('auto'));
  manual.addEventListener('click',()=>select('manual'));
  try{select(sessionStorage.getItem('omega_v8_demo_view')==='manual'?'manual':'auto')}catch{select('auto')}
  const menu=document.getElementById('nav-more');
  const research=new Set(['forex','futures','research']);
  function matchRoute(){if(menu&&research.has(location.hash.slice(1)))menu.open=true}
  window.addEventListener('hashchange',matchRoute);matchRoute();
  document.querySelectorAll('.nav-more [data-view]').forEach(b=>b.addEventListener('click',()=>{if(menu)menu.open=true}));
})();
