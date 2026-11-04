'use strict';
// Confirmed historical price structure is a risk constraint, not a price forecast.
// Pivot recognition uses two later *completed* bars; partial bars never count.
const FIVE=300000,QUARTER=900000;
const average=values=>values.reduce((sum,value)=>sum+value/values.length,0);
const directional=(row,side)=>side==='BUY'?(row[4]-row[3])/(row[2]-row[3]||1):(row[2]-row[4])/(row[2]-row[3]||1);
function unavailable(reason){return {ready:false,checks:[{label:'Completed price structure is usable',pass:false,detail:reason}],metrics:{},setup:'UNAVAILABLE',reason}}
function completed(rows,period,minimum,now){
 if(!Array.isArray(rows))return null;
 const output=[];
 for(const row of rows){
  if(!Array.isArray(row)||!Number.isSafeInteger(row[0])||row[0]<=0||row[0]%period!==0)return null;
  if(row[0]+period>now)continue;
  if(row.length<6||!row.slice(0,6).every(Number.isFinite)||row.slice(1,5).some(n=>n<=0)||row[5]<0||row[2]<Math.max(row[1],row[4])||row[3]>Math.min(row[1],row[4])||row[2]<row[3]||output.length&&row[0]-output.at(-1)[0]!==period)return null;
  output.push(row);
 }
 return output.length>=minimum&&now-output.at(-1)[0]-period<=period+60000?output:null;
}
function pivots(rows,side,period){
 const result=[],field=side==='BUY'?2:3,sign=side==='BUY'?1:-1;
 for(let i=2;i<rows.length-2;i++){
  const neighbors=[rows[i-2],rows[i-1],rows[i+1],rows[i+2]].map(row=>sign*row[field]),value=sign*rows[i][field];
  if(neighbors.every(n=>value>=n)&&neighbors.some(n=>value>n))result.push({price:rows[i][field],at:rows[i][0],confirmedAt:rows[i+2][0]+period,timeframe:period});
 }
 return result;
}
function levels(points,tolerance){
 const groups=[];
 for(const point of points.slice().sort((a,b)=>a.price-b.price)){
  const group=groups.at(-1);
  if(!group||point.price-group.minimum>tolerance)groups.push({minimum:point.price,points:[point]});else group.points.push(point);
 }
 return groups.map(group=>({price:average(group.points.map(p=>p.price)),tests:new Set(group.points.map(p=>Math.floor(p.at/QUARTER))).size,confirmedAt:Math.max(...group.points.map(p=>p.confirmedAt)),lastTestAt:Math.max(...group.points.map(p=>p.at)),timeframes:[...new Set(group.points.map(p=>p.timeframe))]}));
}
function analyzeStructure({five,quarter,side,now=Date.now(),entry,atr,stopPct,costRate,targetNet,notional}={}){
 if(!['BUY','SELL'].includes(side)||![now,entry,atr,stopPct,costRate,targetNet,notional].every(Number.isFinite)||entry<=0||atr<=0||stopPct<=0||stopPct>10||costRate<0||costRate>=.1||targetNet<=0||notional<=0)return unavailable('Invalid structure or execution-plan inputs');
 const fast=completed(five,FIVE,40,now),slow=completed(quarter,QUARTER,20,now);
 if(!fast||!slow)return unavailable('Need fresh, ordered, contiguous completed 5m and 15m OHLCV history');
 const direction=side==='BUY'?1:-1,last=fast.at(-1),buffer=atr*.15,tolerance=atr*.25;
 const confirmed=levels([...pivots(fast.slice(-120),side,FIVE),...pivots(slow.slice(-80),side,QUARTER)],tolerance);
 const riskUsd=notional*(stopPct/100+costRate),costUsd=notional*costRate;
 if(!Number.isFinite(riskUsd)||!Number.isFinite(costUsd)||!Number.isFinite(buffer)||!Number.isFinite(tolerance))return unavailable('Execution-plan scale cannot support finite structure calculations');
 const rejections=[];
 for(const level of confirmed)for(const row of fast.slice(-3)){
  if(level.confirmedAt>row[0]||direction*(last[4]-level.price)>buffer||direction*(entry-level.price)>buffer)continue;
  const range=row[2]-row[3],wick=side==='BUY'?row[2]-Math.max(row[1],row[4]):Math.min(row[1],row[4])-row[3];
  const extreme=side==='BUY'?row[2]:row[3];
  if(direction*(extreme-level.price)>=-buffer&&direction*(row[4]-level.price)<=-buffer&&range>0&&wick/range>=.55&&wick>=atr*.4&&directional(row,side)<=.45)rejections.push(level);
 }
 const tested=confirmed.filter(level=>level.tests>=2),breakouts=[];
 for(const level of tested){
  for(let i=Math.max(20,fast.length-12);i<fast.length;i++){
   const row=fast[i],prior=fast[i-1];
   if(level.confirmedAt>row[0]||direction*(row[4]-level.price)<buffer||direction*(prior[4]-level.price)>buffer)continue;
   const baseline=average(fast.slice(i-20,i).map(r=>r[5]));
   const strong=direction*(row[4]-row[1])>=atr*.2&&directional(row,side)>=.7&&row[2]-row[3]<=atr*3&&baseline>0&&row[5]>=baseline*1.2;
   const remainsBeyond=direction*(last[4]-level.price)>=buffer*.3&&direction*(entry-level.price)>=-buffer*.5;
   const after=fast.slice(i+1),held=after.every(r=>direction*(r[4]-level.price)>=-buffer),retested=strong&&remainsBeyond&&held&&after.some(r=>{
    const near=side==='BUY'?r[3]:r[2];
    return Math.abs(near-level.price)<=atr*.3&&direction*(r[4]-level.price)>=buffer*.3&&directional(r,side)>=.55;
   });
   breakouts.push({level,index:i,strong,remainsBeyond,retested,held});
  }
 }
 // A new crossing of a repeatedly tested level needs confirmation. Established
 // continuation above a level does not need to reproduce the original volume.
 const crossing=breakouts.filter(b=>b.index>=fast.length-3&&b.remainsBeyond).sort((a,b)=>b.index-a.index)[0];
 const confirmedBreak=breakouts.filter(b=>b.strong&&b.remainsBeyond&&b.held).sort((a,b)=>b.index-a.index)[0];
 const breakoutPass=!crossing||crossing.strong||!!confirmedBreak?.retested;
 const obstacles=tested.filter(level=>direction*(entry-level.price)<buffer||direction*(last[4]-level.price)<buffer)
  .sort((a,b)=>direction*(a.price-b.price));
 const nearest=obstacles[0]||null,distance=nearest?Math.max(0,direction*(nearest.price-entry)):null;
 const headroom=nearest?notional*distance/entry-costUsd:null,headroomRiskRatio=headroom!==null?headroom/riskUsd:null,distanceAtr=distance!==null?distance/atr:null;
 if(headroom!==null&&!Number.isFinite(headroom)||headroomRiskRatio!==null&&!Number.isFinite(headroomRiskRatio)||distanceAtr!==null&&!Number.isFinite(distanceAtr))return unavailable('Opposing price levels cannot support finite headroom calculations');
 const roomPass=!nearest||headroom>=targetNet&&headroomRiskRatio>=1.1;
 const checks=[
  {label:'No fresh rejection at a confirmed opposing level',pass:rejections.length===0,detail:rejections.length?'Recent completed candles rejected '+(side==='BUY'?'resistance':'support')+' near '+rejections[0].price.toPrecision(7)+'; the current price has not reclaimed it':'No recent qualifying rejection wick at an already confirmed pivot'},
  {label:'A new breakout through a tested level has price and volume confirmation',pass:breakoutPass,detail:crossing?'Close must clear 0.15 ATR, finish in its directional 30%, and carry at least 1.2 times preceding volume'+(crossing.strong?'; confirmed':' ; confirmation missing'):'No new crossing of a repeatedly tested level requires confirmation'},
  {label:'Repeated opposing levels leave room after estimated costs',pass:roomPass,detail:nearest?'Nearest level '+nearest.price.toPrecision(7)+' ('+nearest.tests+' separate 15m test windows); modeled net room $'+headroom.toFixed(3)+' / stop-and-cost risk $'+riskUsd.toFixed(3)+'; requested net target $'+targetNet.toFixed(3):'No repeatedly tested opposing level found in this history; future price room is unknown'}
 ];
 const failed=checks.find(c=>!c.pass),setup=rejections.length?'REJECTION':!breakoutPass?'UNCONFIRMED_BREAKOUT':!roomPass?'CONGESTED':confirmedBreak?.retested?'BREAKOUT_RETEST':confirmedBreak?'CONFIRMED_BREAKOUT':'CONTINUATION';
 return {ready:true,checks,metrics:{confirmedPivotLevels:confirmed.length,repeatedLevels:tested.length,nearestOpposingLevel:nearest?.price??null,opposingLevelTests:nearest?.tests??0,distanceAtr,netHeadroomUsd:headroom,headroomRiskRatio,estimatedStopRiskUsd:riskUsd,estimatedRoundTripCostUsd:costUsd,breakoutLevel:confirmedBreak?.level.price??crossing?.level.price??null,lastClosedAt:last[0]+FIVE},setup,reason:failed?.detail||'Observed structure does not veto this continuation setup'};
}
module.exports={analyzeStructure};
