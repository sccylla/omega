'use strict';
// Real-time Bybit public orderbook+trade flow, research only. No keys/orders.
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaSecondsEngine=api})(typeof window!=='undefined'?window:null,function(){
 const MIN_NOTIONAL=90,GOAL_NET=.50,MAKERLESS_TAKER=.00055,EXTRA_SLIP=.00020;
 const SYMBOL=/^[A-Z0-9]{2,20}USDT$/,MAX_SYMBOLS=5,MAX_AGE_MS=2300;
 const finite=Number.isFinite,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),round=(n,d=3)=>Number(n.toFixed(d));
 const validSymbols=(raw)=>{
  const a=Array.isArray(raw)?raw:String(raw||'').toUpperCase().split(/[,\s]+/).filter(Boolean);
  if(!a.length||a.length>MAX_SYMBOLS||new Set(a).size!==a.length||a.some(x=>!SYMBOL.test(x)))throw Error('Choose 1–5 unique USDT futures pairs, separated by commas');
  return a;
 };
 function create(symbols){
  const list=validSymbols(symbols),stores=Object.fromEntries(list.map(symbol=>[symbol,{symbol,bids:new Map(),asks:new Map(),bookTime:0,bookSeq:0,bookReady:false,midHistory:[],trades:[],tradeIds:new Set(),tradeTime:0,lastUpdate:0}]));
  function ingest(msg,now=Date.now()){
   if(!msg||typeof msg.topic!=='string'||!finite(now))return false;
   const parsed=/^(orderbook\.50|publicTrade)\.([A-Z0-9]+USDT)$/.exec(msg.topic);
   if(!parsed||!stores[parsed[2]])return false;
   const record=stores[parsed[2]],topic=parsed[1],data=msg.data;
   const ts=Number(msg.ts);
   if(!finite(ts)||ts<=0||Math.abs(now-ts)>10000)return false;
   if(topic==='orderbook.50'){
    if(!data||data.s!==record.symbol||!['snapshot','delta'].includes(msg.type))return false;
    const sequence=Number(data.seq),reset=msg.type==='snapshot'||Number(data.u)===1;
    if(!finite(sequence)||sequence<0||!reset&&(!record.bookReady||sequence<=record.bookSeq))return false;
    const bids=reset?new Map():new Map(record.bids),asks=reset?new Map():new Map(record.asks);
    for(const [levels,map] of [[data.b,bids],[data.a,asks]]){
     if(!Array.isArray(levels)||levels.length>200)return false;
     for(const level of levels){
      if(!Array.isArray(level)||level.length<2)return false;
      const price=Number(level[0]),amount=Number(level[1]);
      if(!finite(price)||price<=0||!finite(amount)||amount<0)return false;
      if(amount===0)map.delete(price);else map.set(price,amount);
     }
    }
    const bestBid=Math.max(...bids.keys()),bestAsk=Math.min(...asks.keys());
    if(!(bestBid>0&&bestAsk>bestBid)){record.bookReady=false;return false}
    record.bids=bids;record.asks=asks;record.bookSeq=sequence;record.bookTime=ts;record.bookReady=true;record.lastUpdate=now;
    const mid=(bestBid+bestAsk)/2,second=Math.floor(ts/1000);
    const last=record.midHistory.at(-1);
    if(last&&last.s===second)last.mid=mid;
    else if(!last||second>last.s)record.midHistory.push({s:second,mid});
    while(record.midHistory.length>92)record.midHistory.shift();
    return true;
   }
   if(!Array.isArray(data)||data.length>1024)return false;
   for(const trade of data){
    if(trade.s!==record.symbol||!['Buy','Sell'].includes(trade.S))continue;
    const t=Number(trade.T),price=Number(trade.p),qty=Number(trade.v),id=String(trade.i||'');
    if(!finite(t)||t<=0||t>now+2500||now-t>5500||!finite(price)||price<=0||!finite(qty)||qty<=0||!id||id.length>180||record.tradeIds.has(id))continue;
    record.trades.push({t,usd:price*qty,dir:trade.S==='Buy'?1:-1,id});
    record.tradeIds.add(id);record.tradeTime=Math.max(record.tradeTime,t);
   }
   const cutoff=now-42000;
   while(record.trades.length&&(record.trades[0].t<cutoff||record.trades.length>5500)){
    const removed=record.trades.shift();record.tradeIds.delete(removed.id);
   }
   return true;
  }
  const levels=(r,side)=>[...(side==='bid'?r.bids:r.asks).entries()].sort((a,b)=>side==='bid'?b[0]-a[0]:a[0]-b[0]).slice(0,50);
  function fill(levelsWanted,notional){
   let left=notional,value=0,quantity=0;
   for(const [price,size] of levelsWanted){
    const amount=Math.min(left,price*size);quantity+=amount/price;value+=amount;left-=amount;
    if(left<.00001)break;
   }
   if(left>.001||quantity<=0)return null;
   return value/quantity;
  }
  function execution(symbol,now=Date.now()){
   const r=stores[symbol];if(!r||!r.bookReady||now-r.bookTime>MAX_AGE_MS||r.bookTime>now+1000)return null;
   const bids=levels(r,'bid'),asks=levels(r,'ask'),bid=bids[0]?.[0],ask=asks[0]?.[0];
   if(!(bid>0&&ask>bid))return null;
   const mid=(bid+ask)/2,bidVwap=fill(bids,MIN_NOTIONAL),askVwap=fill(asks,MIN_NOTIONAL);
   if(!bidVwap||!askVwap||bidVwap>=askVwap)return null;
   const spreadBps=(ask-bid)/mid*1e4,roundTripImpactBps=(askVwap-bidVwap)/mid*1e4;
   const depthBid=bids.slice(0,5).reduce((n,[p,q])=>n+p*q,0),depthAsk=asks.slice(0,5).reduce((n,[p,q])=>n+p*q,0);
   const imbalance=(depthBid-depthAsk)/(depthBid+depthAsk);
   return {symbol,bid,ask,mid,bidVwap,askVwap,spreadBps,roundTripImpactBps,depthBid,depthAsk,imbalance,
    requiredMoveBps:GOAL_NET/MIN_NOTIONAL*1e4+(MAKERLESS_TAKER*2+EXTRA_SLIP*2)*1e4+roundTripImpactBps,
    observedAt:r.bookTime,notional:MIN_NOTIONAL,feeRate:MAKERLESS_TAKER,slippageRate:EXTRA_SLIP};
  }
  function observation(symbol,now=Date.now()){
   const r=stores[symbol];if(!r)return {symbol,state:'UNKNOWN',reason:'Pair not monitored'};
   const quote=execution(symbol,now);
   if(!quote)return {symbol,state:'NO_DATA',reason:'Missing, crossed, or stale order book'};
   const series=r.midHistory;
   function lookback(ms){
    const at=Math.floor((now-ms)/1000),past=[...series].reverse().find(x=>x.s<=at&&at-x.s<=3);
    return past?1e4*(quote.mid/past.mid-1):null;
   }
   const move5=lookback(5000),move15=lookback(15000),move30=lookback(30000);
   const recent=series.filter(x=>x.s>=Math.floor((now-30000)/1000)),prices=recent.map(x=>x.mid);
   const range30=prices.length?1e4*(Math.max(...prices)-Math.min(...prices))/quote.mid:null;
   const trades=r.trades.filter(t=>t.t>=now-15000),count=trades.length;
   const totalUsd=trades.reduce((n,t)=>n+t.usd,0);
   const pressure=totalUsd?trades.reduce((n,t)=>n+t.dir*t.usd,0)/totalUsd:0;
   const dir=move5===null||move15===null?0:Math.sign(move15);
   const reasons=[];
   if(move30===null||move15===null||move5===null||recent.length<23)reasons.push('Collecting 30 seconds of actual price observations');
   if(count<12||now-r.tradeTime>2500)reasons.push('Insufficient recent matched trades');
   if(quote.spreadBps>4)reasons.push('Spread too wide');
   if(quote.roundTripImpactBps>12)reasons.push('Order-book execution impact too high');
   if(quote.depthBid<1000||quote.depthAsk<1000)reasons.push('Not enough near-touch liquidity');
   if(!finite(range30)||range30<quote.requiredMoveBps*.9)reasons.push('30-second movement below net-profit break-even requirements');
   if(!dir||Math.sign(move5)!==dir||move15*dir<quote.requiredMoveBps*.27||move5*dir<quote.requiredMoveBps*.10)reasons.push('No sustained 5s/15s directional impulse');
   if(dir&&pressure*dir<.30)reasons.push('Aggressor trades do not confirm direction');
   if(dir&&quote.imbalance*dir<.06)reasons.push('Order-book depth does not confirm direction');
   if(range30>500)reasons.push('Extreme 30-second shock; avoid unbounded reversal risk');
   const qualified=reasons.length===0;
   const score=round(clamp(25*clamp((range30||0)/quote.requiredMoveBps,0,2)/2,0,25)+
    20*clamp(1-quote.roundTripImpactBps/12,0,1)+
    15*clamp(count/40,0,1)+
    15*clamp(dir*pressure,0,1)+
    10*clamp(dir*quote.imbalance/.6,0,1)+
    15*clamp(Math.abs(move15||0)/Math.max(quote.requiredMoveBps,1),0,1),1);
   return {...quote,state:qualified?'WATCH':move30===null?'WARMING':'WAIT',side:qualified?(dir===1?'BUY':'SELL'):null,score,
    move5Bps:move5,move15Bps:move15,move30Bps:move30,range30Bps:range30,matchedTrades15s:count,flowPressure:pressure,reason:reasons[0]||'Unusual short-term move with cost, liquidity and flow checks',reasons,
    meaning:'Microstructure eligibility heuristic, NOT a forecast, win probability or live trading authorization'};
  }
  return {symbols:list,ingest,execution,observation};
 }
 return {create,validSymbols,MIN_NOTIONAL,GOAL_NET,MAKERLESS_TAKER,EXTRA_SLIP};
});
