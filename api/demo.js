'use strict';
const b=require('../lib/bybit-demo');
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
    const action=String(req.query?.action||'status');
    if(action==='status' && req.method==='GET')return res.status(200).json({mode:'BYBIT_DEMO_ONLY',passwordConfigured:b.passwordReady(),keysConfigured:b.keyReady(),ordersEnabled:b.canTrade(),authenticated:b.isAuthed(req),demoHost:'api-demo.bybit.com'});
    if(action==='session' && req.method==='GET')return res.status(200).json({authenticated:b.isAuthed(req),mode:'BYBIT_DEMO_ONLY'});
    if(req.method==='POST')b.assertOrigin(req);
    if(action==='login' && req.method==='POST'){
      if(!b.passwordReady())throw new b.HttpError(503,'Owner has not configured dashboard authentication in Vercel');
      const record=b.checkAttempts(req.headers['x-forwarded-for']?.split(',')[0]||req.socket?.remoteAddress);
      if(!b.safeCompare(req.body?.password||'',process.env.OMEGA_DASHBOARD_PASSWORD)){b.failedAttempt(record);throw new b.HttpError(401,'Incorrect password');}
      b.setCookie(res,b.cookieValue(),6*60*60);
      return res.status(200).json({authenticated:true,mode:'BYBIT_DEMO_ONLY'});
    }
    if(action==='logout' && req.method==='POST'){b.setCookie(res,'',0);return res.status(200).json({authenticated:false});}
    if(!b.isAuthed(req))throw new b.HttpError(401,'Dashboard login required');
    if(action==='account'&&req.method==='GET')return res.status(200).json(await b.accountOverview());
    if(action==='preview'&&req.method==='POST')return res.status(200).json(await b.createPreview(req.body||{}));
    if(action==='order'&&req.method==='POST')return res.status(200).json(await b.executePreview(req.body||{}));
    if(action==='cancel'&&req.method==='POST')return res.status(200).json(await b.cancelDemoOrders(req.body||{}));
    throw new b.HttpError(404,'Unknown demo action');
  }catch(e){const status=e instanceof b.HttpError?e.status:500;console.error('Demo API:',status,e.constructor.name,String(e.message).slice(0,100));return res.status(status).json({error:status===500?'Internal demo service error':e.message,mode:'BYBIT_DEMO_ONLY'});}
};
