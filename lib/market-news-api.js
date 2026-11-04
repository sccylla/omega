'use strict';
// Fixed public sources only. Market names filter relevance, never fetch URLs.
const {collectNews,assessNews}=require('./market-news');
const {normalizeSymbol}=require('./market-evidence');
function factory({collect=collectNews,clock=()=>Date.now()}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET')return res.status(405).json({error:'GET required'});
  let symbols;
  try{
   const raw=req.query?.symbols??'BTCUSDT';
   if(typeof raw!=='string'||raw.length>560)throw Error();
   const values=raw.split(',');
   if(!values.length||values.length>20)throw Error();
   symbols=[...new Set(values.map(normalizeSymbol))];
  }catch{return res.status(400).json({error:'Choose up to 20 comma-separated USDT markets'})}
  try{
   const evidence=await collect();const now=clock();
   return res.status(200).json({observedAt:evidence.observedAt,sources:evidence.sources,
    markets:Object.fromEntries(symbols.map(symbol=>[symbol,assessNews(evidence,{symbol,now})]))});
  }catch{return res.status(503).json({error:'News context unavailable; new entries must wait'})}
 };
}
module.exports=factory();module.exports.factory=factory;
