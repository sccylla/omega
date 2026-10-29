'use strict';
const scanner=require('../lib/opportunity-scanner');const fx=require('../lib/forex-practice');
const BASE='https://api.bybit.com';
async function pub(path){const r=await fetch(BASE+path,{redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Bybit public API HTTP '+r.status);const p=await r.json();if(p.retCode!==0)throw Error('Bybit rejected public market request');return p.result||{};}
async function futures(){
 const ticker=await pub('/v5/market/tickers?category=linear');
 let list=[],cursor='',pages=0;
 do{let qs=new URLSearchParams({category:'linear',limit:'1000',status:'Trading'});if(cursor)qs.set('cursor',cursor);let p=await pub('/v5/market/instruments-info?'+qs);list.push(...(p.list||[]));cursor=p.nextPageCursor||'';pages++;}while(cursor&&pages<10);
 if(cursor)throw Error('Market instruments pagination incomplete; try again');
 const active=new Set(list.filter(x=>x.status==='Trading'&&x.quoteCoin==='USDT').map(x=>x.symbol));
 const rows=(ticker.list||[]).filter(x=>active.has(x.symbol)).map(scanner.futuresScreen).filter(Boolean);
 rows.sort((a,b)=>Math.max(b.buyScore,b.sellScore)-Math.max(a.buyScore,a.sellScore)||b.turnover24h-a.turnover24h);
 return {mode:'PUBLIC_RESEARCH_ONLY',market:'futures',universe:rows.length,source:'BYBIT V5 TICKERS + TRADEABLE INSTRUMENTS',evaluatedWithHistory:0,coverage:'FULL SNAPSHOT UNIVERSE; historical model only on selected asset',timestamp:Date.now(),rows};
}
async function forex(page=1,pageSize=12){if(!fx.credsReady())return {market:'forex',mode:'READ_ONLY_RESEARCH',requiresConnection:true,source:'OANDA PRACTICE ACCOUNT REQUIRED',rows:[],universe:0,examples:['EUR_USD','GBP_USD','USD_JPY','EUR_JPY','AUD_USD','USD_CAD','GBP_JPY']};
 const response=await fx.request('GET','/v3/accounts/'+fx.accountId()+'/instruments');const universe=(response.instruments||[]).filter(x=>x.type==='CURRENCY'&&fx.INSTRUMENTS.has(x.name)).map(x=>x.name).sort();
 const offset=(page-1)*pageSize,items=universe.slice(offset,offset+pageSize),rows=[];
 // Bound concurrency to avoid broker rate spikes. Individual missing markets fail closed.
 for(let i=0;i<items.length;i+=4){const batch=await Promise.all(items.slice(i,i+4).map(async pair=>{try{return scanner.forexScreen(pair,await fx.candles(pair,'M5',100))}catch(e){return {symbol:pair,market:'forex',status:'UNAVAILABLE',buyScore:null,sellScore:null,reason:'Broker candle history unavailable',screenType:'NO_SIGNAL'}}}));rows.push(...batch)}
 rows.sort((a,b)=>Math.max(b.buyScore||0,b.sellScore||0)-Math.max(a.buyScore||0,a.sellScore||0));
 return {mode:'READ_ONLY_RESEARCH',market:'forex',universe:universe.length,availableMarkets:universe,scanned:rows.length,page,pageSize,totalPages:Math.ceil(universe.length/pageSize),timestamp:Date.now(),source:'OANDA PRACTICE CURRENCY INSTRUMENTS + 5M CANDLES',rows};
}
module.exports=async(req,res)=>{res.setHeader('Cache-Control','public,s-maxage=20,stale-while-revalidate=20');res.setHeader('X-Content-Type-Options','nosniff');if(req.method!=='GET')return res.status(405).json({error:'GET required'});
 const market=String(req.query.market||'futures'),page=Number(req.query.page||1),size=Number(req.query.size||12);
 if(!['forex','futures'].includes(market)||!Number.isInteger(page)||page<1||page>20||!Number.isInteger(size)||size<1||size>15)return res.status(400).json({error:'Invalid scanner input'});
 try{return res.status(200).json(market==='futures'?await futures():await forex(page,size))}catch(e){return res.status(502).json({market,error:String(e.message||'Scanner failed').slice(0,180),rows:[]})}
};
module.exports._futures=futures;module.exports._forex=forex;
