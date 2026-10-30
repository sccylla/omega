'use strict';
// Persistent Node runtime. Put behind HTTPS for authenticated browser use.
// Vercel deployments use an external persistent worker for live automation.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const auth = require('../lib/bybit-demo');
const {TradingWorker,setController} = require('../lib/trading-worker');
const {FilePaperStore,setLocalStore,configuredStore,handleStore}=require('../lib/paper-store');
const directory=process.env.OMEGA_WORKER_DATA_DIR||path.join(root,'.omega-data');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const lock=path.join(directory,'worker.lock');
const lockFd=fs.openSync(lock,'wx',0o600);
fs.writeSync(lockFd,String(process.pid));
const worker=new TradingWorker({directory});
setController(worker);
setLocalStore(new FilePaperStore(directory));
const {OmegaTelegramBot}=require('../lib/telegram-demo-bot');
let telegram=null;
// The Telegram bot is optional and controls only the independent $88 paper
// ledger. Neither Telegram commands nor its market feed can arm live trades.
if(process.env.OMEGA_TELEGRAM_BOT_TOKEN){
 telegram=new OmegaTelegramBot({directory});
 telegram.start();
 console.log('OMEGA Telegram DEMO controller initialized; owner authorization required');
}
const timer=setInterval(()=>worker.cycle(),15000);
const config = require(path.join(root, 'vercel.json'));
const apis = new Set(['market','demo','paper','quant','intelligence','forex-demo','scanner','live','bot','decision','quote']);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server = http.createServer(async (req, res) => {
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(value));
    return res;
  };
  try {
    const url = new URL(req.url, 'http://localhost');
    for (const rule of config.headers || []) {
      if (rule.source === '/(.*)' || rule.source === url.pathname) {
        for (const h of rule.headers) res.setHeader(h.key, h.value);
      }
    }
    if (url.pathname === '/healthz' && req.method === 'GET') {
      // An unprivileged liveness check, deliberately not a readiness claim:
      // credentials, worker activation and broker connectivity are private.
      res.setHeader('Cache-Control','no-store');
      return res.status(200).json({ok:true,service:'omega-worker',acceptingHttp:true});
    }
    if (['/worker/control','/worker/paper'].includes(url.pathname)) {
      const token=process.env.OMEGA_WORKER_TOKEN;
      if(!token||token.length<32||!auth.safeCompare(req.headers.authorization||'','Bearer '+token)) return res.status(401).json({error:'Worker authentication required'});
      if(req.method==='GET'){if(url.pathname==='/worker/paper'){const result=await handleStore(configuredStore(),'GET');return res.status(result.status).json(result.body)}return res.status(200).json(worker.status())}
      if(req.method!=='POST') return res.status(405).json({error:'GET or POST required'});
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>(url.pathname==='/worker/paper'?65536:4096))return res.status(413).json({error:'Body too large'})}
      try{if(url.pathname==='/worker/paper'){const result=await handleStore(configuredStore(),'POST',JSON.parse(body));return res.status(result.status).json(result.body)}return res.status(200).json(await worker.control(JSON.parse(body)))}catch(e){return res.status(e.status||409).json({error:e.message})}
    }
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/\.js$/, '');
      if (!apis.has(name)) return res.status(404).json({error:'Unknown API'});
      req.query = Object.fromEntries(url.searchParams);
      if (!['GET','HEAD'].includes(req.method)) {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 65536) return res.status(413).json({error:'Body too large'});
        }
        try { req.body = body ? JSON.parse(body) : {}; }
        catch { return res.status(400).json({error:'Invalid JSON'}); }
      }
      await require(path.join(root, 'api', name + '.js'))(req, res);
      return;
    }
    if (!['GET','HEAD'].includes(req.method)) return res.status(405).json({error:'GET required'});
    const name = decodeURIComponent(url.pathname);
    if (!['/','/index.html','/login.html'].includes(name) &&
        !/^\/static\/[A-Za-z0-9_-]+\.(js|css)$/.test(name)) return res.status(404).json({error:'Not found'});
    const file = path.join(root, name === '/' ? 'index.html' : name);
    const data = await fs.promises.readFile(file);
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control','no-store');
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (err) {
    if (res.headersSent) return res.destroy();
    res.status(err.code === 'ENOENT' ? 404 : 500).json({error:err.code === 'ENOENT' ? 'Not found' : 'Local development request failed'});
    console.error(err.message);
  }
});
server.requestTimeout = 30000;
server.listen(Number(process.env.PORT || process.env.OMEGA_DEV_PORT || 3000), process.env.OMEGA_BIND_HOST || '127.0.0.1', () => {
  console.log('OMEGA local development server ready on port ' + server.address().port);
});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
  clearInterval(timer);
  if(telegram)telegram.stop();
  // Drain in-flight broker work before releasing the single-worker lock.
  worker.queue.finally(()=>server.close(()=>{fs.closeSync(lockFd);fs.unlinkSync(lock);process.exit(0)}));
});
