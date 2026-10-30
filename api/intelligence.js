'use strict';
const model=require('../lib/omega-intelligence'),fx=require('../lib/forex-practice'),walkForward=require('../lib/walk-forward'),history=require('../lib/bybit-history'),adaptive=require('../lib/adaptive-validation');
const {makeForecast}=require('../lib/shadow-forecast'),{collectQuote}=require('../lib/market-quote');
const SYMBOLS=new Set(['BTC','ETH','SOL']);
async function bybitBars(symbol){const url='https://api.bybit.com/v5/market/kline?'+new URLSearchParams({category:'linear',symbol:symbol+'USDT',interval:'5',limit:'1000'});const r=await fetch(url,{signal:AbortSignal.timeout(10500),headers:{Accept:'application/json'}});if(!r.ok)throw Error('Bybit public feed HTTP '+r.status);const p=await r.json();if(p.retCode!==0)throw Error('Bybit market feed rejected request');return (p.result?.list||[]).map(c=>c.slice(0,6).map(Number)).filter(c=>c.every(Number.isFinite)&&c[0]+300000<=Date.now()).sort((a,b)=>a[0]-b[0]);}
module.exports=async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');if(req.method!=='GET')return res.status(405).json({error:'GET only'});
const validation=String(req.query.validation||'single');if(!['single','walkforward','adaptive','shadow'].includes(validation))return res.status(400).json({error:'Invalid research validation mode'});
const market=String(req.query.market||'futures'),asset=String(req.query.asset||'BTC').toUpperCase(),equity=Number(req.query.equity||10000),riskPct=Number(req.query.riskPct??.25),dailyRiskPct=Number(req.query.dailyRiskPct??2);
if(!['forex','futures'].includes(market)||market==='futures'&&!/^[A-Z0-9]{2,20}$/.test(asset)||market==='forex'&&!fx.INSTRUMENTS.has(asset)||!Number.isFinite(equity)||equity<100||equity>1000000||!Number.isFinite(riskPct)||riskPct<.05||riskPct>.25||!Number.isFinite(dailyRiskPct)||dailyRiskPct<.5||dailyRiskPct>5)return res.status(400).json({error:'Invalid market or risk settings'});
try{
if(validation==='shadow'){
 if(market!=='futures'||!['BTC','ETH','SOL'].includes(asset))return res.status(400).json({error:'Shadow research supports BTC, ETH and SOL futures only'});
 const [collection,quote]=await Promise.all([history.readHistory(asset+'USDT',{days:7}),collectQuote(asset+'USDT')]);
 return res.status(200).json(makeForecast(collection.bars,{asset,quote,now:Date.now()}));
}
if(validation==='walkforward'&&market!=='futures')return res.status(400).json({error:'Walk-forward evaluation currently supports Bybit futures only'});
if(validation==='adaptive'&&market!=='futures')return res.status(400).json({error:'Long-history adaptive research currently supports Bybit futures only'});
const days=validation==='adaptive'?Number(req.query.days||56):null;
if(validation==='adaptive'&&!history.ALLOWED_DAYS.has(days))return res.status(400).json({error:'Choose a supported history period (28 or 56 days)'});
const collection=validation==='adaptive'?await history.readHistory(asset+'USDT',{days}):null;
const bars=collection?.bars||(market==='forex'?await fx.candles(asset,'M5',1200):await bybitBars(asset));
const result=validation==='adaptive'?adaptive.evaluateAdaptive(bars,{asset,history:collection}):validation==='walkforward'?walkForward.evaluateWalkForward(bars,{asset}):model.analyze(bars,{market,asset,equity,riskPct,dailyRiskPct});
return res.status(200).json({mode:'RESEARCH_ONLY',source:market==='forex'?'OANDA PRACTICE':'BYBIT PUBLIC',candles:bars.slice(-100).map(c=>[c[0],c[4]]),...result});}catch(e){const status=e instanceof fx.BrokerError?e.status:502;return res.status(status).json({error:String(e?.message||'Intelligence temporarily unavailable').slice(0,180),market,asset,configurationRequired:market==='forex'&&!fx.credsReady(),mode:'NO ORDER PLACED'});}};
