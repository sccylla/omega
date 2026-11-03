'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const {historyWindow,normalizeBybitClosedRow,bybitHistory,LiveError}=require('../lib/live-readonly');
const Demo=require('../static/demo-seconds-account');
const NOW=Date.UTC(2026,10,3,8,30,0),WEEK=7*86400000;
function bybitRecord(attrs={}){
 return {symbol:'ETHUSDT',side:'Sell',orderId:'bybit-1',closedPnl:'7.52',
  closedSize:'0.1',cumEntryValue:'240',avgEntryPrice:'2400',avgExitPrice:'2475.2',
  updatedTime:String(NOW-10000),createdTime:String(NOW-11000),
  openFee:'0.04',closeFee:'0.05',...attrs};
}
test('Bybit history normalizes exit-side Sell as a LONG trade and Buy as SHORT',()=>{
 const long=normalizeBybitClosedRow(bybitRecord());
 assert.equal(long.side,'LONG');assert.equal(long.net,7.52);assert.equal(long.entry,2400);
 assert.equal(long.exit,2475.2);assert.equal(long.notional,240);assert.equal(long.fees,.09);
 assert.equal(long.openedAt,null);
 assert.equal(normalizeBybitClosedRow(bybitRecord({side:'Buy'})).side,'SHORT');
 assert.equal(normalizeBybitClosedRow(bybitRecord({symbol:'ETHUSD'})),null);
 assert.equal(normalizeBybitClosedRow(bybitRecord({closedPnl:'NaN'})),null);
});
test('Bybit time windows are seven days each, bounded, and historical response is never advertised as all-time',async()=>{
 assert.equal(historyWindow(0,NOW).end,NOW);
 assert.equal(historyWindow(0,NOW).end-historyWindow(0,NOW).start,WEEK-1);
 assert.equal(historyWindow(2,NOW).end,NOW-WEEK*2);
 assert.throws(()=>historyWindow(26,NOW),LiveError);
 assert.throws(()=>historyWindow(-1,NOW),LiveError);
 let captured;
 const fetchClosed=async(route,query)=>{
  captured={route,query};
  return {list:[bybitRecord()],nextPageCursor:'page2%3A123'};
 };
 const response=await bybitHistory({weeksAgo:0,now:NOW,fetchClosed});
 assert.equal(captured.route,'/v5/position/closed-pnl');
 assert.equal(captured.query.startTime,String(NOW-WEEK+1));
 assert.equal(captured.query.limit,'100');
 assert.equal(response.rows.length,1);assert.equal(response.hasMore,true);
 assert.equal(response.anchor,NOW);assert.match(response.note,/not all-time/);
 const second=await bybitHistory({weeksAgo:0,now:NOW+1000,anchor:String(NOW),
  cursor:response.nextCursor,fetchClosed});
 assert.equal(second.windowEnd,NOW);
 assert.equal(captured.query.cursor,'page2%3A123');
 await assert.rejects(bybitHistory({weeksAgo:0,cursor:'page2',now:NOW,fetchClosed}),/History page expired/);
});
test('Bybit malformed pages fail closed, and invalid rows are never counted as trade outcomes',async()=>{
 const r=await bybitHistory({now:NOW,fetchClosed:async()=>({
  list:[bybitRecord(),bybitRecord({closedPnl:'garbage'}),bybitRecord({side:'Hold'})],
  nextPageCursor:''})});
 assert.equal(r.rows.length,1);assert.equal(r.rejectedRows,2);assert.equal(r.hasMore,false);
 await assert.rejects(bybitHistory({now:NOW,fetchClosed:async()=>({list:null})}),/Incomplete/);
 await assert.rejects(bybitHistory({now:NOW,fetchClosed:async()=>({list:[],nextPageCursor:35})}),/pagination/);
});
test('Demo and Real Trade History panels remain visible under the simplified two-bot CSS and real route is authenticated',()=>{
 const html=read('index.html'),css=read('static/two-tools.css'),api=read('api/live.js');
 const demo=html.slice(html.indexOf('id="view-demo"'),html.indexOf('id="view-real"'));
 const real=html.slice(html.indexOf('id="view-real"'));
 for(const id of ['demo-trade-history','demo-history-bot','demo-history-period','demo-history-result',
  'demo-history-search','demo-history-rows','demo-history-export','demo-history-refresh'])
  assert.ok(demo.includes('id="'+id+'"'),id);
 for(const id of ['real-trade-history','real-history-week','real-history-result',
  'real-history-search','real-history-rows','real-history-next','real-history-export'])
  assert.ok(real.includes('id="'+id+'"'),id);
 assert.match(css,/:not\(#demo-trade-history\)/);
 assert.match(css,/:not\(#real-trade-history\)/);
 assert.match(html,/static\/trade-history\.js/);
 assert.match(html,/static\/trade-history\.css/);
 assert.ok(api.indexOf("if(!auth.isAuthed(req))")<api.indexOf("action==='history'"));
 assert.match(api,/live\.bybitHistory/);
});
class FakeElement {
 constructor(tag='div'){this.tag=tag;this.textContent='';this.children=[];this.className='';this.value='all';this.hidden=false;this.disabled=false;this.handlers={};}
 addEventListener(event,fn){this.handlers[event]=fn}
 append(...elements){this.children.push(...elements)}
 replaceChildren(...elements){this.children=[...elements]}
 click(){this.handlers.click?.()}
 remove(){}
}
async function runUI(mode='demo',bybitPayload=null){
 const ids=new Map(),handlers={},now=Date.now();
 const el=id=>{if(!ids.has(id))ids.set(id,new FakeElement());return ids.get(id)};
 const wallet=Demo.smallInitial(now);
 wallet.ledger.closed=[
  {symbol:'BTCUSDT',side:'BUY',openedAt:now-7000,closedAt:now-1000,
   notional:100,entry:100,exit:101,net:.7,fees:.12,slippage:.08,reason:'Modeled net take-profit'},
  {symbol:'ETHUSDT',side:'SELL',openedAt:now-8000,closedAt:now-3000,
   notional:100,entry:100,exit:101,net:-.9,reason:'Virtual stop'}
 ];
 const futures={closed:[{id:'f1',symbol:'SOL',side:'SELL',openedAt:now-16000,
  closedAt:now-2000,notional:100,entry:100,exit:99,net:.86,reason:'Demo Futures target'}]};
 el('demo-history-bot').value='all';el('demo-history-period').value='all';
 el('demo-history-result').value='all';el('demo-history-search').value='';
 el('real-history-result').value='all';el('real-history-search').value='';
 el('real-history-week').value='0';
 const doc={hidden:false,getElementById:el,createElement:t=>new FakeElement(t),
  body:{dataset:{account:mode},append:()=>{}},
  addEventListener:(name,fn)=>{handlers['document:'+name]=fn}};
 const win={OmegaAccount:{ready:Promise.resolve(),read:()=>futures,status:()=>({mode:'local'})},
  OmegaDemoSeconds:Demo,addEventListener:(event,fn)=>{handlers[event]=fn}};
 const ctx={document:doc,window:win,Date,Number,Math,JSON,Blob,URLSearchParams,
  localStorage:{getItem:k=>k==='omega_demo_seconds_wallet_88_v1'?JSON.stringify(wallet):null},
  fetch:async()=>({ok:!!bybitPayload,status:bybitPayload?200:401,
   json:async()=>bybitPayload||{error:'Login required'}}),
  AbortController,setTimeout,clearTimeout,console};
 vm.runInNewContext(read('static/trade-history.js'),ctx);
 await new Promise(resolve=>setImmediate(resolve));
 return {el,handlers};
}
test('Demo history combines recorded Scalper and Futures closes, filters wins, and calculates observed P&L',async()=>{
 const {el}=await runUI();
 assert.equal(el('demo-history-bot').value,'Futures Trader');
 assert.equal(el('demo-history-title').textContent,'Futures Trade History');
 assert.equal(el('demo-history-rows').children.length,1);
 assert.equal(el('demo-history-count').textContent,'1');
 assert.equal(el('demo-history-win').textContent,'100.0%');
 assert.equal(el('demo-history-net').textContent,'$0.86');
 assert.equal(el('demo-futures-closed-count').textContent,'1');
 assert.equal(el('demo-futures-closed-pnl').textContent,'$0.86');
 el('demo-history-bot').value='all';
 el('demo-history-bot').handlers.change();
 assert.equal(el('demo-history-rows').children.length,3);
 assert.equal(el('demo-history-net').textContent,'$0.66');
 el('demo-history-bot').value='Scalper';
 el('demo-history-bot').handlers.change();
 assert.equal(el('demo-history-count').textContent,'2');
 assert.equal(el('demo-history-title').textContent,'Scalper Trade History');
 el('demo-history-result').value='loss';el('demo-history-result').handlers.change();
 assert.equal(el('demo-history-count').textContent,'1');
 assert.equal(el('demo-history-net').textContent,'−$0.90');
 el('demo-history-search').value='BTC';el('demo-history-search').handlers.input();
 assert.equal(el('demo-history-count').textContent,'0');
});
test('Real history lists verified Bybit closed PnL, correctly named directions and explicit non-attribution',async()=>{
 const now=Date.now(),payload={broker:'BYBIT',source:'BYBIT_CLOSED_PNL',anchor:now,weeksAgo:0,
  windowStart:now-WEEK+1,windowEnd:now,rejectedRows:0,nextCursor:'',rows:[
   {...normalizeBybitClosedRow(bybitRecord({updatedTime:String(now-500)})),closedAt:now-500}
  ]};
 const {el}=await runUI('real',payload);
 assert.equal(el('real-history-count').textContent,'1');
 assert.equal(el('real-history-rows').children.length,1);
 const cells=el('real-history-rows').children[0].children;
 assert.equal(cells[1].textContent,'Bybit');
 assert.equal(cells[3].textContent,'LONG');
 assert.equal(cells[7].textContent,'$7.52');
 assert.match(el('real-history-status').textContent,/BYBIT VERIFIED/);
 assert.equal(el('real-futures-closed-count').textContent,'1');
 assert.equal(el('real-futures-closed-pnl').textContent,'$7.52');
});
test('Failed Bybit authentication never presents guessed zero wins or fabricated history rows',async()=>{
 const {el}=await runUI('real',null);
 assert.equal(el('real-history-count').textContent,'—');
 assert.equal(el('real-futures-closed-count').textContent,'—');
 assert.equal(el('real-history-net').textContent,'—');
 assert.match(el('real-history-status').textContent,/NOT VERIFIED/);
 assert.match(el('real-history-rows').children[0].children[0].textContent,/Sign in/);
});

test('Futures Trader cards expose direct non-trading history actions that reset the Demo filter',async()=>{
 const html=read('index.html'),js=read('static/trade-history.js');
 for(const id of ['demo-futures-history-open','real-futures-history-open',
  'demo-futures-closed-count','real-futures-closed-count']){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(html,/id="demo-history-title">Futures Trade History/);
 assert.match(html,/id="real-history-title">Futures Trade History/);
 assert.match(html,/value="Futures Trader" selected/);
 assert.match(js,/omega:paper-updated/);
 assert.match(js,/demo\.rows\.filter\(r=>r\.source==='Futures Trader'\)/);
 assert.match(js,/scrollIntoView/);
 const {el}=await runUI('demo');
 el('demo-history-bot').value='Scalper';el('demo-history-bot').handlers.change();
 assert.equal(el('demo-history-count').textContent,'2');
 el('demo-futures-history-open').handlers.click();
 assert.equal(el('demo-history-bot').value,'Futures Trader');
 assert.equal(el('demo-history-count').textContent,'1');
});
