'use strict';
// OMEGA Quant public-data research endpoint. READ ONLY. No private Bybit credentials.
const quant=require('../lib/quant-engine');
const BASE='https://api.bybit.com';
const SYMBOLS=new Set(['BTC','ETH','SOL']);
function cleanRows(list,duration){if(!Array.isArray(list))throw Error('Bad exchange candles');const out=[...new Map(list.map(row=>{const r=Array.from(row).slice(0,6).map(Number);return [r[0],r];})).values()].sort((a,b)=>a[0]-b[0]);const now=Date.now();const completed=out.filter(r=>r[0]+duration<=now);quant.validateCandles(completed,90);if(now-(completed.at(-1)[0]+duration)>duration*3)throw Error('Market feed stale');return completed;}
async function bybit(path,params,required=true){const url=BASE+path+'?'+new URLSearchParams(params);try{const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'OmegaTraderResearch/3.0'},signal:AbortSignal.timeout(9500)});if(!r.ok)throw Error('Bybit HTTP '+r.status);const data=await r.json();if(data.retCode!==0)throw Error('Bybit API '+String(data.retMsg||data.retCode).slice(0,60));return data.result;}catch(err){if(required)throw err;return null;}}
module.exports=async function handler(req,res){res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');if(req.method!=='GET')return res.status(405).json({error:'Only GET supported'});
 const s=String(req.query.symbol||'BTC').toUpperCase(),e=Number(req.query.equity??10000),target=Number(req.query.target??1),mode=String(req.query.mode||'scan');
 if(!SYMBOLS.has(s)||!Number.isFinite(e)||e<100||e>1000000||!Number.isFinite(target)||target<0.25||target>50||!['scan','test'].includes(mode))return res.status(400).json({error:'Invalid research parameters'});
 const symbol=s+'USDT';
 try{const [f,q,h,book,ticker,oi]=await Promise.all([
 bybit('/v5/market/kline',{category:'linear',symbol,interval:'5',limit:mode==='test'?'1000':'250'}),
 bybit('/v5/market/kline',{category:'linear',symbol,interval:'15',limit:'230'}),
 bybit('/v5/market/kline',{category:'linear',symbol,interval:'60',limit:'120'}),
 bybit('/v5/market/orderbook',{category:'linear',symbol,limit:'25'},false),
 bybit('/v5/market/tickers',{category:'linear',symbol},false),
 bybit('/v5/market/open-interest',{category:'linear',symbol,intervalTime:'5min',limit:'3'},false),
 ]);
 const now=Date.now();const five=cleanRows(f.list,quant.FIVE),quarter=cleanRows(q.list,quant.FIFTEEN),hour=cleanRows(h.list,quant.HOUR);
 let oiPct=null;const arr=oi?.list;if(Array.isArray(arr)&&arr.length>=2){const newer=Number(arr[0].openInterest),older=Number(arr[1].openInterest);if(newer>0&&older>0)oiPct=(newer/older-1)*100;}
 const funding=Number(ticker?.list?.[0]?.fundingRate);const result=quant.analyze({five,quarter,hour,book,fundingRate:Number.isFinite(funding)?funding:null,openInterestChangePct:oiPct,equity:e,target,nowMs:now});
 if(mode==='test'){const test=quant.historicalTest(five,{equity:e,target,nowMs:now});return res.status(200).json({market:s,exchange:'BYBIT',mode:'BACKTEST',timeframe:'5m',timestamp:now,result,backtest:test,limitations:'Demo/research only. In-sample historical evaluation, not evidence of future profits. No real orders or keys.'});}
 return res.status(200).json({market:s,exchange:'BYBIT',mode:'RESEARCH',timeframe:'5m',timestamp:now,result,feeds:{candles5m:five.length,candles15m:quarter.length,candles1h:hour.length,orderBook:!!book,openInterest:oiPct!==null,funding:Number.isFinite(funding)},limitations:'Estimated indicators, not ML probability. Server-side public data only. No live orders.'});
 }catch(err){console.error('OMEGA Quant public data failure',s,String(err?.message||err).slice(0,140));return res.status(502).json({error:'Live market intelligence unavailable: '+String(err?.message||'upstream unavailable').slice(0,110)});}
};
