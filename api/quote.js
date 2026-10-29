'use strict';
const {collectQuote}=require('../lib/market-quote'),{normalizeSymbol}=require('../lib/market-evidence');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'GET required'});
 let symbol;try{symbol=normalizeSymbol(req.query?.symbol??'BTC')}catch{return res.status(400).json({error:'Use a supported USDT market symbol'})}
 try{return res.status(200).json(await collectQuote(symbol))}
 catch{return res.status(502).json({error:'Fresh market quote is temporarily unavailable',symbol})}
};
