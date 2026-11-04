'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectNews,assessNews,SOURCES,EVENT_WINDOW_MS}=require('../lib/market-news');
const NOW=Date.UTC(2026,10,3,12,0,0);
const date=t=>new Date(t).toUTCString();
function item(source,{title='Bitcoin market trades steadily as liquidity improves',time=NOW-600000,url}={}){
 return '<item><title><![CDATA['+title+']]></title><link>'+(url||new URL('/markets/test',source.url).href)+'</link><pubDate>'+date(time)+'</pubDate></item>';
}
function fixture(options={}){
 const calls=[];
 const fetcher=async(url,settings)=>{
  calls.push({url,settings});const source=SOURCES.find(s=>s.url===url);assert.ok(source);
  if(options.fail===source.id)throw Error('network unavailable');
  const body=options.body?.(source)||'<rss version="2.0"><channel>'+item(source,{title:source.id+' Bitcoin market trades steadily',...options.article})+'</channel></rss>';
  return new Response(body,{status:options.status||200,headers:options.headers});
 };
 return {fetcher,calls};
}
test('public collector uses only fixed HTTPS feeds, GET, timeout and no credentials',async()=>{
 const f=fixture(),news=await collectNews({fetcher:f.fetcher,now:NOW});
 assert.equal(f.calls.length,2);assert.equal(news.sources.length,2);assert.equal(news.articles.length,2);
 for(const {url,settings}of f.calls){assert.ok(SOURCES.some(s=>s.url===url));assert.equal(settings.method,'GET');assert.equal(settings.redirect,'error');assert.ok(settings.signal instanceof AbortSignal);assert.equal(settings.headers.Authorization,undefined)}
 assert.equal(assessNews(news,{symbol:'BTCUSDT',now:NOW}).status,'READY');
 assert.throws(()=>news.articles.push({}),TypeError);assert.throws(()=>{news.sources[0].ok=false},TypeError);
});
test('titles are plain text, entities decoded, links constrained, same headlines deduplicated',async()=>{
 const f=fixture({body:source=>'<rss><channel>'+item(source,{title:'<b>Bitcoin</b> &amp; &#69;thereum market update'})+item(source,{title:'Rejected malicious headline',url:'https://evil.example/article'})+item(source,{title:'Rejected scheme in headline',url:'javascript:alert(1)'})+'</channel></rss>'});
 const news=await collectNews({fetcher:f.fetcher,now:NOW});
 assert.equal(news.articles.length,1);assert.equal(news.articles[0].title,'Bitcoin & Ethereum market update');assert.equal(news.sources.filter(s=>s.ok).length,2);
 assert.equal(assessNews(news,{symbol:'BTCUSDT',now:NOW}).ready,true);
});
test('publication times must be explicit, valid, current and never in the future',async()=>{
 const f=fixture({body:source=>'<rss><channel>'+item(source,{time:NOW+1000})+item(source,{time:NOW-86400001})+'<item><title>Undated Bitcoin market news</title><link>'+new URL('/bad',source.url).href+'</link><pubDate>not a date</pubDate></item>'+'</channel></rss>'});
 const news=await collectNews({fetcher:f.fetcher,now:NOW});assert.equal(news.articles.length,0);assert.ok(news.sources.every(s=>!s.ok));
 assert.equal(assessNews(news,{symbol:'BTCUSDT',now:NOW}).blocked,true);
});
test('impossible calendar dates cannot normalize into a fresh publication time',async()=>{
 const now=Date.UTC(2026,2,2,12);
 for(const invalid of ['Mon, 30 Feb 2026 11:50:00 GMT','2026-02-30T11:50:00Z']){
  // Date.parse accepts these as March 2, ten minutes ago. Rejection must come
  // from calendar validation, rather than age or parsing failure.
  assert.equal(Date.parse(invalid),now-600000);
  const f=fixture({body:source=>'<rss><channel>'+item(source,{time:now-600000}).replace(date(now-600000),invalid)+'</channel></rss>'});
  const news=await collectNews({fetcher:f.fetcher,now});assert.ok(news.sources.every(s=>!s.ok));assert.equal(news.articles.length,0);
 }
});
test('oversized, external-entity and malformed feeds fail closed',async()=>{
 for(const body of ['x'.repeat(512*1024+1),'<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///etc/passwd">]><rss><channel></channel></rss>','<html>temporarily unavailable</html>']){
  const f=fixture({body:()=>body}),news=await collectNews({fetcher:f.fetcher,now:NOW});assert.ok(news.sources.every(s=>!s.ok));assert.equal(news.articles.length,0);assert.equal(assessNews(news,{symbol:'BTCUSDT',now:NOW}).ready,false);
 }
 const f=fixture({headers:{'content-length':String(512*1024+1)}}),news=await collectNews({fetcher:f.fetcher,now:NOW});assert.ok(news.sources.every(s=>s.error==='FEED_TOO_LARGE'));
});
test('one unavailable feed is honestly incomplete and does not authorize new entries',async()=>{
 const f=fixture({fail:'coindesk'}),news=await collectNews({fetcher:f.fetcher,now:NOW}),report=assessNews(news,{symbol:'BTCUSDT',now:NOW});
 assert.equal(report.sourceCount,1);assert.equal(report.ready,false);assert.equal(report.blocked,true);assert.equal(report.status,'UNAVAILABLE');assert.equal(news.sources[0].error,'NEWS_UNAVAILABLE');
 const http=fixture({status:503}),bad=await collectNews({fetcher:http.fetcher,now:NOW});assert.ok(bad.sources.every(s=>s.error==='UPSTREAM_HTTP_ERROR'));
});
test('all symbols share cache and simultaneous collections coalesce, with expiry and fetcher isolation',async()=>{
 const f=fixture(),a=collectNews({fetcher:f.fetcher,now:NOW}),b=collectNews({fetcher:f.fetcher,now:NOW});assert.equal(a,b);
 const first=await a;assert.equal(f.calls.length,2);assert.equal(await collectNews({fetcher:f.fetcher,now:NOW+59000}),first);
 const refreshed=await collectNews({fetcher:f.fetcher,now:NOW+60000});assert.notEqual(first,refreshed);assert.equal(f.calls.length,4);
 const separate=fixture();await collectNews({fetcher:separate.fetcher,now:NOW});assert.equal(separate.calls.length,2);
});
test('a stale or future snapshot is unavailable even if its source claims success',async()=>{
 const f=fixture(),news=await collectNews({fetcher:f.fetcher,now:NOW});
 assert.equal(assessNews(news,{symbol:'BTCUSDT',now:NOW+120001}).ready,false);
 assert.equal(assessNews(news,{symbol:'BTCUSDT',now:NOW-1}).ready,false);
 const forged={...news,sources:news.sources.map(s=>({...s,latestPublishedAt:NOW+1}))};assert.equal(assessNews(forged,{symbol:'BTCUSDT',now:NOW}).ready,false);
});
test('recent relevant exploit or solvency report vetoes entries with source and pause expiry',async()=>{
 for(const title of ['Solana protocol exploited after security breach','Bitcoin exchange bankrupt after insolvency','XRP trading halted after delisting announcement']){
  const f=fixture({article:{title}}),news=await collectNews({fetcher:f.fetcher,now:NOW}),symbol=title.startsWith('Solana')?'SOLUSDT':title.startsWith('XRP')?'XRPUSDT':'BTCUSDT';
  const report=assessNews(news,{symbol,now:NOW});assert.equal(report.ready,true);assert.equal(report.blocked,true,title);assert.equal(report.status,'EVENT_RISK');assert.equal(report.events[0].pauseUntil,NOW-600000+EVENT_WINDOW_MS);assert.ok(report.events[0].url.startsWith('https://'));assert.ok(report.events[0].source);
 }
});
test('unrelated asset news does not become a universal veto, while venue and macro events do',async()=>{
 const unrelated=fixture({article:{title:'Solana protocol hacked in exploit'}}),news=await collectNews({fetcher:unrelated.fetcher,now:NOW});
 assert.equal(assessNews(news,{symbol:'BTCUSDT',now:NOW}).blocked,false);assert.equal(assessNews(news,{symbol:'SOLUSDT',now:NOW}).blocked,true);
 for(const title of ['Bybit suspends withdrawals after breach','FOMC rate decision expected today','US CPI inflation release surprises market','SEC files enforcement charges against crypto exchange']){
  const f=fixture({article:{title}}),data=await collectNews({fetcher:f.fetcher,now:NOW});assert.equal(assessNews(data,{symbol:'ADAUSDT',now:NOW}).blocked,true,title);
 }
});
test('ordinary positive headlines never turn into a buy signal and expired events stop vetoing',async()=>{
 const f=fixture({article:{title:'Bitcoin rises as institutional adoption expands'}}),news=await collectNews({fetcher:f.fetcher,now:NOW}),report=assessNews(news,{symbol:'BTCUSDT',now:NOW});
 assert.equal(report.blocked,false);assert.equal(report.events.length,0);assert.equal(Object.hasOwn(report,'side'),false);assert.match(report.limitations,/not sentiment/);
 const old=fixture({article:{title:'Bitcoin protocol exploited yesterday',time:NOW-EVENT_WINDOW_MS-1000}}),prior=await collectNews({fetcher:old.fetcher,now:NOW});assert.equal(assessNews(prior,{symbol:'BTCUSDT',now:NOW}).blocked,false);
});
