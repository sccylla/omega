'use strict';
// OMEGA Quant v3 — interpretable multi-timeframe decision engine.
// Scores are signal agreement, NOT calibrated win probabilities.
const FIVE=300000, FIFTEEN=900000, HOUR=3600000;
const ESTIMATED_TAKER_RATE=0.0006, ESTIMATED_SLIPPAGE_RATE=0.0004;
const MAX_EQUITY_EXPOSURE=0.20;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const finite=x=>Number.isFinite(Number(x));
const round=(x,n=2)=>Number(Number(x).toFixed(n));
const average=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
function validateCandles(rows,n=90){
 if(!Array.isArray(rows)||rows.length<n)throw Error('Insufficient candle history');
 let prev=-Infinity;
 for(const row of rows){if(!Array.isArray(row)||row.length<6||row.slice(0,6).some(x=>!finite(x))||row[0]<=prev||row[1]<=0||row[4]<=0||row[3]<=0||row[2]<row[3]||row[2]<Math.max(row[1],row[4])||row[3]>Math.min(row[1],row[4])||row[5]<0)throw Error('Malformed or unordered market candles');prev=row[0];}
 return rows;
}
function ema(values,period){if(values.length<period)return null;const alpha=2/(period+1);let m=average(values.slice(0,period));for(let i=period;i<values.length;i++)m=values[i]*alpha+m*(1-alpha);return m;}
function rsi(values,n=14){if(values.length<=n)return null;let gain=0,loss=0;for(let i=1;i<=n;i++){let d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}gain/=n;loss/=n;for(let i=n+1;i<values.length;i++){let d=values[i]-values[i-1];gain=(gain*(n-1)+Math.max(0,d))/n;loss=(loss*(n-1)+Math.max(0,-d))/n;}return gain+loss===0?50:loss===0?100:100-100/(1+gain/loss);}
function atr(rows,n=14){if(rows.length<=n)return null;let a=0;const tr=i=>Math.max(rows[i][2]-rows[i][3],Math.abs(rows[i][2]-rows[i-1][4]),Math.abs(rows[i][3]-rows[i-1][4]));for(let i=1;i<=n;i++)a+=tr(i);a/=n;for(let i=n+1;i<rows.length;i++)a=(a*(n-1)+tr(i))/n;return a;}
function adx(rows,n=14){if(rows.length<2*n+1)return null;let tr=0,pdm=0,mdm=0,sum=0,count=0,smoothed=null;for(let i=1;i<rows.length;i++){const up=rows[i][2]-rows[i-1][2],down=rows[i-1][3]-rows[i][3],t=Math.max(rows[i][2]-rows[i][3],Math.abs(rows[i][2]-rows[i-1][4]),Math.abs(rows[i][3]-rows[i-1][4]));const p=up>down&&up>0?up:0,m=down>up&&down>0?down:0;if(i<=n){tr+=t;pdm+=p;mdm+=m;}else{tr=tr-tr/n+t;pdm=pdm-pdm/n+p;mdm=mdm-mdm/n+m;}if(i>=n){const plus=tr?100*pdm/tr:0,minus=tr?100*mdm/tr:0;const dx=plus+minus?100*Math.abs(plus-minus)/(plus+minus):0;if(count<n){sum+=dx;count++;if(count===n)smoothed=sum/n;}else{smoothed=(smoothed*(n-1)+dx)/n;}}}return smoothed;}
function macdHistogram(values){if(values.length<40)return null;const fast=[],slow=[];let a=average(values.slice(0,12)),b=average(values.slice(0,26));const hist=[];for(let i=0;i<values.length;i++){if(i>=12)a=values[i]*2/13+a*11/13; if(i>=26)b=values[i]*2/27+b*25/27;if(i>=25)hist.push(a-b);}if(hist.length<9)return null;const signal=ema(hist,9);return hist.at(-1)-signal;}
function resampleClosed(rows,duration,sourceDuration=FIVE){const output=[];let b=null;for(const row of rows){const start=Math.floor(row[0]/duration)*duration;if(b&&b[0]!==start){if(b[0]+duration<=row[0])output.push(b);b=null;}if(!b)b=[start,row[1],row[2],row[3],row[4],row[5]];else{b[2]=Math.max(b[2],row[2]);b[3]=Math.min(b[3],row[3]);b[4]=row[4];b[5]+=row[5];}}
 if(b&&b[0]+duration<=rows.at(-1)[0]+sourceDuration)output.push(b);return output;}
