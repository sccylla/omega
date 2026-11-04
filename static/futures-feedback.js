'use strict';
// Observed automatic Futures outcomes only. This is a temporary loss control,
// not a learned model, optimized parameter set or estimate of a future edge.
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaFuturesFeedback=api})(typeof window!=='undefined'?window:null,function(){
 const LOOKBACK_MS=60*60000,PAUSE_MS=30*60000,ACCOUNT_PAUSE_MS=60*60000,MAX_RECORDS=200;
 const finite=x=>typeof x==='number'&&Number.isFinite(x);
 function symbolKey(value){
  if(typeof value!=='string'||!/^[A-Z0-9]{2,28}$/.test(value))return null;
  const base=value.endsWith('USDT')?value.slice(0,-4):value;
  return /^[A-Z0-9]{2,24}$/.test(base)&&!base.endsWith('USDT')?base:null;
 }
 function trailingLosses(rows){
  let count=0;
  for(let i=rows.length-1;i>=0;){
   const closedAt=rows[i].closedAt;let groupLosses=0,nonLoss=false;
   // Quotes can close several positions at exactly the same timestamp. IDs
   // cannot tell us whether a loss followed a win inside that simultaneous
   // group, so only an entirely losing group extends the observed streak.
   while(i>=0&&rows[i].closedAt===closedAt){
    if(rows[i].net<0)groupLosses++;else nonLoss=true;
    i--;
   }
   if(nonLoss)break;
   count+=groupLosses;
  }
  return count;
 }
 function assess(records,{symbol,side,now=Date.now()}={}){
  const market=symbolKey(symbol),empty={sampleCount:0,netUsd:0,lossStreak:0,pairPauseUntil:0,accountLossStreak:0,accountPauseUntil:0,pauseUntil:0};
  if(!market||!['BUY','SELL'].includes(side)||!finite(now)||now<=0)
   return {...empty,allowed:false,reason:'Cannot assess Futures feedback: invalid market, direction or clock'};
  // Remove an entire ID if its relevant data disagree, including a malformed
  // duplicate. Identical retransmissions count once and cannot create a streak.
  const byId=new Map(),ambiguous=new Set();
  for(const row of Array.isArray(records)?records:[]){
   if(!row||typeof row.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(row.id))continue;
   const key=symbolKey(row.symbol),net=row.netRaw??row.net;
   const valid=row.auto===true&&row.entryEvidence?.strategy==='evidence-v11'&&key&&
    ['BUY','SELL'].includes(row.side)&&finite(net)&&finite(row.openedAt)&&row.openedAt>0&&
    finite(row.closedAt)&&row.closedAt>row.openedAt&&row.closedAt<=now;
   const value=valid?{id:row.id,symbol:key,side:row.side,net,openedAt:row.openedAt,closedAt:row.closedAt}:null;
   const signature=JSON.stringify(value);
   if(byId.has(row.id)&&byId.get(row.id).signature!==signature)ambiguous.add(row.id);
   else if(!byId.has(row.id))byId.set(row.id,{signature,value});
  }
  const ordered=[...byId.entries()].filter(([id,item])=>!ambiguous.has(id)&&item.value)
   .map(([,item])=>item.value).sort((a,b)=>a.closedAt-b.closedAt||a.id.localeCompare(b.id)).slice(-MAX_RECORDS);
  const relevant=ordered.filter(row=>row.symbol===market&&row.side===side);
  const bucket=relevant.filter(row=>row.closedAt>=now-LOOKBACK_MS);
  const latest=relevant.at(-1);
  // A trigger is established as of the latest close, not recalculated with a
  // sliding wall-clock cutoff. Otherwise its first loss can age out and shorten
  // the promised pause. Counts/net below still describe the recent now-window.
  const triggerWindow=latest?relevant.filter(row=>row.closedAt>=latest.closedAt-LOOKBACK_MS):[];
  const lossStreak=trailingLosses(triggerWindow);
  const until=lossStreak>=2?latest.closedAt+PAUSE_MS:0;
  const pairPauseUntil=until>now?until:0;
  // A sequence across different markets can indicate a broader adverse
  // environment even when no pair has repeated. Keep this independent of
  // candidate selection and apply the same as-of-close trigger convention.
  const accountLatest=ordered.at(-1),accountWindow=accountLatest?ordered.filter(row=>row.closedAt>=accountLatest.closedAt-LOOKBACK_MS):[];
  const accountLossStreak=trailingLosses(accountWindow);
  const accountUntil=accountLossStreak>=3?accountLatest.closedAt+ACCOUNT_PAUSE_MS:0;
  const accountPauseUntil=accountUntil>now?accountUntil:0;
  const pauseUntil=Math.max(pairPauseUntil,accountPauseUntil),allowed=pauseUntil===0;
  return {allowed,sampleCount:bucket.length,netUsd:bucket.reduce((total,row)=>total+row.net,0),lossStreak,pairPauseUntil,accountLossStreak,accountPauseUntil,pauseUntil,
   reason:accountPauseUntil?'Three consecutive losing automatic Futures trades across the account; 60-minute account-wide entry pause':
    pairPauseUntil?'Repeated losing automatic Futures trades in this pair and direction; 30-minute entry pause':
    bucket.length<2?'Insufficient recent closed automatic Futures outcomes for repeated-loss feedback; no learned edge':
    'No active repeated-loss Futures entry pause; observed outcomes do not establish a future edge'};
 }
 return {assess,LOOKBACK_MS,PAUSE_MS,ACCOUNT_PAUSE_MS,MAX_RECORDS};
});
