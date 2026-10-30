'use strict';
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaForwardValidation=api})(typeof window!=='undefined'?window:null,function(){
 const POLICY='OMEGA_FORWARD_V1',MIN_TRADES=60,MIN_DAYS=14,MIN_SYMBOLS=3;
 const rounded=(n,d=3)=>Number(n.toFixed(d));
 function aggregate(records){
  let net=0,peak=0,maxDrawdown=0,gains=0,losses=0,wins=0;
  const symbols=new Set(),regions=new Map();
  for(const r of records){
   net+=r.netRaw;peak=Math.max(peak,net);maxDrawdown=Math.max(maxDrawdown,peak-net);
   wins+=Number(r.netRaw>0);if(r.netRaw>0)gains+=r.netRaw;else losses-=r.netRaw;
   symbols.add(r.symbol);
   const regime=r.entryEvidence.regime,s=regions.get(regime)||{name:regime,count:0,wins:0,net:0};
   s.count++;s.wins+=Number(r.netRaw>0);s.net+=r.netRaw;regions.set(regime,s);
  }
  return {count:records.length,netUsd:rounded(net),wins,winRatePct:records.length?rounded(wins/records.length*100,1):null,
   profitFactor:losses>0?rounded(gains/losses):null,maxDrawdownUsd:rounded(maxDrawdown),
   distinctSymbols:symbols.size,regimes:[...regions.values()].map(x=>({...x,net:rounded(x.net)}))};
 }
 function evaluateForward(records,{now=Date.now()}={}){
  const rejected={missingProvenance:0,invalidRecord:0,duplicates:0};
  const unique=new Set(),clean=[];
  for(const p of Array.isArray(records)?records:[]){
   const tag=p?.entryEvidence;
   if(!p||p.auto!==true||tag?.forwardValidationVersion!==POLICY||tag.executionPolicy!=='DEMO_FORWARD_TEST'||tag.strategy!=='evidence-v11'){
    rejected.missingProvenance++;continue
   }
   if(typeof p.id!=='string'||p.id.length>150||!p.id||
    !/^[A-Z0-9]{2,24}$/.test(p.symbol)||!['BUY','SELL'].includes(p.side)||
    !Number.isFinite(p.openedAt)||!Number.isFinite(p.closedAt)||p.openedAt>=p.closedAt||p.closedAt>now+60000||
    p.openedAt<Date.UTC(2025,0,1)||!Number.isFinite(p.netRaw)||Math.abs(p.netRaw)>100000||
    !Number.isFinite(tag.qualityScore)||tag.qualityScore<0||tag.qualityScore>100||
    !['TREND','RANGE / TRANSITION','HIGH VOLATILITY'].includes(tag.regime)){
    rejected.invalidRecord++;continue
   }
   if(unique.has(p.id)){rejected.duplicates++;continue}
   unique.add(p.id);clean.push(p);
  }
  clean.sort((a,b)=>a.closedAt-b.closedAt);
  const summary=aggregate(clean);
  const first=clean[0]?.closedAt??null,last=clean.at(-1)?.closedAt??null;
  const spanDays=first!==null?(last-first)/86400000:0;
  const firstHalf=aggregate(clean.slice(0,Math.floor(clean.length/2)));
  const secondHalf=aggregate(clean.slice(Math.floor(clean.length/2)));
  const uniqueCalendarDays=new Set(clean.map(x=>new Date(x.closedAt).toISOString().slice(0,10))).size;
  const conditions=[
   {name:'Enough completed, independently tagged forward Demo trades',pass:clean.length>=MIN_TRADES,actual:clean.length,required:MIN_TRADES},
   {name:'Results span more than two weeks',pass:spanDays>=MIN_DAYS,actual:rounded(spanDays,1),required:MIN_DAYS},
   {name:'Trades cover multiple independent symbols',pass:summary.distinctSymbols>=MIN_SYMBOLS,actual:summary.distinctSymbols,required:MIN_SYMBOLS},
   {name:'Trades took place on at least ten separate days',pass:uniqueCalendarDays>=10,actual:uniqueCalendarDays,required:10},
   {name:'After-fee forward results are positive',pass:summary.netUsd>0&&summary.profitFactor!==null&&summary.profitFactor>=1.25,actual:summary.netUsd,required:'Positive net; profit factor ≥1.25'},
   {name:'Results were positive in both chronological halves',pass:firstHalf.netUsd>0&&secondHalf.netUsd>0,actual:[firstHalf.netUsd,secondHalf.netUsd],required:'Both >0'},
   {name:'Maximum observed drawdown stays within $10 Demo budget',pass:summary.maxDrawdownUsd<=10,actual:summary.maxDrawdownUsd,required:'≤$10'}
  ];
  const passed=conditions.every(x=>x.pass);
  return {
   mode:'FORWARD_TRADE_VALIDATION',policy:POLICY,source:'COMPLETED_DEMO_FORWARD_TEST',
   stage:passed?'FORWARD_DEMO_GATE_PASSED_RESEARCH_ONLY':'NOT_VALIDATED',
   passed,conditions,sample:summary,period:{first,last,spanDays:rounded(spanDays,1),calendarDays:uniqueCalendarDays},
   firstHalf,secondHalf,rejected,retained:clean.length,
   note:passed?'Demo forward-trade audit passed. This still cannot validate Bybit execution, adaptive-policy attribution or future profitability; separate sign-off and live safety review required.':'Do not promote an adaptive strategy. Continue collecting tagged closed Demo trades; failed requirements are shown above.',
   limitations:'Only closed trades entered by OMEGA Demo after this tagging update are included; no unmatched manual, older, open or broker trades count. The data may be device-local or synced and is not independently audited or tamper-proof. Observational outcomes do not establish what skipped trades would have earned. This is a forward sample-quality gate, NOT proof of an adaptive model edge. No automatic live trading rules are changed.'
  };
 }
 return {evaluateForward,POLICY,MIN_TRADES,MIN_DAYS,MIN_SYMBOLS};
});