function features(rows){validateCandles(rows,35);const close=rows.map(x=>x[4]);const last=close.at(-1),a=atr(rows),r=rsi(close),e9=ema(close,9),e21=ema(close,21),e55=ema(close,55),d=adx(rows),mh=macdHistogram(close);const volume=rows.slice(-21,-1).map(x=>x[5]),vmean=average(volume),sd=Math.sqrt(average(volume.map(x=>(x-vmean)**2))),z=sd?(rows.at(-1)[5]-vmean)/sd:0;
 const ret3=close.length>=4?(last/close.at(-4)-1)*100:0;
 return {last,atr:a,atrPct:a/last*100,rsi:r,ema9:e9,ema21:e21,ema55:e55,adx:d,macdHist:mh,volumeZ:z,return3:ret3,trend:e9>e21?'UP':e9<e21?'DOWN':'FLAT'};
}
function microstructure(book){if(!book||!Array.isArray(book.b)||!Array.isArray(book.a)||!book.b.length||!book.a.length)return null;
 const bid=Number(book.b[0][0]),ask=Number(book.a[0][0]);if(!(bid>0&&ask>=bid))return null;
 const bids=book.b.slice(0,12).reduce((s,l)=>s+Number(l[1])*Number(l[0]),0),asks=book.a.slice(0,12).reduce((s,l)=>s+Number(l[1])*Number(l[0]),0);
 if(!(bids+asks>0))return null;
 return {spreadBps:(ask-bid)/((bid+ask)/2)*10000,imbalance:(bids-asks)/(bids+asks),bid,ask};
}
function targetMath(equity=10000,netTarget=1,mark=1,spreadBps=0){const maxNotional=equity*MAX_EQUITY_EXPOSURE;
 const fees=maxNotional*ESTIMATED_TAKER_RATE*2;
 const slippage=maxNotional*ESTIMATED_SLIPPAGE_RATE*2;
 const spread=maxNotional*Math.max(0,spreadBps)/10000;
 const costs=fees+slippage+spread;
 const requiredPct=(netTarget+costs)/maxNotional*100;
 return {netTarget:round(netTarget),equity:round(equity),maxNotional:round(maxNotional),estimatedRoundTripFees:round(fees,3),estimatedSlippage:round(slippage,3),estimatedSpreadCost:round(spread,3),totalEstimatedCosts:round(costs,3),requiredMovePct:round(requiredPct,3),grossProfitNeeded:round(netTarget+costs,3),note:'Illustrative estimate using 0.06% taker fee and 0.04% slippage per side, plus observed spread. Actual fees/fills may differ.'};
}
function analyze({five,quarter,hour,book=null,fundingRate=null,openInterestChangePct=null,equity=10000,target=1,nowMs=Date.now()}={}){
 validateCandles(five,90);validateCandles(quarter,30);validateCandles(hour,30);
 const f=features(five),q=features(quarter),h=features(hour),micro=microstructure(book);
 const freshness=nowMs-(five.at(-1)[0]+FIVE);
 const blockers=[],evidence=[];const signed=(cond,magnitude,name)=>{if(cond===0)return 0;evidence.push({label:name,impact:round(cond*magnitude,1)});return cond*magnitude;};
 let bias=0;
 const diff=f.ema9-f.ema21;
 bias+=signed(Math.sign(diff),11,'5m EMA trend');
 bias+=signed(Math.sign(f.macdHist||0),9,'MACD momentum');
 bias+=signed(f.rsi>=54?1:f.rsi<=46?-1:0,7,'RSI momentum');
 bias+=signed(f.return3>0.05?1:f.return3<-.05?-1:0,6,'Recent price velocity');
 bias+=signed(q.ema9>q.ema21?1:-1,11,'15m market structure');
 bias+=signed(h.ema9>h.ema21?1:-1,11,'1h dominant trend');
 if(micro){bias+=signed(micro.imbalance>.08?1:micro.imbalance<-.08?-1:0,4,'Order book pressure');}
 if(openInterestChangePct!==null&&finite(openInterestChangePct))bias+=signed(Number(openInterestChangePct)>.25?Math.sign(f.return3):Number(openInterestChangePct)<-.25?-Math.sign(f.return3):0,2,'Open interest shift');
 if(fundingRate!==null&&finite(fundingRate)){const rate=Number(fundingRate);if(rate>.001)bias-=2;if(rate<-.001)bias+=2;}
 const score=round(clamp(50+bias,0,100),0);
 const direction=score>=69?'LONG':score<=31?'SHORT':'WAIT';
 const agree=direction==='LONG'&&q.ema9>q.ema21&&h.ema9>h.ema21||direction==='SHORT'&&q.ema9<q.ema21&&h.ema9<h.ema21;
 if(direction==='WAIT')blockers.push('No strong agreement across independent indicators');
 if(direction!=='WAIT'&&!agree)blockers.push('Higher timeframes are not aligned');
 if(f.adx!==null&&f.adx<17)blockers.push('Low trend strength (ADX below 17)');
 if(f.atrPct<.055)blockers.push('Price movement too small for estimated transaction costs');
 if(f.atrPct>1.7)blockers.push('Extreme short-term volatility');
 if(f.rsi>79||f.rsi<21)blockers.push('RSI at an extreme: elevated reversal risk');
 if(f.volumeZ<-1.5)blockers.push('Weak current trading volume');
 if(freshness>FIVE*2 || freshness<-(FIVE+60000))blockers.push('Market data is stale or future-dated');
 if(!micro)blockers.push('Order-book quote unavailable');
 else if(micro.spreadBps>8)blockers.push('Bid-ask spread too wide');
 const targetEstimate=targetMath(equity,target,f.last,micro?.spreadBps||0);
 const historicalTwoBarRangePct=f.atrPct*Math.sqrt(2);
 // A crude volatility scale, not a forecast of probability or market direction.
 if(targetEstimate.requiredMovePct>historicalTwoBarRangePct*1.5)blockers.push('$'+target+' net target would require unusually large 10m move under the position cap');
 const decision=blockers.length?'WAIT':direction;
 const signal=decision==='LONG'?'BUY':decision==='SHORT'?'SELL':'WAIT';
 const readiness=blockers.length?'BLOCKED':'WATCHLIST CANDIDATE';
 const strongest=evidence.slice().sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact)).slice(0,4);
 return {decision,signal,readiness,alignmentScore:score,scoreMeaning:'Signal alignment index — NOT a win-rate or probability',regime:f.adx>=25?'TRENDING':f.adx>=17?'TRANSITION':'RANGE / LOW TREND',blockers,evidence:strongest,
 indicators:{rsi:round(f.rsi),adx:round(f.adx||0),atrPct:round(f.atrPct,3),macdHistogram:round(f.macdHist||0,5),ema9:round(f.ema9,3),ema21:round(f.ema21,3),volumeZ:round(f.volumeZ,2),return3:round(f.return3,3),quarterTrend:q.trend,hourTrend:h.trend,imbalance:micro?round(micro.imbalance*100,1):null,spreadBps:micro?round(micro.spreadBps,2):null,fundingRatePct:fundingRate===null?null:round(fundingRate*100,4),openInterestChangePct:openInterestChangePct===null?null:round(openInterestChangePct,3)},
 target: {...targetEstimate,observedTwoBarAtrPct:round(historicalTwoBarRangePct,3),feasibility:targetEstimate.requiredMovePct>historicalTwoBarRangePct*1.5?'LOW UNDER THIS VOLATILITY':'NOT RULED OUT BY ATR'},
 close:f.last,barTime:five.at(-1)[0],freshnessMs:freshness,atr:f.atr,reason:blockers[0]||'High multi-timeframe agreement; trade setup is only a candidate, not an assured profit'};
}
function historicalTest(rows,{equity=10000,target=1,limitTrades=200,nowMs=Date.now()}={}){
 validateCandles(rows,470);
 // Only bars received before the entry are used to form the signal.
 // No book data is available for historic snapshots; historical mode removes live microstructure gate.
 const history=rows.slice(0,-1);
 const first=Math.max(430,Math.floor(history.length*.45));let balance=equity,peak=equity,maxDD=0,wins=0,total=0,skips=0,hitTarget=0,losses=0;const outcomes=[];let signals=0;
 for(let i=first;i<history.length-3&&total<limitTrades;i++){
  const known=history.slice(0,i+1),q=resampleClosed(known,FIFTEEN),h=resampleClosed(known,HOUR);
  if(q.length<30||h.length<30)continue;
  let a;
  // Neutral historical snapshot book to avoid falsely injecting today's book into the past.
  const closed=known.at(-1);
  const synthetic={b:[[closed[4]*.99995,'100']],a:[[closed[4]*1.00005,'100']]};
  try{a=analyze({five:known,quarter:q,hour:h,book:synthetic,equity:balance,target,nowMs:closed[0]+FIVE});}catch{continue;}
  if(a.signal==='WAIT'){skips++;continue;}signals++;
  const enter=history[i+1][1],dir=a.signal==='BUY'?1:-1;
  const notional=balance*MAX_EQUITY_EXPOSURE,qty=notional/enter;
  const stopDistance=Math.max(enter*.004, a.atr*1.6);
  const stop=enter-dir*stopDistance;
  // Two completed 5m bars = a 10-minute holding window; conservative stop-first when both extrema crossed.
  let exit=history[i+2][4],reason='10m time exit';
  for(let step=1;step<=2;step++){const candle=history[i+step];if(dir>0&&candle[3]<=stop){exit=Math.min(candle[1],stop);reason='stop hit';break;}if(dir<0&&candle[2]>=stop){exit=Math.max(candle[1],stop);reason='stop hit';break;}}
  const pnl=dir*(exit-enter)*qty-(enter+exit)*qty*(ESTIMATED_TAKER_RATE+ESTIMATED_SLIPPAGE_RATE);
  balance+=pnl;total++;if(pnl>0)wins++;else losses++;if(pnl>=target)hitTarget++;
  outcomes.push({ts:history[i+2][0],pnl:round(pnl),reason});peak=Math.max(peak,balance);maxDD=Math.max(maxDD,(peak-balance)/peak*100);i+=2;
 }
 return {kind:'HISTORICAL_SIMULATION',initialEquity:round(equity),finalEquity:round(balance),netPnl:round(balance-equity),returnPct:round((balance/equity-1)*100),trades:total,wins,losses,winRatePct:total?round(wins/total*100,1):null,hitTarget,hitTargetPct:total?round(hitTarget/total*100,1):null,maxDrawdownPct:round(maxDD,2),avgNetPerTrade:total?round((balance-equity)/total,3):null,signals,skips,holdMinutes:10,entries:'next bar open',feeModel:'0.06% taker + 0.04% slippage EACH SIDE',sampleStart:history[first][0],sampleEnd:history.at(-1)[0],recent:outcomes.slice(-12).reverse(),caveat:'In-sample rule evaluation over limited public candle history, no orderbook history, spread variation, funding, latency or exchange liquidation. NOT walk-forward model validation, not a profit forecast.'};
}
module.exports={analyze,historicalTest,features,ema,rsi,atr,adx,resampleClosed,microstructure,targetMath,validateCandles,FIVE,FIFTEEN,HOUR};
