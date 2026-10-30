'use strict';
// Fast research shadow fills: uses orderbook-side executable VWAP, not mid-price
// candle highs/lows, and never submits an exchange order.
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaSecondsShadow=api})(typeof window!=='undefined'?window:null,function(){
 const VERSION=1,MAX_RECORDS=200,FEE=.00055,SLIP=.00020;
 const init=()=>({version:VERSION,closed:[],incomplete:0,open:null,lastClose:0});
 const restore=s=>s&&s.version===VERSION&&Array.isArray(s.closed)&&s.closed.length<=MAX_RECORDS&&Number.isFinite(s.incomplete)&&Number.isFinite(s.lastClose)&&(!s.open||typeof s.open==='object')?JSON.parse(JSON.stringify(s)):init();
 const round=(n,d=4)=>Number(n.toFixed(d));
 function pnl(p,quote){
  const exit=p.side==='BUY'?quote.bidVwap:quote.askVwap,dir=p.side==='BUY'?1:-1,qty=p.notional/p.entry;
  return dir*(exit-p.entry)*qty-(p.entry+exit)*qty*FEE-p.notional*SLIP*2;
 }
 function step(raw,{signals=[],quotes={},now=Date.now(),connected=true}={}){
  const s=restore(raw),events=[];
  if(s.open){
   const p=s.open,q=quotes[p.symbol];
   if(!connected||!q||now-q.observedAt>2300||q.observedAt>now+1000){
    if(now-p.openedAt>=4000||!connected){s.incomplete++;events.push({type:'INCOMPLETE',symbol:p.symbol});s.open=null;s.lastClose=now}
   }else if(now>p.openedAt){
    const result=pnl(p,q),time=now-p.openedAt;
    if(result>=.50||result<=-.75||time>=45000){
     const reason=result>=.50?'Modeled $0.50 net TP':result<=-.75?'Modeled $0.75 stop':'45s time limit';
     const trade={symbol:p.symbol,side:p.side,openedAt:p.openedAt,closedAt:now,entry:p.entry,
      exit:p.side==='BUY'?q.bidVwap:q.askVwap,net:round(result),reason,quality:p.quality,requiredMoveBps:p.requiredMoveBps};
     s.closed=[...s.closed,trade].slice(-MAX_RECORDS);s.open=null;s.lastClose=now;events.push({type:'CLOSED',trade});
    }
   }
  }
  if(!s.open&&connected&&now-s.lastClose>=20000){
   const choice=signals.filter(x=>x&&x.state==='WATCH'&&['BUY','SELL'].includes(x.side)&&quotes[x.symbol]&&
    now-quotes[x.symbol].observedAt<=2300&&x.score>=65).sort((a,b)=>b.score-a.score)[0];
   if(choice){
    const q=quotes[choice.symbol],entry=choice.side==='BUY'?q.askVwap:q.bidVwap;
    if(Number.isFinite(entry)&&entry>0&&q.notional===90){
     s.open={symbol:choice.symbol,side:choice.side,openedAt:now,entry,notional:90,quality:choice.score,requiredMoveBps:q.requiredMoveBps};
     events.push({type:'OPEN',symbol:choice.symbol});
    }
   }
  }
  return {state:s,events};
 }
 function stats(raw){
  const s=restore(raw),completed=s.closed;
  let net=0,peak=0,maxDrawdown=0,wins=0,loss=0,gains=0;
  for(const p of completed){
   net+=p.net;peak=Math.max(peak,net);maxDrawdown=Math.max(maxDrawdown,peak-net);
   if(p.net>0){wins++;gains+=p.net}else loss-=p.net;
  }
  return {count:completed.length,winRate:completed.length?round(100*wins/completed.length,1):null,netUsd:round(net),
   profitFactor:loss>0?round(gains/loss):null,maxDrawdownUsd:round(maxDrawdown),incomplete:s.incomplete,
   open:s.open?{symbol:s.open.symbol,side:s.open.side,ageSeconds:Math.max(0,round((Date.now()-s.open.openedAt)/1000,1))}:null,
   last:completed.at(-1)||null,validated:false,reason:'Simulated top-50 book VWAP, assumed fees/slippage and a live browser connection. Not independently audited real fills.'};
 }
 function interrupt(raw){const s=restore(raw);if(s.open){s.open=null;s.incomplete++;s.lastClose=Date.now()}return s}
 return {init,restore,step,stats,interrupt,pnl};
});
