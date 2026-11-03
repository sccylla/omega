'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const html=read('index.html'),css=read('static/two-tools.css'),client=read('static/open-trades.js');
test('Open Trades tables are present AND not hidden by two-tools layout rules',()=>{
 const demo=html.slice(html.indexOf('id="view-demo"'),html.indexOf('id="view-real"'));
 const real=html.slice(html.indexOf('id="view-real"'));
 for(const id of ['demo-open-trades','demo-scalper-open-rows','demo-futures-open-rows','demo-open-refresh'])
  assert.ok(demo.includes('id="'+id+'"'),id);
 for(const id of ['real-open-trades','real-open-rows','real-open-refresh','real-open-status'])
  assert.ok(real.includes('id="'+id+'"'),id);
 assert.match(css,/#view-demo> :not\(.home-title\):not\(.demo-summary\):not\(#demo-open-trades\)/);
 assert.match(css,/#view-real> :not\(.home-title\):not\(.real-banner\):not\(.real-balance-grid\):not\(#real-open-trades\)/);
 assert.match(css,/#view-real>#real-open-trades\{/);
 assert.ok(html.includes('src="/static/open-trades.js"'));
});
test('Bybit server returns actual entry/mark/unrealized P&L without placing broker orders',()=>{
 const source=read('lib/live-readonly.js');
 for(const s of ['positionValue:p.positionValue','unrealisedPnl:p.unrealisedPnl',
  'avgPrice:p.avgPrice','markPrice:p.markPrice','fetchedAt:Date.now()'])
  assert.ok(source.includes(s),s);
 assert.match(client,/\/api\/live\?action=bybit/);
 assert.ok(!client.includes('/v5/order/create'));
 assert.ok(!client.includes('/api/auto-live'));
});
test('Demo seconds engine publishes positions and does not leave phantom positions on disconnect',()=>{
 const demo=read('static/demo-seconds-lab.js');
 assert.match(demo,/omega:demo-scalper-state/);
 assert.match(demo,/H\.openList\(wallet\.ledger\)\.length/);
 assert.doesNotMatch(demo,/if\(wallet\.ledger\.open\)/);
 assert.match(client,/omega:paper-updated/);
 assert.match(client,/omega:demo-scalper-state/);
});
function fakeDOM(reply){
 const els=new Map(),listeners=new Map();
 class El {
  constructor(tag='div'){this.tag=tag;this.children=[];this.textContent='';this.className='';this.disabled=false;}
  replaceChildren(...x){this.children=[...x]}
  append(...x){this.children.push(...x)}
  addEventListener(k,fn){listeners.set(k,fn)}
 }
 const doc={hidden:false,body:{dataset:{account:'real'}},
  getElementById(id){if(!els.has(id))els.set(id,new El());return els.get(id)},
  createElement(tag){return new El(tag)},addEventListener(k,fn){listeners.set(k,fn)}};
 const win={addEventListener(k,fn){listeners.set(k,fn)}};
 const context={document:doc,window:win,localStorage:{getItem:()=>null},fetch:async()=>reply,
  AbortController,setTimeout,clearTimeout,setInterval:()=>{},Date,Number,Math,JSON};
 vm.runInNewContext(client,context);
 return {els,doc};
}
test('Open Trades renders actual funded Bybit longs and shorts and the exchange reported P&L',async()=>{
 const {els}=fakeDOM({ok:true,status:200,json:async()=>({
  broker:'BYBIT',openPositions:2,equity:1000,available:400,
  positions:[
   {symbol:'ETHUSDT',side:'Buy',size:'0.1',positionValue:'240',avgPrice:'2300',markPrice:'2400',
    unrealisedPnl:'10.2',takeProfit:'2500',stopLoss:'2250'},
   {symbol:'XRPUSDT',side:'Sell',size:'100',positionValue:'50',avgPrice:'0.50',markPrice:'0.55',
    unrealisedPnl:'-5',takeProfit:'0.45',stopLoss:''}
  ],fetchedAt:Date.now()
 })});
 await new Promise(resolve=>setImmediate(resolve));
 const table=els.get('real-open-rows').children;
 assert.equal(table.length,2);
 assert.equal(table[0].children[0].textContent,'ETHUSDT');
 assert.equal(table[0].children[1].textContent,'LONG');
 assert.match(table[0].children[5].textContent,/\$10.20/);
 assert.equal(table[1].children[1].textContent,'SHORT');
 assert.match(table[1].children[5].textContent,/−\$5.00/);
 assert.match(table[1].children[6].textContent,/NO STOP/);
 assert.equal(els.get('real-open-count').textContent,'2 / 10');
 assert.match(els.get('real-open-status').textContent,/BYBIT VERIFIED/);
});
test('A signed-out or failed Bybit read NEVER claims zero opened trades',async()=>{
 const {els}=fakeDOM({ok:false,status:401,json:async()=>({error:'Unauthorized'})});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(els.get('real-open-count').textContent,'— / 10');
 assert.match(els.get('real-open-status').textContent,/BYBIT NOT VERIFIED/);
 assert.match(els.get('real-open-rows').children[0].children[0].textContent,/Unable to verify/);
});
