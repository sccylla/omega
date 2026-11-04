'use strict';
// Public headlines are unverified reports, never instructions or buy/sell signals.
const SOURCES=Object.freeze([
 Object.freeze({id:'coindesk',name:'CoinDesk',url:'https://www.coindesk.com/arc/outboundfeeds/rss/'}),
 Object.freeze({id:'cointelegraph',name:'Cointelegraph',url:'https://cointelegraph.com/rss'})
]);
const CACHE_MS=60000,MAX_AGE_MS=120000,ARTICLE_AGE_MS=86400000,EVENT_WINDOW_MS=3600000,MAX_BYTES=512*1024;
const state=new WeakMap();
const LIMITATIONS='Two public headline feeds only; reports and keyword relevance are unverified and may be late, incomplete or wrong. This is an event-risk veto, not sentiment, a calibrated forecast or a profit prediction. No full news or economic-calendar coverage.';
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child)}return value}
function clean(value){
 return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&(?:#(x[0-9a-f]+|\d+)|(amp|lt|gt|quot|apos));/gi,(_,code,named)=>{
  if(named)return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[named.toLowerCase()];
  const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):' ';
 }).replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
}
function field(item,name){return new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i').exec(item)?.[1]||''}
function published(value,now){
 const raw=clean(value);
 // Require an explicit timezone. A date-only string or local machine time is not evidence.
 const rfc=/^(?:[a-z]{3},\s*)?(\d{1,2})\s+([a-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(?:GMT|UTC|[+-]\d{4})$/i.exec(raw);
 const iso=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.exec(raw);
 const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 const pieces=rfc?[Number(rfc[3]),months.indexOf(rfc[2].toLowerCase())+1,Number(rfc[1]),Number(rfc[4]),Number(rfc[5]),Number(rfc[6]||0)]:iso?iso.slice(1,7).map(Number):null;
 if(!pieces)return null;
 const [year,month,day,hour,minute,second]=pieces;
 if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59)return null;
 const date=Date.parse(raw);return Number.isFinite(date)&&date>0&&date<=now?date:null;
}
function articleUrl(value,source){try{const u=new URL(clean(value)),expected=new URL(source.url);if(u.protocol!=='https:'||u.hostname!==expected.hostname||u.username||u.password||u.port)return null;u.hash='';return u.href}catch{return null}}
function parseFeed(xml,source,now){
 if(typeof xml!=='string'||Buffer.byteLength(xml)>MAX_BYTES||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<rss(?:\s|>)|<feed(?:\s|>)/i.test(xml))throw Error('MALFORMED_FEED');
 const blocks=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,200),articles=[];
 for(const [,item]of blocks){
  const title=clean(field(item,'title')).slice(0,300),url=articleUrl(field(item,'link'),source),publishedAt=published(field(item,'pubDate'),now);
  if(title.length>=8&&url&&publishedAt!==null&&now-publishedAt<=ARTICLE_AGE_MS)articles.push({title,url,source:source.id,publishedAt});
 }
 if(!articles.length)throw Error('NO_CURRENT_VALID_ARTICLES');
 return articles;
}
async function readBounded(response){
 const length=Number(response.headers?.get?.('content-length'));if(length>MAX_BYTES)throw Error('FEED_TOO_LARGE');
 if(!response.body?.getReader){const body=await response.text();if(Buffer.byteLength(body)>MAX_BYTES)throw Error('FEED_TOO_LARGE');return body}
 const reader=response.body.getReader(),parts=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();throw Error('FEED_TOO_LARGE')}parts.push(value)}}finally{reader.releaseLock()}
 return Buffer.concat(parts).toString('utf8');
}
async function build(fetcher,now){
 const results=await Promise.all(SOURCES.map(async source=>{
  try{
   const response=await fetcher(source.url,{method:'GET',redirect:'error',headers:{Accept:'application/rss+xml, application/xml, text/xml','User-Agent':'OmegaTraderNews/1.0'},signal:AbortSignal.timeout(4000)});
   if(!response?.ok)throw Error('UPSTREAM_HTTP_ERROR');
   const articles=parseFeed(await readBounded(response),source,now);
   return {source:{...source,ok:true,latestPublishedAt:Math.max(...articles.map(a=>a.publishedAt))},articles};
  }catch(error){return {source:{...source,ok:false,latestPublishedAt:null,error:['FEED_TOO_LARGE','MALFORMED_FEED','NO_CURRENT_VALID_ARTICLES','UPSTREAM_HTTP_ERROR'].includes(error?.message)?error.message:'NEWS_UNAVAILABLE'},articles:[]}}
 }));
 const seen=new Set(),articles=results.flatMap(r=>r.articles).sort((a,b)=>b.publishedAt-a.publishedAt).filter(a=>{const key=a.title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(seen.has(key))return false;seen.add(key);return true}).slice(0,200);
 return freeze({observedAt:now,sources:results.map(r=>r.source),articles});
}
function collectNews({fetcher=fetch,now=Date.now()}={}){
 if(typeof fetcher!=='function'||!Number.isFinite(now))return Promise.reject(new TypeError('Invalid news request'));
 let entry=state.get(fetcher);if(!entry){entry={};state.set(fetcher,entry)}
 if(entry.snapshot&&now>=entry.snapshot.observedAt&&now-entry.snapshot.observedAt<CACHE_MS)return Promise.resolve(entry.snapshot);
 if(entry.pending)return entry.pending;
 entry.pending=build(fetcher,now).then(snapshot=>(entry.snapshot=snapshot)).finally(()=>{entry.pending=null});return entry.pending;
}
const ALIASES={BTC:['bitcoin','btc'],ETH:['ethereum','ether','eth'],SOL:['solana','sol'],XRP:['ripple','xrp'],DOGE:['dogecoin','doge'],BNB:['binance coin','bnb'],ADA:['cardano','ada'],AVAX:['avalanche','avax'],LINK:['chainlink','link'],DOT:['polkadot','dot'],LTC:['litecoin','ltc'],BCH:['bitcoin cash','bch'],SUI:['sui'],TON:['toncoin','ton'],TRX:['tron','trx'],USDC:['usdc','usd coin'],USDT:['tether','usdt']};
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function eventRisk(article,symbol,now){
 if(!article||typeof article.title!=='string'||!Number.isFinite(article.publishedAt)||article.publishedAt>now||now-article.publishedAt>EVENT_WINDOW_MS)return null;
 const title=article.title.toLowerCase(),base=String(symbol||'').replace(/USDT$/,'');
 const asset=(ALIASES[base]||[base]).filter(Boolean).some(alias=>new RegExp('(?:^|[^a-z0-9])'+escape(alias.toLowerCase())+'(?:$|[^a-z0-9])').test(title));
 const macro=/\b(?:fomc|cpi|pce|nonfarm payrolls?|interest.rate decision|rate (?:cut|hike|decision)|federal reserve|fed meeting)\b/.test(title);
 const broad=/\b(?:crypto(?:currency)?|digital assets?|stablecoins?|binance|bybit|coinbase|kraken|okx|tether|usdt|usdc)\b/.test(title);
 if(!asset&&!macro&&!broad)return null;
 let category=null;
 if(/\b(?:hack(?:ed|ers?|ing)?|exploit(?:ed|s|ation)?|insolven(?:cy|t)|bankrupt(?:cy)?|depeg(?:s|ged|ging)?|breach|stolen|theft)\b/.test(title))category='SECURITY_OR_SOLVENCY';
 else if(/\b(?:delist(?:ed|ing|s)?|(?:trading|withdrawals?|deposits?) (?:suspend(?:ed|s|ing)?|halt(?:ed|s)?|paused)|suspends? (?:trading|withdrawals?|deposits?))\b/.test(title))category='TRADING_DISRUPTION';
 else if(/\b(?:sec|cftc|doj|regulator(?:s|y)?|lawsuit|enforcement)\b/.test(title)&&/\b(?:su(?:e|es|ed|ing)|charges?|lawsuit|ban(?:s|ned)?|enforcement|investigat(?:ion|es|ed)|seiz(?:e|es|ed|ure)|crackdown)\b/.test(title))category='REGULATORY_EVENT';
 else if(macro)category='MACRO_EVENT';
 return category?{...article,category,relevance:macro||broad?'MARKET_WIDE':'ASSET',pauseUntil:article.publishedAt+EVENT_WINDOW_MS}:null;
}
function assessNews(evidence,{symbol,now=Date.now()}={}){
 const sources=Array.isArray(evidence?.sources)?evidence.sources:[],articles=Array.isArray(evidence?.articles)?evidence.articles:[];
 const current=Number.isFinite(now)&&Number.isFinite(evidence?.observedAt)&&evidence.observedAt<=now&&now-evidence.observedAt<=MAX_AGE_MS;
 const good=SOURCES.filter(expected=>sources.some(s=>s?.id===expected.id&&s.url===expected.url&&s.ok===true&&Number.isFinite(s.latestPublishedAt)&&s.latestPublishedAt<=now&&now-s.latestPublishedAt<=ARTICLE_AGE_MS));
 const ready=current&&good.length===SOURCES.length;
 const headlines=articles.filter(a=>SOURCES.some(s=>s.id===a?.source&&articleUrl(a.url,s))&&typeof a.title==='string'&&Number.isFinite(a.publishedAt)&&a.publishedAt<=now&&now-a.publishedAt<=ARTICLE_AGE_MS).map(a=>({...a,title:clean(a.title).slice(0,300)}));
 const events=headlines.map(a=>eventRisk(a,symbol,now)).filter(Boolean),blocked=!ready||events.length>0;
 return {ready,blocked,status:!ready?'UNAVAILABLE':events.length?'EVENT_RISK':'READY',reason:!ready?'Current news coverage could not be verified from both headline feeds':events.length?'New entries paused after a recent relevant high-impact headline: '+events[0].title:'No recent relevant event-risk keywords found in the monitored headlines',sourceCount:good.length,latestPublishedAt:headlines.length?Math.max(...headlines.map(a=>a.publishedAt)):null,events,headlines:headlines.slice(0,8),limitations:LIMITATIONS};
}
module.exports={collectNews,assessNews,SOURCES,MAX_AGE_MS,EVENT_WINDOW_MS};
