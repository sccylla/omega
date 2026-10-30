'use strict';
// Fast research shadow fills: uses orderbook-side executable VWAP, not mid-price
// candle highs/lows, and never submits an exchange order.
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaSecondsShadow=api})(typeof window!=='undefined'?window:null,function(){
 const VERSION=1,MAX_RECORDS=200,FEE=.00055,SLIP=.00020;
 const init=()=>({version:VERSION,closed:[],incomplete:0,open:null,lastClose:0});
 const restore=s=>s&&s.version===VERSION&&Array.isArray(s.closed)&&s.closed.length<=MAX_RECORDS&&Number.isFinite(s.incomplete)&&Number.isFinite(s.lastClose)&&(!s.open||typeof s.open==='object')?JSON.parse(JSON.stringify(s)):init();
 const round=(n,d=4)=>Number(n.toFixed(d));
 function breakdown(p,quote){
  const exit=p.side==='BUY'?quote.bidVwap:quote.askVwap,dir=p.side==='BUY'?1:-1,qty=p.notional/p.entry;
  const gross=dir*(exit-p.entry)*qty,fees=(p.entry+exit)*qty*FEE,slippage=p.notional*SLIP*2;
  return {gross,fees,slippage,net:gross-fees-slippage};
 }
 function pnl(p,quote){return breakdown(p,quote).net}

 function step(raw,{signals=[],quotes={},now=Date.now(),connected=true,maxHoldMs=45000,cooldownMs=20000,
  notional=90,targetNet=.50,stopNet=.75}={}){
  if(!Number.isFinite(notional)||notional<5||notional>1000||
   !Number.isFinite(targetNet)||targetNet<=0||
   !Number.isFinite(stopNet)||stopNet<=0)throw Error('Invalid shadow order sizing or exit parameters');
  // null disables time-only exits for Demo; Real research defaults to 45s.
  const holdLimit=maxHoldMs===null?null:Number.isInteger(maxHoldMs)&&maxHoldMs>=45000&&maxHoldMs<=180000?maxHoldMs:45000;
  const cooldown=Number.isInteger(cooldownMs)&&cooldownMs>=3000&&cooldownMs<=20000?cooldownMs:20000;
  const s=restore(raw),events=[];
  if(s.open){
   const p=s.open,q=quotes[p.symbol];
   if(!connected||!q||now-q.observedAt>2300||q.observedAt>now+1000){
    if(now-p.openedAt>=4000||!connected){s.incomplete++;events.push({type:'INCOMPLETE',symbol:p.symbol});s.open=null;s.lastClose=now}
   }else if(now>p.openedAt){
    const breakdownValue=breakdown(p,q),result=breakdownValue.net,time=now-p.openedAt;
    const target=Number.isFinite(p.targetNet)?p.targetNet:.50,stop=Number.isFinite(p.stopNet)?p.stopNet:.75;
    if(result>=target||result<=-stop||(holdLimit!==null&&time>=holdLimit)){
     const reason=result>=target?'Modeled Math.round(holdLimit/1000)+'s time limit';
     const trade={symbol:p.symbol,side:p.side,openedAt:p.openedAt,closedAt:now,entry:p.entry,
      exit:p.side==='BUY'?q.bidVwap:q.askVwap,net:round(result),gross:round(breakdownValue.gross),fees:round(breakdownValue.fees),slippage:round(breakdownValue.slippage),reason,quality:p.quality,requiredMoveBps:p.requiredMoveBps,entryEvidence:p.entryEvidence||null};
     s.closed=[...s.closed,trade].slice(-MAX_RECORDS);s.open=null;s.lastClose=now;events.push({type:'CLOSED',trade});
    }
   }
  }
  if(!s.open&&connected&&now-s.lastClose>=cooldown){
   const choice=signals.filter(x=>x&&x.state==='WATCH'&&['BUY','SELL'].includes(x.side)&&quotes[x.symbol]&&
    now-quotes[x.symbol].observedAt<=2300&&x.score>=65).sort((a,b)=>b.score-a.score)[0];
   if(choice){
    const q=quotes[choice.symbol],entry=choice.side==='BUY'?q.askVwap:q.bidVwap;
    if(Number.isFinite(entry)&&entry>0&&q.notional===notional){
     const entryEvidence=choice.qualityVeto==='DEMO_INTELLIGENCE_V1'?{
      strategy:'DEMO_INTELLIGENCE_V1',spreadBps:Number(choice.spreadBps),
      flowPressure:Number(choice.flowPressure),imbalance:Number(choice.imbalance),
      move5Bps:Number(choice.move5Bps),move15Bps:Number(choice.move15Bps),
      range30Bps:Number(choice.range30Bps),feasibilityBps:Number(choice.feasibilityBps),
      confirmationSeconds:Number(choice.confirmationSeconds)
     }:null;
     s.open={symbol:choice.symbol,side:choice.side,openedAt:now,entry,notional,targetNet,stopNet,quality:choice.score,requiredMoveBps:q.requiredMoveBps,entryEvidence};
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
+target.toFixed(2)+' net TP':result<=-stop?'Modeled Math.round(holdLimit/1000)+'s time limit';
     const trade={symbol:p.symbol,side:p.side,openedAt:p.openedAt,closedAt:now,entry:p.entry,
      exit:p.side==='BUY'?q.bidVwap:q.askVwap,net:round(result),gross:round(breakdownValue.gross),fees:round(breakdownValue.fees),slippage:round(breakdownValue.slippage),reason,quality:p.quality,requiredMoveBps:p.requiredMoveBps,entryEvidence:p.entryEvidence||null};
     s.closed=[...s.closed,trade].slice(-MAX_RECORDS);s.open=null;s.lastClose=now;events.push({type:'CLOSED',trade});
    }
   }
  }
  if(!s.open&&connected&&now-s.lastClose>=cooldown){
   const choice=signals.filter(x=>x&&x.state==='WATCH'&&['BUY','SELL'].includes(x.side)&&quotes[x.symbol]&&
    now-quotes[x.symbol].observedAt<=2300&&x.score>=65).sort((a,b)=>b.score-a.score)[0];
   if(choice){
    const q=quotes[choice.symbol],entry=choice.side==='BUY'?q.askVwap:q.bidVwap;
    if(Number.isFinite(entry)&&entry>0&&q.notional===90){
     const entryEvidence=choice.qualityVeto==='DEMO_INTELLIGENCE_V1'?{
      strategy:'DEMO_INTELLIGENCE_V1',spreadBps:Number(choice.spreadBps),
      flowPressure:Number(choice.flowPressure),imbalance:Number(choice.imbalance),
      move5Bps:Number(choice.move5Bps),move15Bps:Number(choice.move15Bps),
      range30Bps:Number(choice.range30Bps),feasibilityBps:Number(choice.feasibilityBps),
      confirmationSeconds:Number(choice.confirmationSeconds)
     }:null;
     s.open={symbol:choice.symbol,side:choice.side,openedAt:now,entry,notional:90,quality:choice.score,requiredMoveBps:q.requiredMoveBps,entryEvidence};
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
+stop.toFixed(2)+' loss trigger':Math.round(holdLimit/1000)+'s time limit';
     const trade={symbol:p.symbol,side:p.side,openedAt:p.openedAt,closedAt:now,entry:p.entry,
      exit:p.side==='BUY'?q.bidVwap:q.askVwap,net:round(result),gross:round(breakdownValue.gross),fees:round(breakdownValue.fees),slippage:round(breakdownValue.slippage),reason,quality:p.quality,requiredMoveBps:p.requiredMoveBps,entryEvidence:p.entryEvidence||null};
     s.closed=[...s.closed,trade].slice(-MAX_RECORDS);s.open=null;s.lastClose=now;events.push({type:'CLOSED',trade});
    }
   }
  }
  if(!s.open&&connected&&now-s.lastClose>=cooldown){
   const choice=signals.filter(x=>x&&x.state==='WATCH'&&['BUY','SELL'].includes(x.side)&&quotes[x.symbol]&&
    now-quotes[x.symbol].observedAt<=2300&&x.score>=65).sort((a,b)=>b.score-a.score)[0];
   if(choice){
    const q=quotes[choice.symbol],entry=choice.side==='BUY'?q.askVwap:q.bidVwap;
    if(Number.isFinite(entry)&&entry>0&&q.notional===90){
     const entryEvidence=choice.qualityVeto==='DEMO_INTELLIGENCE_V1'?{
      strategy:'DEMO_INTELLIGENCE_V1',spreadBps:Number(choice.spreadBps),
      flowPressure:Number(choice.flowPressure),imbalance:Number(choice.imbalance),
      move5Bps:Number(choice.move5Bps),move15Bps:Number(choice.move15Bps),
      range30Bps:Number(choice.range30Bps),feasibilityBps:Number(choice.feasibilityBps),
      confirmationSeconds:Number(choice.confirmationSeconds)
     }:null;
     s.open={symbol:choice.symbol,side:choice.side,openedAt:now,entry,notional:90,quality:choice.score,requiredMoveBps:q.requiredMoveBps,entryEvidence};
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
