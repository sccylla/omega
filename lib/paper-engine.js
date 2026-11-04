/* OMEGA TRADER — virtual futures trading arithmetic for local/shared ledgers.
   No private API credentials, no funded broker orders, no promise of profits.
   Uses sampled 5-minute public candle prices, not executable quotes. */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.OmegaPaper=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const MIN_NOTIONAL_USD=100, MANUAL_MIN_NOTIONAL_USD=100, INITIAL=1500, FEE_RATE=0.0006, MAX_POSITIONS=10, MAX_NOTIONAL_PCT=100, DAILY_LIMIT_PCT=2, MAX_STOP_RISK_PCT=2, MIN_PROFIT_USD=5, MIN_AUTO_PROFIT_USD=.05;
 const validSymbol=s=>/^[A-Z0-9]{2,24}$/.test(String(s||'')) && !String(s).endsWith('USDT');
 const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
 const day=t=>new Date(t).toISOString().slice(0,10);
 function initial(){return {version:7,demoFundingVersion:2,starting:INITIAL,cash:INITIAL,positions:[],closed:[],createdAt:Date.now(),day:day(Date.now()),dayStartEquity:INITIAL};}
 function valid(s){return s&&s.version===7&&Number.isFinite(s.cash)&&s.cash>=-1000000&&Array.isArray(s.positions)&&Array.isArray(s.closed)&&s.positions.length<=MAX_POSITIONS&&s.positions.every(p=>validSymbol(p.symbol)&&['BUY','SELL'].includes(p.side)&&p.entry>0&&p.qty>0&&p.stop>0&&p.target>0);}
 function restore(s){
  if(!valid(s))return initial();
  // One-time, history-preserving $1,400 virtual top-up for old $100
  // Futures ledgers, including saved browser and synced cloud accounts.
  // The version marker prevents a second credit after a transaction.
  let funded=s;
  if(s.starting===100&&s.demoFundingVersion!==2&&
    Number.isFinite(s.dayStartEquity)&&s.dayStartEquity>0){
   funded={...s,cash:s.cash+(INITIAL-100),
    dayStartEquity:s.dayStartEquity+(INITIAL-100),
    starting:INITIAL,demoFundingVersion:2};
  }
  let changed=false;
  const positions=funded.positions.map(p=>{
   if(p.auto&&(p.closeOnProfit||p.entryEvidence?.strategy==='evidence-v11')&&(p.closeOnProfit||!(p.targetNet>=(p.notional<100?MIN_AUTO_PROFIT_USD:MIN_PROFIT_USD)))){
    changed=true;return {...p,closeOnProfit:false,targetNet:Math.max(p.notional<100?MIN_AUTO_PROFIT_USD:MIN_PROFIT_USD,Number(p.targetNet)||0)};
   }
   return p;
  });
  return changed?{...funded,positions}:funded;
 }
 function markPnl(p,current){return (p.side==='BUY'?1:-1)*p.qty*(current-p.entry);}
 function equity(s,quotes){return s.cash+s.positions.reduce((acc,p)=>acc+markPnl(p,quotes?.[p.symbol]||p.entry),0);}
 function entryPreview(s,quotes,{symbol,side,notional,auto=false,stopPct=1.5,targetPct=3,slippageBps=0,entryEvidence},now=Date.now()){
  const price=quotes?.[symbol];notional=Number(notional);
  if(!validSymbol(symbol)||!['BUY','SELL'].includes(side))throw Error('Choose a supported demo market and trade direction.');
  if(!Number.isFinite(price)||price<=0)throw Error('Market quote is unavailable. No demo order can be placed.');
  if(!Number.isFinite(notional)||notional<(auto?MIN_NOTIONAL_USD:MANUAL_MIN_NOTIONAL_USD))throw Error('Demo position must meet the $'+(auto?MIN_NOTIONAL_USD:MANUAL_MIN_NOTIONAL_USD)+' minimum.');
  if(!Number.isFinite(stopPct)||stopPct<=0||stopPct>10||!Number.isFinite(targetPct)||targetPct<=0||targetPct>50)throw Error('Invalid stop or profit target.');
  const eq=equity(s,quotes);
  if(s.positions.length>=MAX_POSITIONS)throw Error('10 demo position slots filled. Manage exits before opening another.');
  if(s.positions.some(p=>p.symbol===symbol))throw Error('Close the existing '+symbol+' position first.');
  if(day(now)===s.day&&eq<=s.dayStartEquity*(1-DAILY_LIMIT_PCT/100))throw Error('Daily virtual loss limit reached.');
  const committed=s.positions.reduce((sum,p)=>sum+Number(p.notional||0),0);
  if(committed+notional>eq*MAX_NOTIONAL_PCT/100+.001)
   throw Error('Insufficient uncommitted virtual equity: all demo positions together must fit within the account balance.');
  const qty=notional/price,fee=notional*FEE_RATE,risk=notional*(stopPct/100+2*FEE_RATE);
  const allocatedRisk=s.positions.reduce((sum,p)=>sum+Math.abs(p.entry-p.stop)*p.qty+
   Number(p.notional||0)*FEE_RATE*2,0);
  if(allocatedRisk+risk>eq*MAX_STOP_RISK_PCT/100+0.01)
   throw Error('Combined estimated stops and fees exceed 2% of demo account equity.');
  const mult=side==='BUY'?1:-1;
  if(auto&&entryEvidence?.strategy==='evidence-v11'){
   // Cash already includes existing entry fees. Project only remaining stop
   // liquidation deltas, then the new entry fee and stop liquidation. Do not
   // borrow against modeled profits at tightened stops, or apply entry slip twice.
   const slip=Number(slippageBps),baseline=day(now)===s.day?s.dayStartEquity:eq;
   if(!Number.isFinite(slip)||slip<0||slip>50||!Number.isFinite(baseline)||baseline<=0)throw Error('Demo daily risk accounting is unavailable.');
   let existingStopDelta=0;
   for(const p of s.positions){
    const d=p.side==='BUY'?1:p.side==='SELL'?-1:NaN,exitSlip=Number(p.slippageBps??0);
    const fill=p.stop*(1-d*exitSlip/10000);
    const delta=d*p.qty*(fill-p.entry)-p.qty*fill*FEE_RATE;
    if(!Number.isFinite(exitSlip)||exitSlip<0||exitSlip>50||!Number.isFinite(delta)||!Number.isFinite(fill)||fill<=0)throw Error('Existing position stop accounting is unavailable.');
    existingStopDelta+=Math.min(0,delta);
   }
   const stopFill=price*(1-mult*stopPct/100)*(1-mult*slip/10000);
   const candidateDelta=-fee+mult*qty*(stopFill-price)-qty*stopFill*FEE_RATE;
   const projectedStopCash=s.cash+existingStopDelta+candidateDelta;
   if(!Number.isFinite(projectedStopCash)||projectedStopCash+1e-8<baseline*(1-DAILY_LIMIT_PCT/100))
    throw Error('Remaining daily Demo loss allowance cannot cover existing stops plus this entry and estimated costs.');
  }
  return {symbol,side,price,notional,qty,fee,stop:price*(1-mult*stopPct/100),target:price*(1+mult*targetPct/100),estimatedStopRisk:risk};
 }
 function open(s,quotes,ticket,now=Date.now()){
  const slip=Number(ticket.slippageBps||0);
  if(!Number.isFinite(slip)||slip<0||slip>50)throw Error('Invalid execution-cost assumption.');
  if(ticket.targetNet!==undefined&&(!Number.isFinite(ticket.targetNet)||ticket.targetNet<=0))throw Error('Invalid net profit target.');
  const fill=quotes?.[ticket.symbol]*(1+(ticket.side==='BUY'?1:-1)*slip/10000);
  const prev=entryPreview(s,{...quotes,[ticket.symbol]:fill},ticket,now);
  if(day(now)!==s.day){s={...s,day:day(now),dayStartEquity:equity(s,quotes)};}
  const id='paper-'+now+'-'+Math.random().toString(36).slice(2,8);
  const meaningful=ticket.auto&&(ticket.closeOnProfit||ticket.entryEvidence?.strategy==='evidence-v11');
  const position={id,symbol:prev.symbol,side:prev.side,entry:prev.price,qty:prev.qty,notional:prev.notional,entryFee:prev.fee,stop:prev.stop,target:prev.target,openedAt:now,auto:!!ticket.auto,closeOnProfit:false,autoAtr:ticket.auto&&Number.isFinite(ticket.atr)&&ticket.atr>0?ticket.atr:undefined,autoTrailArmed:false,autoBest:prev.price,slippageBps:slip,targetNet:meaningful?Math.max(prev.notional<100?MIN_AUTO_PROFIT_USD:MIN_PROFIT_USD,Number(ticket.targetNet)||0):ticket.auto?ticket.targetNet:undefined,entryEvidence:ticket.entryEvidence};
  return {...s,cash:s.cash-prev.fee,positions:[...s.positions,position]};
 }
 function close(s,id,price,reason='Manual close',now=Date.now()){
  const p=s.positions.find(x=>x.id===id);
  if(!p)throw Error('Position not found.');
  if(!Number.isFinite(price)||price<=0)throw Error('Fresh market price required to close.');
  price*=1-(p.side==='BUY'?1:-1)*(p.slippageBps||0)/10000;
  const exitFee=p.qty*price*FEE_RATE;
  const net=markPnl(p,price)-exitFee-p.entryFee;
  const record={id:p.id,symbol:p.symbol,side:p.side,entry:p.entry,exit:price,notional:p.notional,auto:!!p.auto,entryEvidence:p.entryEvidence,net:round(net),netRaw:net,reason,openedAt:p.openedAt,closedAt:now};
  return {...s,cash:s.cash+markPnl(p,price)-exitFee,positions:s.positions.filter(x=>x.id!==id),closed:[record,...s.closed].slice(0,100)};
 }
 function applyQuote(s,quotes,now=Date.now(),market={}){
  let out=s;
  for(const original of s.positions){
   const price=quotes?.[original.symbol];if(!Number.isFinite(price)||price<=0)continue;
   let p=original;
   const evidencePolicy=p.entryEvidence?.strategy==='evidence-v11';
   if(p.auto&&!evidencePolicy){
    const info=market?.[p.symbol]||{};
    const a=Number.isFinite(info.atr)&&info.atr>0?info.atr:p.autoAtr;
    if(Number.isFinite(a)&&a>0){
     const d=p.side==='BUY'?1:-1;
     const priorBest=Number.isFinite(p.autoBest)&&p.autoBest>0?p.autoBest:p.entry;
     const best=d===1?Math.max(priorBest,price):Math.min(priorBest,price);
     const gap=Math.max(1.25*a,p.entry*0.0025);
     const feeAndProfitBuffer=p.entry*(2*FEE_RATE+0.0005);
     let stop=p.stop,armed=!!p.autoTrailArmed;
     const candidate=best-d*gap,lockedMovement=d*(candidate-p.entry);
     if(lockedMovement>=feeAndProfitBuffer){
      stop=d===1?Math.max(stop,candidate):Math.min(stop,candidate);
      armed=true;
     }
     if(best!==priorBest||stop!==p.stop||armed!==!!p.autoTrailArmed){
      p={...p,autoBest:best,autoAtr:a,autoTrailArmed:armed,stop};
      out={...out,positions:out.positions.map(item=>item.id===p.id?p:item)};
     }
    }
   }
   const stopped=p.side==='BUY'?price<=p.stop:price>=p.stop;
   const hitManualTarget=!p.auto&&(p.side==='BUY'?price>=p.target:price<=p.target);
   const fill=price*(1-(p.side==='BUY'?1:-1)*(p.slippageBps||0)/10000);
   const exitNet=markPnl(p,fill)-p.entryFee-p.qty*fill*FEE_RATE;
   const meaningful=p.closeOnProfit||evidencePolicy;
   const profitTarget=p.auto&&(meaningful?exitNet>=Math.max(p.notional<100?MIN_AUTO_PROFIT_USD:MIN_PROFIT_USD,Number(p.targetNet)||0):Number.isFinite(p.targetNet)&&exitNet>=p.targetNet);
   const reversal=!!(!evidencePolicy&&p.auto&&p.autoTrailArmed&&market?.[p.symbol]?.reversal&&exitNet>0);
   if(stopped||hitManualTarget||reversal||profitTarget){
    const reason=stopped?(p.auto&&p.autoTrailArmed?'Adaptive profit trail (sampled quote)':'Stop simulated'):profitTarget?'Net profit target (after estimated costs)':reversal?'Profitable trend reversal (sampled quote)':'Target simulated';
    out=close(out,p.id,price,reason,now);
   }
  }
  if(day(now)!==out.day)out={...out,day:day(now),dayStartEquity:equity(out,quotes)};
  return out;
 }
 function todayPnl(s){return round(s.closed.filter(x=>day(x.closedAt)===day(Date.now())).reduce((sum,x)=>sum+x.net,0));}
 return {INITIAL,MIN_NOTIONAL_USD,MANUAL_MIN_NOTIONAL_USD,MIN_AUTO_PROFIT_USD,FEE_RATE,MAX_POSITIONS,MAX_NOTIONAL_PCT,DAILY_LIMIT_PCT,MAX_STOP_RISK_PCT,MIN_PROFIT_USD,initial,restore,valid,markPnl,equity,entryPreview,open,close,applyQuote,todayPnl,round};
});
