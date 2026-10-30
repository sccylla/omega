'use strict';
// Validated, page-bounded public Bybit 5m history; never uses current candles.
// Each page requests an explicit, non-overlapping calendar interval.
const PERIOD=300000,BASE='https://api.bybit.com',PAGE_SIZE=960;
const DAY_LENGTH=86400000,ALLOWED_DAYS=new Set([7,28,56]);
async function readHistory(symbol,{days=56,now=Date.now(),fetcher=fetch,concurrency=5}={}){
 if(!/^[A-Z0-9]{2,20}USDT$/.test(symbol)||!ALLOWED_DAYS.has(days)||!Number.isFinite(now))throw Error('Invalid Bybit history request');
 const lastOpen=Math.floor((now-PERIOD)/PERIOD)*PERIOD;
 const total=days*DAY_LENGTH/PERIOD;
 const firstOpen=lastOpen-(total-1)*PERIOD;
 const tasks=[];
 for(let begin=0;begin<total;begin+=PAGE_SIZE){
  const count=Math.min(PAGE_SIZE,total-begin);
  tasks.push({start:firstOpen+begin*PERIOD,end:firstOpen+(begin+count-1)*PERIOD,count});
 }
 const results=Array(tasks.length),parallel=Math.min(Math.max(1,Math.floor(concurrency)),6);
 let cursor=0;
 const work=async()=>{
  while(cursor<tasks.length){
   const index=cursor++,task=tasks[index];
   const qs=new URLSearchParams({category:'linear',symbol,interval:'5',start:String(task.start),end:String(task.end),limit:'1000'});
   let res,data;
   try{
    res=await fetcher(BASE+'/v5/market/kline?'+qs,{redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(9500)});
    if(!res.ok)throw Error('HTTP '+res.status);
    data=await res.json();
   }catch(e){throw Error('Historical Bybit candle page '+(index+1)+' unavailable: '+String(e.message||'network failure').slice(0,100))}
   if(data.retCode!==0||!Array.isArray(data.result?.list)||data.result.symbol!==symbol)throw Error('Historical Bybit candle page '+(index+1)+' rejected or malformed');
   const rows=data.result.list.map(c=>Array.isArray(c)?c.slice(0,6).map(Number):[]).sort((a,b)=>a[0]-b[0]);
   if(rows.length!==task.count)throw Error('Historical candle coverage incomplete on page '+(index+1)+'; got '+rows.length+' of '+task.count);
   for(let j=0;j<rows.length;j++){
    const v=rows[j],ts=task.start+j*PERIOD;
    if(v.length!==6||v.some(x=>!Number.isFinite(x))||v[0]!==ts||v[1]<=0||v[2]<Math.max(v[1],v[4])||v[3]>Math.min(v[1],v[4])||v[3]<=0||v[5]<0||v[0]+PERIOD>now)throw Error('Historical Bybit candle is missing, malformed or unfinished on page '+(index+1));
   }
   results[index]=rows;
  }
 };
 await Promise.all(Array.from({length:Math.min(parallel,tasks.length)},work));
 const bars=results.flat();
 if(bars.length!==total||bars[0][0]!==firstOpen||bars.at(-1)[0]!==lastOpen)throw Error('Historical collection incomplete');
 return {bars,days,count:bars.length,from:firstOpen,through:lastOpen,complete:true,source:'BYBIT V5 COMPLETED 5M CANDLES',pages:tasks.length};
}
module.exports={readHistory,PERIOD,PAGE_SIZE,ALLOWED_DAYS};
