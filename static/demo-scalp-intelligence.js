'use strict';
// Demo-only loss audit and pre-entry safety veto. No AI profitability claims:
// this is a conservative heuristic, with a rolling observed-trade circuit
// breaker and a 3-second confirmation window. Never controls funded orders.
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaDemoScalpIntelligence=api})(typeof window!=='undefined'?window:null,function(){
 const MIN_CONFIRMATIONS=3,QUARANTINE_MS=45*60000,GLOBAL_PAUSE_MS=60*60000;
 const finite=Number.isFinite,round=(n,d=3)=>Number(n.toFixed(d));
 function audit(raw,now=Date.now()){
  const trades=(Array.isArray(raw)?raw:[]).filter(t=>t&&typeof t.symbol==='string'&&
   ['BUY','SELL'].includes(t.side)&&finite(t.net)&&finite(t.closedAt)&&t.closedAt<=now+60000
  ).sort((a,b)=>a.closedAt-b.closedAt).slice(-200);
  const recent=trades.slice(-20);
  const winners=recent.filter(t=>t.net>0),losers=recent.filter(t=>t.net<=0);
  const gains=winners.reduce((n,t)=>n+t.net,0),losses=losers.reduce((n,t)=>n-t.net,0);
  const costs=recent.filter(t=>finite(t.fees)&&finite(t.slippage)).reduce((n,t)=>n+t.fees+t.slippage,0);
  const lossStreak=(()=>{let n=0;for(let i=trades.length-1;i>=0&&trades[i].net<=0;i--)n++;return n})();
  const last=trades.at(-1);
  const last8=trades.slice(-8);
  const last8Net=last8.reduce((n,t)=>n+t.net,0);
  let globalPauseUntil=0,globalReason='';
  if(last&&now-last.closedAt<GLOBAL_PAUSE_MS&&lossStreak>=3){
   globalPauseUntil=last.closedAt+GLOBAL_PAUSE_MS;globalReason='Three consecutive losing virtual trades';
  }else if(last&&now-last.closedAt<GLOBAL_PAUSE_MS&&last8.length>=8&&last8Net<0){
   globalPauseUntil=last.closedAt+GLOBAL_PAUSE_MS;globalReason='Last eight virtual trades have negative net expectancy';
  }
  const byMarket=new Map();
  for(const t of trades){
   const entry=byMarket.get(t.symbol)||{symbol:t.symbol,trades:0,wins:0,netUsd:0,lastLosses:0,lastClose:0,quarantineUntil:0};
   entry.trades++;entry.wins+=Number(t.net>0);entry.netUsd+=t.net;entry.lastClose=t.closedAt;
   entry.lastLosses=t.net>0?0:entry.lastLosses+1;
   if(entry.lastLosses>=2&&t.closedAt+QUARANTINE_MS>now)entry.quarantineUntil=t.closedAt+QUARANTINE_MS;
   if(t.net>0)entry.quarantineUntil=0;
   byMarket.set(t.symbol,entry);
  }
  const markets=[...byMarket.values()].map(t=>({...t,netUsd:round(t.netUsd),
   winRatePct:round(100*t.wins/t.trades,1)})).sort((a,b)=>a.netUsd-b.netUsd);
  const avgWin=winners.length?gains/winners.length:null,avgLoss=losers.length?losses/losers.length:null;
  const breakEvenWinPct=avgWin!==null&&avgLoss!==null&&avgWin+avgLoss>0?
   round(100*avgLoss/(avgWin+avgLoss),1):60;
  return {trades:trades.length,latest20:recent.length,latestWins:winners.length,
   recentNetUsd:round(recent.reduce((n,t)=>n+t.net,0)),overallSampleNetUsd:round(trades.reduce((n,t)=>n+t.net,0)),
   trailingWinRatePct:recent.length?round(100*winners.length/recent.length,1):null,
   avgWinUsd:avgWin===null?null:round(avgWin,4),avgLossUsd:avgLoss===null?null:round(avgLoss,4),
   breakEvenWinPct,observedCostsUsd:round(costs),recordsWithCosts:recent.filter(t=>finite(t.fees)&&finite(t.slippage)).length,
   lossStreak,globalPauseUntil,globalReason,markets,validatedEdge:false,
   meaning:'Descriptive device-local Demo fills; the 60% theoretical breakeven assumes +$0.50 winners and -$0.75 losers. Historical winning rate cannot predict future wins.'};
 }
 function create(){
  const streak=new Map();
  function update(signals,histories,closed,now=Date.now()){
   const report=audit(closed,now),second=Math.floor(now/1000);
   const qualified=(Array.isArray(signals)?signals:[]).map(s=>{
    if(!s||s.state!=='WATCH'||!['BUY','SELL'].includes(s.side)){if(s?.symbol)streak.delete(s.symbol);return s}
    const why=[];
    if(report.globalPauseUntil>now)why.push(report.globalReason+'; cooling down until '+new Date(report.globalPauseUntil).toLocaleTimeString());
    const market=report.markets.find(x=>x.symbol===s.symbol);
    if(market?.quarantineUntil>now)why.push('This pair has repeated losing trades; 45-minute quarantine');
    const history=histories?.[s.symbol]||[],samples=history.filter(x=>x&&finite(x.mid)&&x.mid>0&&finite(x.s)&&x.s>=second-60&&x.s<=second);
    if(samples.length<38||second-(samples.at(-1)?.s||0)>3)why.push('Need fresh, continuous price observations');
    else{
     const mid=samples.at(-1).mid,high=Math.max(...samples.map(x=>x.mid)),low=Math.min(...samples.map(x=>x.mid));
     const position=(mid-low)/(high-low||mid*.00001),direction=s.side==='BUY'?1:-1;
     // Do not chase the very last edge of a fast move, especially when
     // 5-second impulse is already stretched; a retest may be less costly.
     if(direction>0&&position>.96&&s.move5Bps>Math.max(5,s.requiredMoveBps*.13))
      why.push('Late long at the upper extreme of a 60s volatility burst');
     if(direction<0&&position<.04&&-s.move5Bps>Math.max(5,s.requiredMoveBps*.13))
      why.push('Late short at the lower extreme of a 60s volatility burst');
    }
    const prior=streak.get(s.symbol);
    const count=prior&&prior.side===s.side&&prior.lastSecond===second-1?prior.count+1:
     prior&&prior.side===s.side&&prior.lastSecond===second?prior.count:1;
    if(why.length){streak.delete(s.symbol)}
    else streak.set(s.symbol,{side:s.side,lastSecond:second,count});
    if(!why.length&&count<MIN_CONFIRMATIONS)why.push('Confirming order flow and momentum '+count+'/'+MIN_CONFIRMATIONS+' consecutive seconds');
    if(why.length)return {...s,state:'WAIT',side:null,reason:why[0],reasons:[...why,...(s.reasons||[])],qualityVeto:'DEMO_INTELLIGENCE_V1'};
    return {...s,qualityVeto:'DEMO_INTELLIGENCE_V1',confirmationSeconds:count};
   });
   return {signals:qualified,report};
  }
  return {update};
 }
 return {create,audit,MIN_CONFIRMATIONS,QUARANTINE_MS,GLOBAL_PAUSE_MS};
});
