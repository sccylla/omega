'use strict';
(()=>{
 // Keep the two account modes and their two bots visible; internal account,
 // research and broker-risk services remain available to the engines.
 const real=document.getElementById('view-real'),demo=document.getElementById('view-demo');
 if(!real||!demo)return;
 const scalp=document.getElementById('seconds-lab'),futures=document.getElementById('live-autopilot');
 if(scalp&&futures)real.insertBefore(scalp,futures);
 const label=document.querySelector('#view-demo .home-title h1');
 if(label)label.innerHTML='Two bots. <span>Practice first.</span>';
 const realLabel=document.querySelector('#view-real .home-title h1');
 if(realLabel)realLabel.innerHTML='Two bots. <span>Real Bybit.</span>';
 const demoSub=document.querySelector('#view-demo .home-title p');
 if(demoSub)demoSub.textContent='Scalper scans fast price moves and takes simulated exits. Futures Trader evaluates long and short entries and manages simulated exits. Both wait when evidence is weak.';
 const liveSub=document.querySelector('#view-real .home-title p');
 if(liveSub)liveSub.textContent='Scalper finds short-horizon opportunities; Futures Trader assesses long and short setups. Each needs separate authorization and fresh exchange-side risk checks before spending real funds.';
 function show(){
  const mode=document.body.dataset.account==='real'?'real':'demo';
  document.getElementById('account-mode-label').textContent=mode==='real'?'REAL MONEY':'DEMO / VIRTUAL';
  const button=document.querySelector('[data-account-mode="'+mode+'"]');
  if(button)button.setAttribute('aria-pressed','true');
 }
 // Existing router starts at Overview for Demo; open the actual two-tool desk.
 window.requestAnimationFrame(()=>{
  const mode=document.body.dataset.account==='real'?'real':'demo';
  document.querySelector('[data-account-mode="'+mode+'"]')?.click();
  show();
 });
 window.addEventListener('omega:account-mode',show);
})();