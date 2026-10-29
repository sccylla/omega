'use strict';
const auth=require('../lib/bybit-demo'),{getController}=require('../lib/trading-worker');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET or POST required'});
 if(!auth.isAuthed(req))return res.status(401).json({error:'Sign in before accessing live automation'});
 try{
  if(req.method==='POST')auth.assertOrigin(req);
  const controller=getController();
  if(controller)return res.status(200).json(req.method==='GET'?controller.status():await controller.control(req.body||{}));
  // Vercel can forward control to a separately hosted persistent OMEGA worker.
  const endpoint=process.env.OMEGA_WORKER_URL,token=process.env.OMEGA_WORKER_TOKEN;
  if(!endpoint||!token||token.length<32)return res.status(503).json({error:'Persistent live worker is not configured. Host scripts/server.js and configure OMEGA_WORKER_URL / OMEGA_WORKER_TOKEN, or use that server directly.'});
  const url=new URL('/worker/control',endpoint);if(url.protocol!=='https:')throw Error('Worker URL must use HTTPS');
  const response=await fetch(url,{method:req.method,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:req.method==='POST'?JSON.stringify(req.body||{}):undefined,signal:AbortSignal.timeout(20000)});
  const data=await response.json();return res.status(response.status).json(data);
 }catch(e){return res.status(e.status||409).json({error:e.message||'Live automation request failed'})}
};
