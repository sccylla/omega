'use strict';
(()=>{
 const $=id=>document.getElementById(id),status=$('market-news-status'),list=$('market-news-headlines'),input=$('market-news-symbol');
 if(!status||!list||!input||!window.OmegaNewsContext)return;
 const news=window.OmegaNewsContext.create({onUpdate:render});
 let symbol='BTCUSDT',latestSnapshot=null;
 function render(snapshot=latestSnapshot){
  latestSnapshot=snapshot;
  const context=news.assessment(symbol);
  status.textContent=context.reason+(snapshot?.observedAt?' · Fetched '+new Date(snapshot.observedAt).toLocaleTimeString():'');
  $('market-news-sources').textContent=snapshot?.sources?.map(s=>s.name+': '+(s.ok?'received':'unavailable')).join(' · ')||'News sources unavailable';
  list.replaceChildren();
  const headlines=[...(context.events||[]),...(context.headlines||[])],seen=new Set();
  for(const article of headlines){
   if(seen.has(article.url)||seen.size>=6)continue;
   let url;try{url=new URL(article.url);if(url.protocol!=='https:'||!['www.coindesk.com','coindesk.com','cointelegraph.com','www.cointelegraph.com'].includes(url.hostname))continue}catch{continue}
   seen.add(article.url);
   const row=document.createElement('li'),link=document.createElement('a'),time=document.createElement('span');
   link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=article.title;
   time.textContent=' · '+article.source+' · '+new Date(article.publishedAt).toLocaleString();
   row.append(link,time);list.append(row);
  }
 }
 async function refresh(){
  const value=input.value.trim().toUpperCase(),normalized=value.endsWith('USDT')?value:value+'USDT';
  if(!/^[A-Z0-9]{2,24}USDT$/.test(normalized)){status.textContent='Enter a supported USDT market such as BTC or ETH.';return}
  symbol=normalized;await news.refresh([symbol]);render();
 }
 $('market-news-refresh').addEventListener('click',refresh);
 refresh();setInterval(()=>{if(!document.hidden)refresh()},60000);
})();
