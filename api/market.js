// Public market data relay only. Never handles private credentials or sends orders.
// Vercel Node.js function; validate all user-supplied market parameters.
const VALID_EXCHANGES = new Set(['bybit','okx','bitget']);
const VALID_SYMBOL = /^[A-Z0-9]{2,24}$/;
const VALID_TF = new Set(['5m','15m','1h','4h']);
const SPAN = {'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=15');
  if(req.method!=='GET') return res.status(405).json({error:'Use GET'});
  const {exchange='bybit',symbol='BTC',tf='1h'}=req.query||{};
  const limit = Math.max(90,Math.min(700,Number(req.query.limit)||240));
  if(!VALID_EXCHANGES.has(exchange)||!VALID_SYMBOL.test(symbol)||!VALID_TF.has(tf)||!Number.isInteger(limit)) return res.status(400).json({error:'Unsupported market request'});
  let url;
  if(exchange==='bybit'){
    url='https://api.bybit.com/v5/market/kline?'+new URLSearchParams({category:'linear',symbol:symbol+'USDT',interval:({'5m':'5','15m':'15','1h':'60','4h':'240'})[tf],limit:String(limit)});
  } else if(exchange==='okx'){
    url='https://www.okx.com/api/v5/market/candles?'+new URLSearchParams({instId:symbol+'-USDT-SWAP',bar:({'5m':'5m','15m':'15m','1h':'1H','4h':'4H'})[tf],limit:String(Math.min(limit,300))});
  } else {
    url='https://api.bitget.com/api/v3/market/candles?'+new URLSearchParams({category:'USDT-FUTURES',symbol:symbol+'USDT',interval:({'5m':'5m','15m':'15m','1h':'1H','4h':'4H'})[tf],limit:String(limit)});
  }
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(10000),headers:{'Accept':'application/json','User-Agent':'OmegaTraderWeb/1.0'}});
    if(!response.ok) throw Error('Upstream HTTP '+response.status);
    const payload=await response.json();
    if(exchange==='bybit' && payload.retCode!==0) throw Error(payload.retMsg||'Bybit response error');
    if(exchange==='okx' && payload.code!=='0') throw Error(payload.msg||'OKX response error');
    if(exchange==='bitget' && payload.code!=='00000') throw Error(payload.msg||'Bitget response error');
    const rows = exchange==='bybit'?payload.result?.list:payload.data;
    if(!Array.isArray(rows)) throw Error('Malformed exchange response');
    const candles=[...new Map(rows.map(row=>{
      const c=Array.from(row).slice(0,6).map(Number);
      return [c[0],c];
    })).values()].sort((a,b)=>a[0]-b[0]);
    if(candles.length<71 || candles.some(c=>c.length!==6 || c.some(x=>!Number.isFinite(x)) || c[1]<=0 || c[2]<c[3] || c[4]<=0)) throw Error('Invalid or insufficient candles');
    if(candles.at(-1)[0]<Date.now()-SPAN[tf]*3 || candles.at(-1)[0]>Date.now()+60000) throw Error('Exchange returned stale candles');
    return res.status(200).json({exchange,symbol,tf,candles,updated:Date.now(),mode:'public-data'});
  }catch(err){
    console.error('Omega market relay:',exchange,symbol,String(err.message).slice(0,150));
    return res.status(502).json({error:'Market feed temporarily unavailable: '+String(err.message).slice(0,120)});
  }
};
