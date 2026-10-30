'use strict';
// Fixed, inspectable rules. Agreement is not a calibrated probability of profit.
const Q=require('./quant-engine');
const FIVE=300000,QUARTER=900000,HOUR=3600000,FOUR_HOUR=14400000;
const MIN_HOLDOUT_TRADES=20,STRESS_ROUND_TRIP_RATE=.0026;
const number=x=>x===null||x===undefined||x===''||typeof x==='boolean'?NaN:Number(x);
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const average=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:NaN;
const normalized=s=>typeof s==='string'&&/^[A-Z0-9]{2,24}(?:USDT)?$/.test(s)?(s.endsWith('USDT')?s:s+'USDT'):null;
function candles(rows,duration,min,now){
 if(!Array.isArray(rows))return {ok:false,rows:[],reason:'Missing candle series'};
 let previous=-Infinity;
 for(const r of rows){
  if(!Array.isArray(r)||r.length<6||!r.slice(0,6).every(Number.isFinite)||!Number.isInteger(r[0])||r[0]%duration!==0||r[0]>now+1000||r.slice(1,5).some(v=>v<=0)||r[5]<0||r[2]<Math.max(r[1],r[4])||r[3]>Math.min(r[1],r[4])||r[0]<=previous||(previous!==-Infinity&&r[0]-previous!==duration))return {ok:false,rows:[],reason:'Invalid, unordered, gapped or future candle series'};
  previous=r[0];
 }
 const closed=rows.filter(r=>r[0]+duration<=now);
 const age=closed.length?now-(closed.at(-1)[0]+duration):Infinity;
 return {ok:closed.length>=min&&age>=0&&age<=duration+60000,rows:closed,ageMs:age,count:closed.length,reason:closed.length<min?'Insufficient completed candle history':age>duration+60000?'Stale candle history':null};
}
function resampleComplete(rows,duration){
 const groups=new Map(),count=duration/FIVE;
 for(const r of rows){const t=Math.floor(r[0]/duration)*duration;if(!groups.has(t))groups.set(t,[]);groups.get(t).push(r)}
 return [...groups.entries()].filter(([t,rs])=>rs.length===count&&rs[0][0]===t&&rs.at(-1)[0]===t+duration-FIVE).map(([t,rs])=>[t,rs[0][1],Math.max(...rs.map(r=>r[2])),Math.min(...rs.map(r=>r[3])),rs.at(-1)[4],rs.reduce((sum,r)=>sum+r[5],0)]);
}
function correlation(five,benchmark){
 const other=new Map(benchmark.map((r,i)=>[r[0],i?Math.log(r[4]/benchmark[i-1][4]):null]));
 const a=[],b=[];
 for(let i=Math.max(1,five.length-60);i<five.length;i++){const y=other.get(five[i][0]);if(Number.isFinite(y)){a.push(Math.log(five[i][4]/five[i-1][4]));b.push(y)}}
 if(a.length<30)return null;
 const ma=average(a),mb=average(b);let cov=0,va=0,vb=0;
 for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;cov+=x*y;va+=x*x;vb+=y*y}
 return va>1e-20&&vb>1e-20?clamp(cov/Math.sqrt(va*vb),-1,1):null;
}
function priceRules(series,side){
 const {five,quarter,hour,fourHour}=series;
 const f=Q.features(five.slice(-180)),q=Q.features(quarter.slice(-100)),h=Q.features(hour.slice(-100)),four=Q.features(fourHour.slice(-80));
 const direction=side==='BUY'?1:-1,closes=five.map(r=>r[4]);
 const recent=five.slice(-3),reference=five.slice(-23,-3),volumeMean=average(reference.map(r=>r[5])),volumeRatio=volumeMean>0?average(recent.map(r=>r[5]))/volumeMean:0;
 const vw=five.slice(-30),totalVolume=vw.reduce((a,r)=>a+r[5],0),vwap=totalVolume>0?vw.reduce((a,r)=>a+((r[2]+r[3]+r[4])/3)*r[5],0)/totalVolume:NaN;
 const move15m=(closes.at(-1)/closes.at(-4)-1)*100;
 const checks=[
  {label:'5m trend and momentum agree',pass:direction*(f.ema9-f.ema21)>0&&direction*move15m>.025&&direction*f.macdHist>=0},
  {label:'15m, 1h and 4h trends confirm',pass:[q,h,four].every(x=>direction*(x.ema9-x.ema21)>0)},
  {label:'Market has a tradable trend regime',pass:Number.isFinite(f.adx)&&f.adx>=18&&f.atrPct>=.08&&f.atrPct<=1.8},
  {label:'Momentum avoids an extreme',pass:side==='BUY'?f.rsi>=48&&f.rsi<=76:f.rsi>=24&&f.rsi<=52},
  {label:'Volume and VWAP confirm entry',pass:volumeRatio>=.8&&Number.isFinite(vwap)&&direction*(f.last-vwap)>=0},
  {label:'Entry is not chasing a price spike',pass:Math.abs(f.last-f.ema9)<=1.8*f.atr&&five.at(-1)[2]-five.at(-1)[3]<=3*f.atr}
 ];
 return {pass:checks.every(x=>x.pass),checks,price:f.last,atr:f.atr,stopPct:clamp(f.atrPct*1.8,.4,2),barTime:five.at(-1)[0],features:f,volumeRatio,vwap,move15m};
}
function inspectBook(book,side,notional,now){
 const bids=book?.b,asks=book?.a,ts=number(book?.ts);
 const validLevels=(levels,sign)=>Array.isArray(levels)&&levels.length>=5&&levels.every((l,i)=>Array.isArray(l)&&l.length>=2&&number(l[0])>0&&number(l[1])>0&&(!i||sign*(number(l[0])-number(levels[i-1][0]))>0));
 if(!Number.isFinite(ts)||now-ts>15000||ts>now+1000||!validLevels(bids,-1)||!validLevels(asks,1))return {ok:false,reason:'Missing, stale or malformed order book'};
 const bid=number(bids[0][0]),ask=number(asks[0][0]),mid=(bid+ask)/2;
 if(ask<=bid)return {ok:false,reason:'Locked or crossed order book'};
 const spreadBps=(ask-bid)/mid*10000,bidDepth=bids.reduce((s,l)=>s+number(l[0])*number(l[1]),0),askDepth=asks.reduce((s,l)=>s+number(l[0])*number(l[1]),0);
 const levels=side==='BUY'?asks:bids,quantity=notional/(side==='BUY'?ask:bid);let remaining=quantity,cost=0;
 for(const l of levels){const fill=Math.min(remaining,number(l[1]));cost+=fill*number(l[0]);remaining-=fill;if(remaining<=1e-12)break}
 const vwap=remaining<=1e-12?cost/quantity:null,impactBps=vwap?Math.abs(vwap/(side==='BUY'?ask:bid)-1)*10000:Infinity;
 const imbalance=(bidDepth-askDepth)/(bidDepth+askDepth);
 return {ok:remaining<=1e-12&&spreadBps<=8&&impactBps<=6&&Math.min(bidDepth,askDepth)>=notional*20,reason:'Spread, depth or estimated price impact does not fit the entry budget',bid,ask,mid,spreadBps,impactBps,imbalance,bidDepth,askDepth,vwap,ageMs:now-ts};
}
function inspectDerivatives(e,side,now){
 const dir=side==='BUY'?1:-1,rate=number(e.ticker?.fundingRate),next=number(e.ticker?.nextFundingTime),interval=number(e.instrument?.fundingInterval)*60000;
 const oi=Array.isArray(e.openInterest)?e.openInterest.slice().sort((a,b)=>number(a.timestamp)-number(b.timestamp)):[];
 const funding=Array.isArray(e.fundingHistory)?e.fundingHistory.slice().sort((a,b)=>number(a.fundingRateTimestamp)-number(b.fundingRateTimestamp)):[];
 const validOi=oi.length>=3&&oi.every((x,i)=>number(x.openInterest)>0&&Number.isFinite(number(x.timestamp))&&number(x.timestamp)<=now+1000&&(!i||number(x.timestamp)-number(oi[i-1].timestamp)===FIVE))&&now-number(oi.at(-1).timestamp)<=10*60000&&number(oi.at(-1).timestamp)-number(oi.at(-3).timestamp)<=20*60000;
 const validFunding=Number.isFinite(interval)&&interval>0&&Number.isFinite(rate)&&Number.isFinite(next)&&next>now&&next-now<=interval*1.5&&funding.length>=3&&funding.every((x,i)=>Number.isFinite(number(x.fundingRate))&&Number.isFinite(number(x.fundingRateTimestamp))&&number(x.fundingRateTimestamp)<=now+1000&&(!i||number(x.fundingRateTimestamp)>number(funding[i-1].fundingRateTimestamp)))&&now-number(funding.at(-1).fundingRateTimestamp)<=interval+3600000;
 const oiChange=validOi?(number(oi.at(-1).openInterest)/number(oi.at(-3).openInterest)-1)*100:null;
 const fundingMean=validFunding?average(funding.slice(-3).map(x=>number(x.fundingRate))):null;
 const crowding=validFunding&&(dir*rate>.0006||dir*fundingMean>.00045);
 const imminent=validFunding&&next-now<15*60000&&dir*rate>.0001;
 return {validOi,validFunding,rate,next,fundingMean,oiChange,crowding,imminent,ok:validOi&&validFunding&&!crowding&&!imminent&&Math.abs(rate)<=.001&&oiChange>=-1.5&&oiChange<=10};
}
function holdout(e,{now=Date.now(),notional=10,side=null,costRate=STRESS_ROUND_TRIP_RATE,fundingIntervalMinutes=480}={}){
 const stressRate=Math.max(STRESS_ROUND_TRIP_RATE,Number.isFinite(costRate)?costRate:STRESS_ROUND_TRIP_RATE);
 const five=(e.five||[]).filter(r=>r[0]+FIVE<=now),start=Math.max(120,Math.floor(five.length*.6)),end=five.length;
 const fundingPeriod=Number.isFinite(fundingIntervalMinutes)&&fundingIntervalMinutes>0?fundingIntervalMinutes*60000:8*HOUR;
 const extraFunding=(enteredAt,endedAt)=>notional*.0002*Math.max(0,Math.ceil((endedAt-enteredAt)/fundingPeriod)-1);
 const returns=[],outcomes=[];let skipped=0,ambiguous=0;const unresolved=[];
 if(five.length>=600){
  for(let i=start;i<end-1;i++){
   const cutoff=five[i][0]+FIVE,known={five:five.slice(Math.max(0,i-180),i+1),quarter:e.quarter.filter(r=>r[0]+QUARTER<=cutoff),hour:e.hour.filter(r=>r[0]+HOUR<=cutoff),fourHour:e.fourHour.filter(r=>r[0]+FOUR_HOUR<=cutoff)};
   if(known.quarter.length<80||known.hour.length<60||known.fourHour.length<40){skipped++;continue}
   const f=Q.features(known.five),direction=side||(f.ema9>f.ema21?'BUY':'SELL'),signal=priceRules(known,direction);
   if(!signal.pass){skipped++;continue}
   const dir=direction==='BUY'?1:-1,entry=five[i+1][1],stopDistance=entry*signal.stopPct/100,stop=entry-dir*stopDistance;
   const cost=notional*stressRate,targetNet=(notional*signal.stopPct/100+cost)*1.5,target=entry*(1+dir*(targetNet+cost)/notional);
   let exit=null,exitIndex=null,reason=null;
   for(let j=i+1;j<end;j++){
    const r=five[j],hitStop=dir===1?r[3]<=stop:r[2]>=stop,hitTarget=dir===1?r[2]>=target:r[3]<=target;
    if(hitStop){if(hitTarget)ambiguous++;exit=dir===1?Math.min(r[1],stop):Math.max(r[1],stop);exitIndex=j;reason='Stop first';break}
    if(hitTarget){exit=target;exitIndex=j;reason='Profit target';break}
   }
   if(exitIndex===null){const mark=five.at(-1)[4],markedNet=dir*(mark-entry)*(notional/entry)-cost-extraFunding(five[i+1][0],five.at(-1)[0]+FIVE);unresolved.push({signalAt:cutoff,enteredAt:five[i+1][0],side:direction,entry,lastPrice:mark,markedNet});break}
   const net=dir*(exit-entry)*(notional/entry)-cost-extraFunding(five[i+1][0],five[exitIndex][0]+FIVE);
   returns.push(net);outcomes.push({signalAt:cutoff,enteredAt:five[i+1][0],closedAt:five[exitIndex][0]+FIVE,side:direction,net,reason});i=exitIndex;
  }
 }
 const count=returns.length,wins=returns.filter(x=>x>0).length,profit=returns.filter(x=>x>0).reduce((a,b)=>a+b,0),loss=-returns.filter(x=>x<0).reduce((a,b)=>a+b,0),net=returns.reduce((a,b)=>a+b,0);
 const expectancy=count?net/count:null,profitFactor=loss>0?profit/loss:null;
 const enough=count>=MIN_HOLDOUT_TRADES,positive=enough&&expectancy>0&&(loss===0?profit>0:profitFactor>=1.1);
 return {kind:'PRICE_ONLY_HISTORICAL_SANITY_CHECK',label:'Price-only historical sanity check',side:side||'BOTH',passed:positive&&unresolved.length===0,tradeCount:count,unresolvedTrades:unresolved.length,unresolvedMarkedNet:unresolved.reduce((sum,p)=>sum+p.markedNet,0),minimumTrades:MIN_HOLDOUT_TRADES,wins,losses:count-wins,winRatePct:count?wins/count*100:null,netPnl:net,expectancy,profitFactor,allWins:count>0&&loss===0,sampleStart:five[start]?.[0]??null,sampleEnd:five.at(-1)?.[0]??null,splitPct:60,skipped,ambiguousBars:ambiguous,feeModel:'Stress scenario: at least 26 bps round trip (6 bps fee + 5 bps slippage per side, 2 bps spread and 2 bps funding); raised to the current modeled cost floor when higher; another 2 bps per additional funding interval held',roundTripCostBps:stressRate*10000,entry:'Next candle open',maximumHoldMinutes:null,nonOverlapping:true,recent:outcomes.slice(-6),reason:unresolved.length?'Open historical position remains unresolved at sample end':!enough?'Insufficient closed holdout trades':positive?'Positive net expectancy under fixed cost assumptions':'No positive cost-adjusted price-only holdout evidence',limitations:'No timed exits: positions unresolved at sample end are marked separately and block eligibility, never recorded as wins or sample-end closes. Limited recent history and fixed rules, not a prediction or full-strategy validation. Historical order-book, open-interest and actual funding/latency data are unavailable and are never fabricated. No parameter optimization or guaranteed win rate.'};
}
function decide(evidence={},options={}){
 const now=Number.isFinite(options.now)?options.now:Date.now(),demo=options.mode==='demo',notional=demo?100:10,checks=[],add=(label,pass,detail)=>checks.push({label,pass:!!pass,...(detail?{detail}:{} )});
 add('Valid execution policy',options.mode===undefined||['demo','live'].includes(options.mode));
 const e=evidence||{},symbol=normalized(e.symbol),observedAt=number(e.observedAt);
 add('Fixed $'+notional+' trade budget',options.notional===undefined||options.notional===notional);
 add('Snapshot is fresh',Number.isFinite(observedAt)&&observedAt<=now+1000&&now-observedAt<=10000);
 add('Required data feeds responded',Array.isArray(e.errors)&&e.errors.length===0,Array.isArray(e.errors)?e.errors.map(x=>typeof x==='string'?x:String(x.source)+': '+String(x.code)).join(' · '):'Missing feed status');
 const requiredSources=['five','quarter','hour','fourHour','benchmarkFive','book','ticker','openInterest','fundingHistory','instrument'];
 add('Every source response is current',requiredSources.every(key=>Number.isFinite(number(e.sourceTimes?.[key]))&&number(e.sourceTimes[key])<=now+1000&&now-number(e.sourceTimes[key])<=15000));
 const series={},specs=[['five',FIVE,120,'5m'],['quarter',QUARTER,80,'15m'],['hour',HOUR,60,'1h'],['fourHour',FOUR_HOUR,40,'4h'],['benchmarkFive',FIVE,120,'BTC 5m']],coverage={observedAt:Number.isFinite(observedAt)?observedAt:null,sources:[],timeframes:{}};
 for(const [key,duration,min,label]of specs){const data=candles(e[key],duration,min,now);series[key]=data.rows;coverage.timeframes[key]={ready:data.ok,count:data.rows.length,ageMs:Number.isFinite(data.ageMs)?data.ageMs:null};add('Complete, fresh '+label+' history',data.ok,data.reason);coverage.sources.push({name:label,ready:data.ok})}
 const ticker=e.ticker||{},instrument=e.instrument||{};
 const instrumentOk=symbol&&ticker.symbol===symbol&&instrument.symbol===symbol&&instrument.status==='Trading'&&instrument.quoteCoin==='USDT'&&instrument.contractType==='LinearPerpetual';
 add('Active USDT perpetual market',instrumentOk);
 const last=series.five.at(-1),price=last?.[4]??null;
 let chosen=['BUY','SELL'].includes(options.side)?options.side:null;
 if(!chosen&&series.five.length>=35){const f=Q.features(series.five.slice(-180));chosen=f.ema9>f.ema21?'BUY':'SELL'}
 if(options.side!==undefined&&!['BUY','SELL'].includes(options.side))add('Valid trade direction',false);
 const complete=specs.every(([key])=>coverage.timeframes[key].ready);
 let plan=null;
 if(complete&&chosen){plan=priceRules(series,chosen);for(const c of plan.checks)checks.push(c)}
 const book=inspectBook(e.book,chosen||'BUY',notional,now),derivatives=inspectDerivatives(e,chosen||'BUY',now);
 coverage.sources.push({name:'Order book',ready:book.ok},{name:'Open interest',ready:derivatives.validOi},{name:'Funding',ready:derivatives.validFunding},{name:'Instrument limits',ready:!!instrumentOk});
 add('Fresh executable depth and narrow spread',book.ok,book.ok?undefined:book.reason);
 const tickerBid=number(ticker.bid1Price),tickerAsk=number(ticker.ask1Price),turnover=number(ticker.turnover24h);
 add('Liquid, coherent ticker and book',Number.isFinite(turnover)&&turnover>=10000000&&tickerAsk>=tickerBid&&tickerBid>0&&book.ok&&Math.abs(tickerBid/book.bid-1)<.0003&&Math.abs(tickerAsk/book.ask-1)<.0003&&price>0&&Math.abs(book.mid/price-1)<=.005);
 add('Current open-interest history',derivatives.validOi);
 add('Current funding history and schedule',derivatives.validFunding);
 add('Derivatives are not crowded or unwinding',derivatives.ok);
 const dir=chosen==='BUY'?1:-1;
 add('Order-book pressure does not strongly oppose',book.ok&&dir*book.imbalance>=-.55);
 const benchmark=series.benchmarkFive,lastBtc=benchmark.at(-1)?.[4],btcMove15m=benchmark.length>=4?(lastBtc/benchmark.at(-4)[4]-1)*100:null,btcMove5m=benchmark.length>=2?(lastBtc/benchmark.at(-2)[4]-1)*100:null;
 add('No broad-market shock or opposing BTC move',Number.isFinite(btcMove15m)&&Math.abs(btcMove15m)<=1.8&&Math.abs(btcMove5m)<=1&&dir*btcMove15m>=-.6);
 const estimatedRoundTripCostUsd=book.ok?notional*(.0012+.0008+(book.spreadBps+2*book.impactBps)/10000+Math.max(0,dir*derivatives.rate)):null;
 const stopPct=plan?.stopPct??null,targetNet=plan&&Number.isFinite(estimatedRoundTripCostUsd)?(notional*stopPct/100+estimatedRoundTripCostUsd)*1.5:null;
 add('Costs fit modeled movement and stop risk',plan&&Number.isFinite(estimatedRoundTripCostUsd)&&estimatedRoundTripCostUsd<=notional*stopPct/100*.75&&(targetNet+estimatedRoundTripCostUsd)/notional*100<=plan.atr/plan.price*100*6);
 const quote=chosen==='BUY'?book.ask:book.bid,step=number(instrument.lotSizeFilter?.qtyStep),minQty=number(instrument.lotSizeFilter?.minOrderQty),minNotional=number(instrument.lotSizeFilter?.minNotionalValue),maxQty=number(instrument.lotSizeFilter?.maxMktOrderQty),qty=step>0&&quote>0?Math.floor((notional/quote)/step+1e-10)*step:NaN;
 add('Exchange minimum fits $'+notional+' budget',Number.isFinite(qty)&&qty>0&&qty>=minQty&&qty<=maxQty&&qty*quote>=minNotional&&qty*quote<=notional+1e-8&&number(instrument.priceFilter?.tickSize)>0);
 let validation={kind:'PRICE_ONLY_HISTORICAL_SANITY_CHECK',label:'Price-only historical sanity check',passed:false,tradeCount:0,minimumTrades:MIN_HOLDOUT_TRADES,reason:'Required completed history is unavailable',limitations:'No full-strategy validation or future win-rate guarantee.'};
 if(complete)validation=holdout(series,{now,notional,side:chosen,fundingIntervalMinutes:number(instrument.fundingInterval),costRate:Number.isFinite(estimatedRoundTripCostUsd)?estimatedRoundTripCostUsd/notional:STRESS_ROUND_TRIP_RATE});
 validation={...validation,entryGate:demo?'ADVISORY_DEMO':'REQUIRED_LIVE',limitations:demo?'Demo forward test: historical results are advisory and do not establish a validated edge. '+validation.limitations.replace('and block eligibility,','without a forced close,'):validation.limitations};
 checks.push({label:'Price-only holdout has enough trades and positive net evidence',pass:validation.passed,required:!demo,detail:validation.reason+(demo?' · Historical context only for demo forward testing':'')});
 const blockers=checks.filter(x=>!x.pass&&x.required!==false).map(x=>x.label+(x.detail?': '+x.detail:'')),eligible=blockers.length===0;
 const warnings=checks.filter(x=>!x.pass&&x.required===false).map(x=>x.detail);
 const metrics={adx:plan?.features.adx??null,rsi:plan?.features.rsi??null,atrPct:plan?plan.atr/plan.price*100:null,volumeRatio:plan?.volumeRatio??null,vwap:plan?.vwap??null,spreadBps:Number.isFinite(book.spreadBps)?book.spreadBps:null,impactBps:Number.isFinite(book.impactBps)?book.impactBps:null,bookImbalance:Number.isFinite(book.imbalance)?book.imbalance:null,openInterestChangePct:derivatives.oiChange,fundingRate:Number.isFinite(derivatives.rate)?derivatives.rate:null,benchmarkMove15mPct:btcMove15m,benchmarkCorrelation:correlation(series.five,benchmark),estimatedRoundTripCostUsd:Number.isFinite(estimatedRoundTripCostUsd)?estimatedRoundTripCostUsd:null};
 return {symbol,eligible,executionPolicy:demo?'DEMO_FORWARD_TEST':'LIVE_STRICT',decision:eligible?chosen:'WAIT',side:chosen,reason:eligible?(demo?'Current market and execution checks agree; demo forward test with advisory historical context':'Required market evidence and cost-adjusted price-only holdout gates agree'):blockers[0]||'No decision',checks,blockers,warnings,executionPrice:book.ok?book.vwap:null,maximumHoldMinutes:null,rank:checks.filter(x=>x.pass).length+(plan?clamp(plan.features.adx/25,0,2)+clamp(plan.volumeRatio,0,2):0),price,barTime:last?.[0]??null,atr:plan?.atr??null,stopPct,targetNet,slippageBps:book.ok?4+book.spreadBps/2+book.impactBps:null,notional,observedAt:coverage.observedAt,decidedAt:now,expiresAt:Number.isFinite(observedAt)?observedAt+10000:now,coverage,metrics,validation,scoreMeaning:'Rule agreement and ranking, not a win probability',limitations:'Public exchange data cannot include all market information. News, off-exchange liquidity, manipulation and future fills are not known. Losses remain possible.'};
}
module.exports={decide,holdout,candles,resampleComplete,correlation,priceRules,MIN_HOLDOUT_TRADES};
