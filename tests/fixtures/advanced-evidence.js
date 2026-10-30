'use strict';
const NOW=Date.UTC(2026,9,29,20,0,12);
// Artificial, deliberately well-covered market. It is not a real performance sample.
function series(n,duration,trend=.0006,amplitude=.008,period=16,phase=1,now=NOW,padding=.0025){
 let previous;
 return Array.from({length:n},(_,i)=>{
  const timestamp=Math.floor(now/duration)*duration-(n-i)*duration,close=Math.exp(i*trend)*(1+amplitude*Math.sin((i-n+1+phase)*2*Math.PI/period)),open=previous||close;
  previous=close;return [timestamp,open,Math.max(open,close)+close*padding,Math.min(open,close)-close*padding,close,100000];
 });
}
function evidence(now=NOW){
 const five=series(1000,300000,.0008,.003,6,2,now,.0005),price=five.at(-1)[4],bid=price*.99995,ask=price*1.00005;
 return {symbol:'XRPUSDT',observedAt:now,sourceTimes:Object.fromEntries(['five','quarter','hour','fourHour','benchmarkFive','book','ticker','openInterest','fundingHistory','instrument'].map(k=>[k,now])),errors:[],five,
  quarter:series(300,900000,.001,.002,20,1,now),hour:series(200,3600000,.0015,.002,20,1,now),fourHour:series(100,14400000,.002,.002,20,1,now),benchmarkFive:series(200,300000,.0002,.0002,20,1,now),
  book:{ts:now,b:Array.from({length:10},(_,i)=>[String(bid*(1-i*.0001)),'10000']),a:Array.from({length:10},(_,i)=>[String(ask*(1+i*.0001)),'10000'])},
  ticker:{symbol:'XRPUSDT',bid1Price:String(bid),ask1Price:String(ask),lastPrice:String(price),turnover24h:'100000000',fundingRate:'.00001',nextFundingTime:String(now+4*3600000)},
  openInterest:Array.from({length:12},(_,i)=>({timestamp:String(now-(11-i)*300000),openInterest:String(100000+i*100)})),
  fundingHistory:Array.from({length:8},(_,i)=>({symbol:'XRPUSDT',fundingRate:'.00001',fundingRateTimestamp:String(now-(8-i)*8*3600000)})),
  instrument:{symbol:'XRPUSDT',status:'Trading',quoteCoin:'USDT',contractType:'LinearPerpetual',fundingInterval:'480',lotSizeFilter:{qtyStep:'.001',minOrderQty:'.001',maxMktOrderQty:'100000',minNotionalValue:'5'},priceFilter:{tickSize:'.00001'}}};
}
module.exports={NOW,series,evidence};
