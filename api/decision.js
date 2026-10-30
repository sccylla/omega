'use strict';
// Public research decision: no authentication, credentials or order submission.
const {collectEvidence,normalizeSymbol}=require('../lib/market-evidence');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'GET required'});
 let symbol,side,mode;
 try{
  const q=req.query||{};symbol=normalizeSymbol(q.symbol??'BTC');side=q.side;mode=q.mode??'live';
  if(side!==undefined&&!['BUY','SELL'].includes(side))throw Error('Invalid direction');
  if(!['demo','live'].includes(mode))throw Error('Invalid mode');
 }catch{return res.status(400).json({error:'Use a supported USDT market, optional BUY or SELL direction, and demo or live mode'})}
 try{
  const evidence=await collectEvidence(symbol);
  const {decide}=require('../lib/advanced-decision');
  return res.status(200).json({symbol,decision:decide(evidence,{side,mode,now:Date.now(),notional:10}),observedAt:evidence.observedAt});
 }catch{return res.status(502).json({error:'Market evidence decision is temporarily unavailable',symbol})}
};
