'use strict';
const auth=require('../lib/bybit-demo'),{configuredStore,handleStore,StoreError}=require('../lib/paper-store');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET or POST required'});
 if(!auth.isAuthed(req))return res.status(401).json({error:'Sign in to access the shared demo account'});
 try{
  if(req.method==='POST')auth.assertOrigin(req);
  const store=configuredStore();
  if(store){const result=await handleStore(store,req.method,req.body);return res.status(result.status).json(result.body)}
  const endpoint=process.env.OMEGA_WORKER_URL,token=process.env.OMEGA_WORKER_TOKEN;
  if(endpoint&&token?.length>=32){
   const url=new URL('/worker/paper',endpoint);if(url.protocol!=='https:')throw new StoreError(503,'Worker URL must use HTTPS');
   const response=await fetch(url,{method:req.method,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:req.method==='POST'?JSON.stringify(req.body):undefined,signal:AbortSignal.timeout(10000)});
   return res.status(response.status).json(await response.json());
  }
  return res.status(503).json({configured:false,error:'Shared demo storage is not configured. Connect Upstash Redis to this Vercel project and redeploy.'});
 }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Shared demo storage is unavailable'})}
};
