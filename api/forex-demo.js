'use strict';
const fx=require('../lib/forex-practice'),auth=require('../lib/bybit-demo');
module.exports=async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');const action=String(req.query?.action||'status');try{
 if(action==='status'&&req.method==='GET')return res.status(200).json({mode:'OANDA_PRACTICE_ONLY',keysConfigured:fx.credsReady(),authenticated:auth.isAuthed(req),ordersEnabled:fx.ordersEnabled(),practiceHost:'api-fxpractice.oanda.com',realMoneySupported:false});
 if(req.method==='POST')auth.assertOrigin(req);
 if(!auth.isAuthed(req))throw new fx.BrokerError(401,'Log in to the demo workspace first');
 if(action==='account'&&req.method==='GET'){const pair=String(req.query.pair||'EUR_USD');const s=await fx.snapshot(pair);return res.status(200).json({mode:'OANDA_PRACTICE_ONLY',connected:true,equity:s.equity,available:s.available,currency:s.currency,openPositions:s.positions.length,pending:s.pending,bid:s.bid,ask:s.ask,instrument:s.instrument,ordersEnabled:fx.ordersEnabled()});}
 if(action==='preview'&&req.method==='POST')return res.status(200).json(await fx.preview(req.body||{}));
 if(action==='order'&&req.method==='POST')return res.status(200).json(await fx.execute(req.body?.previewToken,req.body?.confirm));
 throw new fx.BrokerError(404,'Unknown Forex demo action');
 }catch(e){return res.status(e instanceof fx.BrokerError?e.status:500).json({error:e instanceof fx.BrokerError?e.message:'Practice broker unavailable',mode:'OANDA_PRACTICE_ONLY'});}};
