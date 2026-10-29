'use strict';
// Conservative transparent watchlist ranking, not a calibrated win probability.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const round=(n,d=1)=>Number(n.toFixed(d));
function futuresScreen(t){
 const symbol=String(t.symbol||'');const price=Number(t.lastPrice),volume=Number(t.turnover24h),change=Number(t.price24hPcnt)*100;
 const bid=Number(t.bid1Price),ask=Number(t.ask1Price),fund=Number(t.fundingRate||0)*100;
 if(!/^[A-Z0-9]{2,24}USDT$/.test(symbol)||!Number.isFinite(price)||price<=0||!Number.isFinite(volume)||volume<=0||!Number.isFinite(change)||!Number.isFinite(bid)||!Number.isFinite(ask)||bid<=0||ask<bid) return null;
 const spread=(ask-bid)/((bid+ask)/2)*10000;
 const liquidity=clamp((Math.log10(volume)-4)*14,0,100);
 const liquidEnough=volume>=2_000_000&&spread<=22;
 const fundingCaution=Math.abs(fund)>.12;
 const edge=clamp(Math.abs(change)/7,0,1);
 const trendScore=round(clamp(48+edge*33+(liquidity-50)*.16-spread*.7-(fundingCaution?14:0),0,96));
 const inverseScore=round(clamp(42-edge*23+(liquidity-50)*.09-spread*.4,0,90));
 let buyScore=change>0?trendScore:inverseScore,sellScore=change<0?trendScore:inverseScore;
 if(Math.abs(change)<.6){buyScore=round(Math.min(buyScore,49));sellScore=round(Math.min(sellScore,49));}
 const better=buyScore>sellScore?'BUY':sellScore>buyScore?'SELL':'WAIT';
 const qualified=liquidEnough&&!fundingCaution&&Math.abs(change)>=.8;
 const status=!qualified?'WAIT':better==='BUY'&&buyScore>=65?'BUY WATCH':better==='SELL'&&sellScore>=65?'SELL WATCH':'WAIT';
 const reasons=[];
 if(volume<2_000_000)reasons.push('Low 24h turnover');if(spread>22)reasons.push('Wide bid/ask spread');if(fundingCaution)reasons.push('Funding elevated');if(Math.abs(change)<.8)reasons.push('Weak 24h direction');
 if(!reasons.length)reasons.push((change>=0?'Upward':'Downward')+' 24h momentum; verify on lower timeframes');
 return {symbol,market:'futures',price,change24hPct:round(change,2),turnover24h:round(volume,0),spreadBps:round(spread,2),fundingPct:round(fund,4),buyScore,sellScore,status,qualityScore:round(liquidity),reason:reasons.join(' · '),screenType:'24H_SNAPSHOT_ONLY'};
}
function ema(arr,n){let x=arr[0],k=2/(n+1);for(let i=1;i<arr.length;i++)x+=k*(arr[i]-x);return x;}
function forexScreen(pair,candles,now=Date.now()){
 if(!/^[A-Z]{3}_[A-Z]{3}$/.test(pair)||!Array.isArray(candles)||candles.length<55)throw Error('Insufficient Forex history');
 const last=candles.at(-1),previous=candles.at(-13),px=last[4],prices=candles.slice(-75).map(x=>x[4]);
 if(!(px>0))throw Error('Invalid Forex candle');
 const pct=(px/previous[4]-1)*100;const short=ema(prices.slice(-34),12),long=ema(prices,34);
 const recent=candles.slice(-16);const tr=recent.map((c,i)=>Math.max(c[2]-c[3],Math.abs(c[2]-(i?recent[i-1][4]:c[1])),Math.abs(c[3]-(i?recent[i-1][4]:c[1]))));const atr=tr.reduce((a,b)=>a+b,0)/tr.length/px*100;
 const dif=(short-long)/px*100,score=clamp(Math.abs(dif)/Math.max(atr,.01)*17,0,24)+clamp(Math.abs(pct)/Math.max(atr,.01)*7,0,19);
 const q=round(clamp(45+score,0,88)); const buy=round(dif>0&&pct>=0?q:Math.max(12,55-score)),sell=round(dif<0&&pct<=0?q:Math.max(12,55-score));
 const d=new Date(now),day=d.getUTCDay(),closed=day===6||(day===0&&d.getUTCHours()<21)||(day===5&&d.getUTCHours()>=21);
 const stale=now-(last[0]+300000)>20*60*1000;
 const status=closed?'MARKET CLOSED':stale?'STALE DATA':Math.max(buy,sell)<65?'WAIT':buy>sell?'BUY WATCH':'SELL WATCH';
 return {market:'forex',symbol:pair,price:px,change24hPct:round(pct,3),buyScore:buy,sellScore:sell,status,qualityScore:round(clamp(100-atr*30,0,100)),turnover24h:null,spreadBps:null,reason:closed?'Forex is closed for the weekend':stale?'Market data is stale':'Short/long trend + latest 1-hour price movement; requires deeper testing',lastCandle:last[0],screenType:'5M_CANDLE_SCREEN_ONLY'};
}
module.exports={futuresScreen,forexScreen};
