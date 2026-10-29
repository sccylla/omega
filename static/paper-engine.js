/* OMEGA TRADER V6 — browser-only virtual futures trading arithmetic.
   No private API credentials, no funded broker orders, no promise of profits.
   Uses sampled 5-minute public candle prices, not executable quotes. */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.OmegaPaper=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 const MIN_NOTIONAL_USD=10, INITIAL=10000, FEE_RATE=0.0006, MAX_POSITIONS=2, MAX_NOTIONAL_PCT=20, DAILY_LIMIT_PCT=2;
 const validSymbol=s=>/^[A-Z0-9]{2,24}$/.test(String(s||'')) && !String(s).endsWith('USDT');
 const round=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
 const day=t=>new Date(t).toISOString().slice(0,10);
 function initial(){return {version:6,starting:INITIAL,cash:INITIAL,positions:[],closed:[],createdAt:Date.now(),day:day(Date.now()),dayStartEquity:INITIAL};}
 function valid(s){return s&&s.version===6&&Number.isFinite(s.cash)&&s.cash>=-1000000&&Array.isArray(s.positions)&&Array.isArray(s.closed)&&s.positions.length<=MAX_POSITIONS&&s.positions.every(p=>validSymbol(p.symbol)&&['BUY','SELL'].includes(p.side)&&p.entry>0&&p.qty>0&&p.stop>0&&p.target>0);}
 function restore(s){return valid(s)?s:initial();}
 function markPnl(p,current){return (p.side==='BUY'?1:-1)*p.qty*(current-p.entry);}
 function equity(s,quotes){return s.cash+s.positions.reduce((acc,p)=>acc+markPnl(p,quotes?.[p.symbol]||p.entry),0);}
 function entryPreview(s,quotes,{symbol,side,notional,stopPct=1.5,targetPct=3},now=Date.now()){
  const price=quotes?.[symbol];notional=Number(notional);
  if(!validSymbol(symbol)||!['BUY','SELL'].includes(side))throw Error('Choose a supported demo market and trade direction.');
  if(!Number.isFinite(price)||price<=0)throw Error('Market quote is unavailable. No demo order can be placed.');
  if(!Number.isFinite(notional)||notional<MIN_NOTIONAL_USD)throw Error('Demo position must be at least $10.');
  const eq=equity(s,quotes);
  if(notional>eq*MAX_NOTIONAL_PCT/100+0.01)throw Error('Position exceeds 20% of virtual equity.');
  if(s.positions.length>=MAX_POSITIONS)throw Error('Maximum of two concurrent demo positions.');
  if(s.positions.some(p=>p.symbol===symbol))throw Error('Close the existing '+symbol+' position first.');
  if(day(now)===s.day&&eq<=s.dayStartEquity*(1-DAILY_LIMIT_PCT/100))throw Error('Daily virtual loss limit reached.');
  const qty=notional/price,fee=notional*FEE_RATE,risk=notional*(stopPct/100+2*FEE_RATE);
  if(risk>eq*0.0025+0.01)throw Error('Estimated stop risk exceeds 0.25% of equity. Reduce size.');
  const mult=side==='BUY'?1:-1;
  return {symbol,side,price,notional,qty,fee,stop:price*(1-mult*stopPct/100),target:price*(1+mult*targetPct/100),estimatedStopRisk:risk};
 }
 function open(s,quotes,ticket,now=Date.now()){
  const prev=entryPreview(s,quotes,ticket,now);
  if(day(now)!==s.day){s={...s,day:day(now),dayStartEquity:equity(s,quotes)};}
  const id='paper-'+now+'-'+Math.random().toString(36).slice(2,8);
  const position={id,symbol:prev.symbol,side:prev.side,entry:prev.price,qty:prev.qty,notional:prev.notional,entryFee:prev.fee,stop:prev.stop,target:prev.target,openedAt:now,auto:!!ticket.auto,autoAtr:ticket.auto&&Number.isFinite(ticket.atr)&&ticket.atr>0?ticket.atr:undefined,autoTrailArmed:false,autoBest:prev.price};
  return {...s,cash:s.cash-prev.fee,positions:[...s.positions,position]};
 }
 function close(s,id,price,reason='Manual close',now=Date.now()){
  const p=s.positions.find(x=>x.id===id);
  if(!p)throw Error('Position not found.');
  if(!Number.isFinite(price)||price<=0)throw Error('Fresh market price required to close.');
  const exitFee=p.qty*price*FEE_RATE;
  const net=markPnl(p,price)-exitFee-p.entryFee;
  const record={id:p.id,symbol:p.symbol,side:p.side,entry:p.entry,exit:price,notional:p.notional,net:round(net),reason,openedAt:p.openedAt,closedAt:now};
  return {...s,cash:s.cash+markPnl(p,price)-exitFee,positions:s.positions.filter(x=>x.id!==id),closed:[record,...s.closed].slice(0,100)};
 }
 function applyQuote(s,quotes,now=Date.now(),market={}){
  let out=s;
  for(const original of s.positions){
   const price=quotes?.[original.symbol];if(!Number.isFinite(price)||price<=0)continue;
   let p=original;
   if(p.auto){
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
   const exitNet=markPnl(p,price)-p.entryFee-p.qty*price*FEE_RATE;
   const reversal=!!(p.auto&&p.autoTrailArmed&&market?.[p.symbol]?.reversal&&exitNet>0);
   if(stopped||hitManualTarget||reversal){
    const reason=stopped?(p.auto&&p.autoTrailArmed?'Adaptive profit trail (sampled quote)':'Stop simulated'):reversal?'Profitable trend reversal (sampled quote)':'Target simulated';
    out=close(out,p.id,price,reason,now);
   }
  }
  if(day(now)!==out.day)out={...out,day:day(now),dayStartEquity:equity(out,quotes)};
  return out;
 }
 function todayPnl(s){return round(s.closed.filter(x=>day(x.closedAt)===day(Date.now())).reduce((sum,x)=>sum+x.net,0));}
 return {INITIAL,MIN_NOTIONAL_USD,FEE_RATE,MAX_POSITIONS,MAX_NOTIONAL_PCT,DAILY_LIMIT_PCT,initial,restore,valid,markPnl,equity,entryPreview,open,close,applyQuote,todayPnl,round};
});
