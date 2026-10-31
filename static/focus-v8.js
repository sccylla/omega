'use strict';
(()=>{
  // Automatic market selection is Real Account only; Demo always stays manual.
  const manual=document.getElementById('demo-manual-panel');
  if(manual)manual.hidden=false;
  const menu=document.getElementById('nav-more');
  const research=new Set(['forex','futures','research']);
  function matchRoute(){if(menu&&research.has(location.hash.slice(1)))menu.open=true}
  window.addEventListener('hashchange',matchRoute);matchRoute();
  document.querySelectorAll('.nav-more [data-view]').forEach(b=>b.addEventListener('click',()=>{if(menu)menu.open=true}));
})();
