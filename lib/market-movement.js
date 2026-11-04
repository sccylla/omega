'use strict';
// Interpretable movement checks over completed candles. These are fixed risk
// filters, not a trained model, a win probability, or a profit forecast.
const MIN_CANDLES=37,RECENT=12;
const mean=values=>values.reduce((sum,n)=>sum+n/values.length,0);
const median=values=>{const sorted=values.slice().sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2};
function unavailable(detail){return {ready:false,regime:'UNAVAILABLE',checks:[{label:'Completed movement history is usable',pass:false,detail}],metrics:{}}}
function analyzeMovement(rows,{side,now=Date.now(),period=300000}={}){
 if(!['BUY','SELL'].includes(side)||!Number.isFinite(now)||!Number.isSafeInteger(period)||period<=0||!Array.isArray(rows))return unavailable('Invalid movement-analysis inputs');
 const closed=[];
 for(const row of rows){
  if(!Array.isArray(row)||!Number.isSafeInteger(row[0])||row[0]<=0||row[0]%period!==0)return unavailable('Invalid candle timestamp');
  // In-progress and later bars are never visible to this analysis. Their prices
  // cannot change today's signal or an analysis evaluated at a historical time.
  if(row[0]+period>now)continue;
  if(row.length<6||!row.slice(0,6).every(Number.isFinite)||row.slice(1,5).some(n=>n<=0)||row[5]<0||row[2]<Math.max(row[1],row[4])||row[3]>Math.min(row[1],row[4])||row[2]<row[3])return unavailable('Malformed completed OHLCV candle');
  if(closed.length&&row[0]-closed.at(-1)[0]!==period)return unavailable('Completed candles must be ordered, unique and contiguous');
  closed.push(row);
 }
 if(closed.length<MIN_CANDLES)return unavailable('Need at least '+MIN_CANDLES+' completed candles');
 const ageMs=now-closed.at(-1)[0]-period;
 if(ageMs>period+60000)return unavailable('Completed movement history is stale');
 const sample=closed.slice(-MIN_CANDLES),changes=[];
 for(let i=1;i<sample.length;i++){
  const r=sample[i],previous=sample[i-1][4];
  const move=(Math.log(r[4])-Math.log(previous))*10000,range=Math.max(r[2]-r[3],Math.abs(r[2]-previous),Math.abs(r[3]-previous))/previous*10000;
  if(!Number.isFinite(move)||!Number.isFinite(range))return unavailable('Completed price scale cannot support finite movement calculations');
  changes.push({move,range,volume:r[5]});
 }
 const baseline=changes.slice(0,-RECENT),recent=changes.slice(-RECENT),latest=recent.slice(-3),prior=recent.slice(-6,-3),direction=side==='BUY'?1:-1;
 const net12Bps=recent.reduce((n,x)=>n+x.move,0),travel=recent.reduce((n,x)=>n+Math.abs(x.move),0),efficiency=travel>0?Math.min(1,Math.abs(net12Bps)/travel):0;
 const momentum3Bps=latest.reduce((n,x)=>n+x.move,0),previous3Bps=prior.reduce((n,x)=>n+x.move,0);
 const baselineRangeBps=median(baseline.map(x=>x.range)),recentRangeBps=mean(recent.map(x=>x.range));
 // A zero-range baseline cannot establish that a new volatility burst is normal.
 const volatilityRatio=baselineRangeBps>0?recentRangeBps/baselineRangeBps:null;
 const spikeRatio=baselineRangeBps>0?Math.max(...latest.map(x=>x.range))/baselineRangeBps:null;
 const choppy=efficiency<.18,opposing=direction*net12Bps<=0;
 const reversal=direction*momentum3Bps < -Math.max(2,baselineRangeBps*.5);
 const abnormal=volatilityRatio===null||spikeRatio===null||volatilityRatio>2.2||spikeRatio>4;
 const slowing=direction*previous3Bps>0&&direction*momentum3Bps>=0&&direction*momentum3Bps<direction*previous3Bps*.35;
 const baselineVolume=mean(baseline.map(x=>x.volume)),recentVolume=mean(latest.map(x=>x.volume)),volumeRatio=baselineVolume>0?recentVolume/baselineVolume:null;
 if(!Number.isFinite(volatilityRatio)&&volatilityRatio!==null||!Number.isFinite(spikeRatio)&&spikeRatio!==null)return unavailable('Preceding range baseline cannot support finite movement ratios');
 const checks=[
  {label:'Recent movement is directional rather than choppy',pass:!choppy&&!opposing,detail:'12-bar efficiency '+(efficiency*100).toFixed(1)+'%; signed movement '+(direction*net12Bps).toFixed(1)+' bp for '+side},
  {label:'Short-term momentum has not materially reversed',pass:!reversal,detail:'Latest 3 bars '+momentum3Bps.toFixed(1)+' bp; preceding 3 bars '+previous3Bps.toFixed(1)+' bp'+(slowing?'; momentum is slowing, without a confirmed reversal':'')},
  {label:'Recent volatility fits its preceding baseline',pass:!abnormal,detail:baselineRangeBps>0?'12-bar range ratio '+volatilityRatio.toFixed(2)+'; largest latest range '+spikeRatio.toFixed(2)+' times prior median':'No nonzero preceding range baseline'}
 ];
 return {ready:true,regime:abnormal?'VOLATILITY_SHOCK':choppy?'CHOP':reversal||opposing?'REVERSAL':slowing?'DECELERATING':'DIRECTIONAL',checks,metrics:{efficiency,net12Bps,momentum3Bps,previous3Bps,baselineRangeBps,recentRangeBps,volatilityRatio,spikeRatio,volumeRatio:Number.isFinite(volumeRatio)?volumeRatio:null,ageMs,lastClosedAt:closed.at(-1)[0]+period,period}};
}
module.exports={analyzeMovement,MIN_CANDLES};
