'use strict';const live=require('../lib/live-readonly'),auth=require('../lib/bybit-demo');
module.exports=async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Live order execution is not enabled; read-only requests only'});
 const action=String(req.query.action||'status');if(action==='status')return res.status(200).json({mode:'LIVE_READ_ONLY',bybitConfigured:live.bybitReady(),oandaConfigured:live.oandaReady(),authenticated:auth.isAuthed(req),liveOrdersEnabled:false,automatedOrdersEnabled:false,detail:'Funds remain with the broker. This deployment cannot place live trades.'});
 if(!auth.isAuthed(req))return res.status(401).json({error:'Protected dashboard login required'});
 try{if(action==='bybit')return res.status(200).json(await live.bybitOverview());if(action==='oanda')return res.status(200).json(await live.oandaOverview());return res.status(404).json({error:'Unknown live account action'});}catch(e){return res.status(e instanceof live.LiveError?e.status:502).json({error:e instanceof live.LiveError?e.message:'Live read-only connection failed'});}
};
