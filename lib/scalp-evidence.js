'use strict';
// Independent, current Bybit PUBLIC trade+depth confirmation before any
// small real scalp can enter. Never trust the browser's WATCH signal alone.
const MAX_AGE_MS=3000;
const positive=x=>Number.isFinite(Number(x))&&Number(x)>0?Number(x):NaN;
function decide({trades,book,now=Date.now(),side,notional=15}={}){
 const checks=[],add=(label,pass)=>{checks.push({label,pass:!!pass});return !!pass};
 if(!['Buy','Sell'].includes(side)||!Number.isFinite(now)||notional!==15)
  return {eligible:false,reason:'Invalid scalp request',checks};
 const bids=Array.isArray(book?.b)?book.b:[],asks=Array.isArray(book?.a)?book.a:[];
 const bid=positive(bids[0]?.[0]),ask=positive(asks[0]?.[0]),spread=10000*(ask-bid)/((ask+bid)/2);
 add('Fresh executable Bybit order book',Number.isFinite(bid)&&Number.isFinite(ask)&&bid<ask&&
  (!Number.isFinite(Number(book?.ts))||Math.abs(now-Number(book.ts))<=MAX_AGE_MS));
 add('Spread no more than 2.5 basis points',Number.isFinite(spread)&&spread>=0&&spread<=2.5);
 let buyDepth=0,sellDepth=0,buyTop=0,sellTop=0;
 for(const [p,q] of bids){const price=positive(p),qty=positive(q);if(Number.isFinite(price)&&Number.isFinite(qty)&&price>=bid*.999)buyDepth+=price*qty;if(Number.isFinite(price)&&Number.isFinite(qty)&&price>=bid*.9995)buyTop+=price*qty}
 for(const [p,q] of asks){const price=positive(p),qty=positive(q);if(Number.isFinite(price)&&Number.isFinite(qty)&&price<=ask*1.001)sellDepth+=price*qty;if(Number.isFinite(price)&&Number.isFinite(qty)&&price<=ask*1.0005)sellTop+=price*qty}
 const imbalance=(buyTop-sellTop)/(buyTop+sellTop);
 add('At least $75 executable depth on each side within 10bp',buyDepth>=75&&sellDepth>=75);
 add('Order-book imbalance supports direction',Number.isFinite(imbalance)&&(side==='Buy'?imbalance>=.07:imbalance<=-.07));
 const recent=(Array.isArray(trades)?trades:[]).map(t=>({t:Number(t.T),p:positive(t.p),v:positive(t.v),s:t.S}))
  .filter(t=>Number.isFinite(t.t)&&t.t<=now+2000&&t.t>=now-60000&&Number.isFinite(t.p)&&
   Number.isFinite(t.v)&&['Buy','Sell'].includes(t.s)).sort((a,b)=>a.t-b.t);
 add('At least 30 recent exchange-matched trades',recent.length>=30);
 const span=recent.length?(recent.at(-1).t-recent[0].t)/1000:0;
 add('Independent trade span at least 15 seconds',span>=15);
 const last=recent.filter(t=>t.t>=now-15000),first=recent.filter(t=>t.t<=now-15000);
 const p0=first.length?first.at(-1).p:NaN,p1=last.length?last.at(-1).p:NaN;
 const move15=10000*(p1/p0-1),direction=side==='Buy'?1:-1;
 add('Directional 15-second movement exceeds 10bp',Number.isFinite(move15)&&direction*move15>=10);
 const flow=last.reduce((a,t)=>{a.total+=t.v*t.p;if(t.s===side)a.with+=t.v*t.p;return a},{total:0,with:0});
 const pressure=flow.with/flow.total;
 add('Aggressor volume confirms direction',last.length>=12&&Number.isFinite(pressure)&&pressure>=.63);
 const prices=recent.map(t=>t.p),hi=Math.max(...prices),lo=Math.min(...prices);
 const rangeBps=prices.length>2?(hi-lo)/((hi+lo)/2)*10000:NaN;
 // $.05 modeled net target + ~$.03 fees and slip on a $15 1x position.
 const requiredMoveBps=10000*(.05+.03)/15;
 add('Observed 60-second range can exceed modeled fees and net target',
  Number.isFinite(rangeBps)&&rangeBps>=requiredMoveBps);
 const failed=checks.find(c=>!c.pass);
 return {eligible:!failed,reason:failed?.label||'Order flow, spread, depth and observed movement qualify',
  side,spreadBps:spread,imbalance,pressure,move15Bps:move15,rangeBps,requiredMoveBps,
  sampleCount:recent.length,checks};
}
async function validate(broker,symbol,side,now=Date.now()){
 if(!/^[A-Z0-9]{2,20}USDT$/.test(symbol)||!['Buy','Sell'].includes(side))
  throw Error('Invalid scalp market or direction');
 const [trades,book]=await Promise.all([
  broker.request('GET','/v5/market/recent-trade',{category:'linear',symbol,limit:'1000'},false),
  broker.request('GET','/v5/market/orderbook',{category:'linear',symbol,limit:'50'},false)]);
 const events=trades.list;
 if(!Array.isArray(events)||!Array.isArray(book.b)||!Array.isArray(book.a)||
  (book.s!==undefined&&book.s!==symbol))
  throw Error('Incomplete public trade/depth validation for scalp');
 const checked=decide({trades:events,book,now,side,notional:15});
 if(!checked.eligible)throw Error('Scalp entry blocked: '+checked.reason);
 return checked;
}
module.exports={decide,validate};
