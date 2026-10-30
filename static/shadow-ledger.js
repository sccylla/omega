'use strict';
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaShadowLedger=api})(typeof window!=='undefined'?window:null,function(){
 const VERSION='OMEGA_ADAPTIVE_SHADOW_V1',FIVE=300000,LIMIT=4000,SYMS=new Set(['BTCUSDT','ETHUSDT','SOLUSDT']);
 const num=n=>typeof n==='number'&&Number.isFinite(n),round=(n,d=4)=>Number(n.toFixed(d));
 const initial=()=>({version:1,createdAt:Date.now(),events:[]});
 function restore(s){return s&&s.version===1&&Array.isArray(s.events)&&s.events.length<=LIMIT&&s.events.every(e=>e&&typeof e.id==='string'&&SYMS.has(e.symbol)&&Number.isFinite(e.observedAt)&&['OPEN','CLOSED','INCOMPLETE'].includes(e.status)&&Array.isArray(e.policies))?JSON.parse(JSON.stringify(s)):initial()}
 function accept(raw,signal,now=Date.now()){
  const s=restore(raw);
  if(!signal||signal.mode!=='FORWARD_SHADOW_RESEARCH_ONLY'||signal.version!==VERSION||!SYMS.has(signal.symbol)||
   typeof signal.id!=='string'||signal.id.length>150||!num(signal.observedAt)||!num(signal.forecastBarTime)||
   signal.observedAt>now+1000||now-signal.observedAt>25000||signal.observedAt<signal.forecastBarTime+FIVE||
   !/^[a-f0-9]{24}$/.test(signal.modelFingerprint||'')||!Array.isArray(signal.policies)||
   signal.policies.length!==2||!['BASELINE_067','ADAPTIVE_072'].every((id,i)=>signal.policies[i].id===id))throw Error('Invalid or stale prospective forecast');
  if(s.events.some(e=>e.id===signal.id||e.symbol===signal.symbol&&e.status==='OPEN'))return {state:s,accepted:false};
  if(!signal.policies.some(p=>p.side!=='WAIT'))return {state:s,accepted:false};
  const policies=signal.policies.map(p=>{
   if(p.side==='WAIT')return {id:p.id,side:'WAIT',net:0};
   if(!['BUY','SELL'].includes(p.side)||!num(p.entry)||p.entry<=0||!num(p.stop)||p.stop<=0||!num(p.target)||p.target<=0||
    !num(p.estimatedCostsUsd)||p.estimatedCostsUsd<0||p.notional!==90||
    (p.side==='BUY'&&!(p.stop<p.entry&&p.target>p.entry))||
    (p.side==='SELL'&&!(p.stop>p.entry&&p.target<p.entry)))throw Error('Invalid shadow trade protection');
   return {id:p.id,side:p.side,entry:p.entry,stop:p.stop,target:p.target,notional:p.notional,costs:p.estimatedCostsUsd,net:null,exit:null,reason:null,closedAt:null};
  });
  const e={id:signal.id,symbol:signal.symbol,observedAt:signal.observedAt,forecastBarTime:signal.forecastBarTime,
   fingerprint:signal.modelFingerprint,regime:signal.regime,upEstimate:signal.upEstimate,status:'OPEN',policies};
  return {state:{...s,events:[...s.events,e].slice(-LIMIT)},accepted:true};
 }
 function resolve(raw,{symbol,candles,now=Date.now()}={}){
  const s=restore(raw);if(!SYMS.has(symbol)||!Array.isArray(candles)||!num(now))throw Error('Invalid shadow settlement request');
  const valid=candles.filter(c=>Array.isArray(c)&&c.length>=6&&c.slice(0,6).every(Number.isFinite)&&c[0]+FIVE<=now).sort((a,b)=>a[0]-b[0]);
  let changed=false;
  const events=s.events.map(e=>{
   if(e.symbol!==symbol||e.status!=='OPEN')return e;
   const first=Math.ceil(e.observedAt/FIVE)*FIVE,offset=valid.findIndex(c=>c[0]===first);
   if(offset<0||offset+1>=valid.length){
    if(now-e.observedAt>30*FIVE){changed=true;return {...e,status:'INCOMPLETE',issue:'Required forward candles unavailable; exclude from validation'}}
    return e
   }
   const bars=valid.slice(offset,offset+2);
   if(bars[1][0]!==bars[0][0]+FIVE||bars.some(c=>c[2]<Math.max(c[1],c[4])||c[3]>Math.min(c[1],c[4])||c[3]<=0)){
    changed=true;return {...e,status:'INCOMPLETE',issue:'Gap or invalid OHLCV'}
   }
   const policies=e.policies.map(p=>{
    if(p.side==='WAIT')return {...p,closedAt:bars[1][0]+FIVE};
    const dir=p.side==='BUY'?1:-1;
    let exit=bars[1][4],reason='10-minute time exit',closedAt=bars[1][0]+FIVE;
    for(const bar of bars){
     const stopped=dir===1?bar[3]<=p.stop:bar[2]>=p.stop,profit=dir===1?bar[2]>=p.target:bar[3]<=p.target;
     if(stopped){exit=dir===1?Math.min(p.stop,bar[1]):Math.max(p.stop,bar[1]);reason=profit?'Stop-first ambiguous bar':'Protective stop';closedAt=bar[0]+FIVE;break}
     if(profit){exit=p.target;reason='Modeled net profit target';closedAt=bar[0]+FIVE;break}
    }
    const pnl=dir*(exit-p.entry)*p.notional/p.entry-p.costs;
    return {...p,exit:round(exit,10),net:round(pnl,6),reason,closedAt};
   });
   changed=true;return {...e,status:'CLOSED',policies};
  });
  return {state:changed?{...s,events}:s,changed};
 }
 function stats(events,id){
  const records=events.map(e=>e.policies.find(p=>p.id===id)).filter(p=>p&&p.side!=='WAIT'&&num(p.net));
  let net=0,peak=0,drawdown=0,gains=0,losses=0;
  for(const p of records){net+=p.net;peak=Math.max(peak,net);drawdown=Math.max(drawdown,peak-net);if(p.net>0)gains+=p.net;else losses-=p.net}
  return {count:records.length,netUsd:round(net),wins:records.filter(p=>p.net>0).length,
   winRatePct:records.length?round(100*records.filter(p=>p.net>0).length/records.length,1):null,
   profitFactor:losses>0?round(gains/losses):null,maxDrawdownUsd:round(drawdown)};
 }
 function report(raw){
  const s=restore(raw),closed=s.events.filter(e=>e.status==='CLOSED'),open=s.events.filter(e=>e.status==='OPEN'),missing=s.events.filter(e=>e.status==='INCOMPLETE');
  const baseline=stats(closed,'BASELINE_067'),candidate=stats(closed,'ADAPTIVE_072');
  const dates=closed.filter(e=>e.policies[1].side!=='WAIT'&&num(e.policies[1].net)),spanDays=dates.length>1?(dates.at(-1).observedAt-dates[0].observedAt)/86400000:0;
  const unique=new Set(dates.map(e=>e.symbol)).size,days=new Set(dates.map(e=>new Date(e.observedAt).toISOString().slice(0,10))).size,mid=Math.floor(dates.length/2);
  const early=stats(dates.slice(0,mid),'ADAPTIVE_072'),later=stats(dates.slice(mid),'ADAPTIVE_072');
  const conditions=[
   {name:'At least 60 prospectively logged adaptive trades',pass:candidate.count>=60,actual:candidate.count},
   {name:'At least 14 days of observations',pass:spanDays>=14,actual:round(spanDays,1)},
   {name:'Three distinct observed markets',pass:unique>=3,actual:unique},
   {name:'At least ten trading days',pass:days>=10,actual:days},
   {name:'Net after modeled costs and profit factor at least 1.25',pass:candidate.netUsd>0&&candidate.profitFactor!==null&&candidate.profitFactor>=1.25,actual:candidate.netUsd},
   {name:'Adaptive beats original baseline on same observations',pass:candidate.netUsd>baseline.netUsd,actual:round(candidate.netUsd-baseline.netUsd)},
   {name:'Both chronological halves profitable',pass:early.netUsd>0&&later.netUsd>0,actual:[early.netUsd,later.netUsd]},
   {name:'Modeled drawdown at most $10',pass:candidate.maxDrawdownUsd<=10,actual:candidate.maxDrawdownUsd},
   {name:'All trials settled with complete market data',pass:open.length===0&&missing.length===0,actual:{open:open.length,incomplete:missing.length}}
  ];
  const passed=conditions.every(x=>x.pass);
  return {mode:'SHADOW_RESEARCH_AUDIT',stage:passed?'SHADOW_EVIDENCE_GATE_PASSED_RESEARCH_ONLY':'INSUFFICIENT_FORWARD_EVIDENCE',
   passed,baseline,candidate,closedObservations:closed.length,openObservations:open.length,incompleteObservations:missing.length,
   forwardDays:round(spanDays,1),uniqueSymbols:unique,calendarDays:days,conditions,liveExecutionAffected:false,
   limitations:'Device-local, editable shadow journal is not independently audited; modeled fills and 5m bars do not prove broker execution. This is a fixed 10-minute candidate (.72) vs baseline (.67). It is not a validated live strategy, and cannot auto-change any funded orders.'};
 }
 return {VERSION,initial,restore,accept,resolve,report};
});
