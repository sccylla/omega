'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Paper=require('../static/paper-engine'),Feedback=require('../static/futures-feedback');
const NOW=Date.UTC(2026,10,4,12),MINUTE=60000;
const source=fs.readFileSync(path.join(__dirname,'../static/auto-v7.js'),'utf8');
function loss(id,minutesAgo){
 return {id,symbol:'BTC',side:'BUY',auto:true,entryEvidence:{strategy:'evidence-v11'},
  net:-1,netRaw:-1,openedAt:NOW-(minutesAgo+5)*MINUTE,closedAt:NOW-minutesAgo*MINUTE};
}
const losses=()=>[loss('old-loss',15),loss('new-loss',5)];
function plan(extra={}){
 return {symbol:'BTCUSDT',eligible:true,decision:'BUY',side:'BUY',reason:'Current setup qualifies',
  executionPolicy:'DEMO_FORWARD_TEST',observedAt:NOW,expiresAt:NOW+10000,
  barTime:Math.floor(NOW/300000)*300000-300000,executionPrice:100,stopPct:1,atr:1,
  targetNet:5,slippageBps:0,checks:[{label:'Current evidence',pass:true}],
  validation:{passed:false,tradeCount:4},metrics:{benchmarkCorrelation:.5,adx:27,atrPct:1},
  quality:{score:80},structure:{setup:'PULLBACK'},movement:{regime:'TREND'},
  economics:{netRewardRisk:3,estimatedStopNetUsd:1.12},...extra};
}
function harness({initial,onFresh,onTransact,decision=plan(),feedback=Feedback,quoteBid=100}={}){
 let account=initial||Paper.initial(),opened=0,applied=0,transactions=0,analyzed=0;
 const nodes=new Map(),intervals=[],rendered=[],scanResults=[];
 function node(id){
  if(nodes.has(id))return nodes.get(id);
  const listeners=new Map(),value={textContent:'',className:'',hidden:false,classList:{toggle(){}},children:[],
   addEventListener(event,handler){listeners.set(event,handler)},
   replaceChildren(...children){this.children=children},append(...children){this.children.push(...children)},
   fire(event){return listeners.get(event)?.({type:event})}};
  nodes.set(id,value);return value;
 }
 const A={KEY:'test-futures',ready:Promise.resolve(),status:()=>({writable:true}),read:()=>account,
  async transact(change){transactions++;if(onTransact)account=onTransact(account,transactions)||account;const next=change(account);account=next;return next}};
 const E={...Paper,
  open(...args){opened++;return Paper.open(...args)},
  applyQuote(...args){applied++;return Paper.applyQuote(...args)}};
 const M={within:(work)=>work(new AbortController().signal),rank:(a,b)=>(b.rank||0)-(a.rank||0),explain:()=>scanResults.at(-1)?.reason||'No qualifying setup',
  async scanMarkets(rows,options){
   const result=await options.analyze(rows[0].symbol,{});scanResults.push(result);
   const picks=result.eligible&&options.canEnter(result)?[result]:[];
   return {results:[result],picks,coverage:{complete:true,screened:1,analyzed:1,incomplete:0},summary:{},nextAfter:null};
  }};
 const window={OmegaPaper:E,OmegaSignals:{},OmegaTrader:{performance:rows=>({count:rows.length,winRate:null,expectancy:null,net:rows.reduce((n,r)=>n+r.net,0)})},
  OmegaAccount:A,OmegaSelection:M,OmegaFuturesFeedback:feedback,OmegaPortfolio:{concentrated:()=>false},
  OmegaDecision:{
   async analyze(symbol,options){analyzed++;if(options.fresh&&onFresh)account=onFresh(account)||account;return {...decision,symbol}},
   render(value){rendered.push(value)},quote:async()=>({bid:quoteBid,ask:quoteBid+.01,observedAt:NOW})},
  addEventListener(){}};
 const document={hidden:false,body:{dataset:{account:'demo'}},getElementById:node,
  querySelector:()=>node('demo-tab'),createElement:()=>node(Symbol()),addEventListener(){}};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[NOW]))}static now(){return NOW}}
 vm.runInNewContext(source,{window,document,Date:Clock,AbortController,DOMException,URLSearchParams,
  fetch:async()=>({ok:true,json:async()=>({universe:1,rows:[{symbol:'BTCUSDT'}]})}),
  setTimeout:()=>1,clearTimeout(){},setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length},queueMicrotask},
 {filename:'static/auto-v7.js'});
 return {node,rendered,scanResults,
  async start(){node('auto-toggle').fire('click');for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));
   assert.ok(['TRADE OPEN','WAITING FOR SETUP','ENTRY BLOCKED','MANAGING'].includes(node('auto-state').textContent),'The asynchronous controller cycle must reach a terminal state');},
  account:()=>account,counts:()=>({opened,applied,transactions,analyzed})};
}
test('a qualifying Futures plan opens with its authoritative $5 net target in ledger and status',async()=>{
 const app=harness();await app.start();
 assert.equal(app.counts().opened,1);assert.equal(app.account().positions.length,1);
 const position=app.account().positions[0];
 assert.equal(position.targetNet,5);assert.equal(position.entryEvidence.targetNet,5);
 assert.equal(position.entryEvidence.decisionVersion,'FUTURES_V12');
 assert.match(app.node('auto-message').textContent,/Net profit target \$5\.00/);
 assert.equal(app.node('auto-state').textContent,'TRADE OPEN');
});
test('repeated-loss feedback rejects the candidate during scan, before any opening call',async()=>{
 const app=harness({initial:{...Paper.initial(),closed:losses()}});await app.start();
 assert.equal(app.counts().opened,0);assert.equal(app.account().positions.length,0);
 assert.equal(app.scanResults[0].eligible,false);assert.equal(app.scanResults[0].feedback.allowed,false);
 assert.ok(app.scanResults[0].checks.some(c=>c.label.includes('repeated-loss pause')&&!c.pass));
 assert.match(app.node('auto-message').textContent,/Repeated losing/);
});
test('losses spread across different pairs trigger the account pause while an existing stop still executes',async()=>{
 let initial=Paper.open(Paper.initial(),{ETH:100},{symbol:'ETH',side:'BUY',auto:true,notional:100,
  stopPct:1,targetNet:5,entryEvidence:{strategy:'evidence-v11'}},NOW-10*MINUTE);
 initial={...initial,closed:[loss('first',15),{...loss('second',10),symbol:'SOL'},{...loss('third',5),symbol:'XRP'}]};
 const app=harness({initial,quoteBid:98});await app.start();
 assert.equal(app.counts().applied,1);assert.equal(app.counts().opened,0);
 assert.equal(app.account().positions.length,0);assert.equal(app.account().closed[0].symbol,'ETH');
 assert.ok(app.account().closed[0].netRaw<0);
 assert.ok(app.scanResults[0].feedback.accountPauseUntil>NOW);
 assert.match(app.node('auto-message').textContent,/account-wide/);
});
test('entry feedback never blocks management: an existing protected Futures position still closes',async()=>{
 let initial=Paper.open(Paper.initial(),{ETH:100},{symbol:'ETH',side:'BUY',auto:true,notional:100,
  stopPct:1,targetNet:5,entryEvidence:{strategy:'evidence-v11'}},NOW-10*MINUTE);
 initial={...initial,closed:losses()};
 const app=harness({initial,quoteBid:106});await app.start();
 assert.equal(app.counts().applied,1);assert.equal(app.counts().opened,0);
 assert.equal(app.account().positions.length,0);assert.equal(app.account().closed.length,3);
 assert.equal(app.account().closed[0].symbol,'ETH');assert.ok(app.account().closed[0].netRaw>=5);
 assert.match(app.account().closed[0].reason,/Net profit target/);
 assert.equal(app.scanResults[0].feedback.allowed,false);
});
test('newly synced losses arriving during fresh evidence reject an otherwise qualified plan',async()=>{
 const app=harness({onFresh:account=>({...account,closed:losses()})});await app.start();
 assert.equal(app.scanResults[0].eligible,true);assert.equal(app.counts().analyzed,2);
 assert.equal(app.counts().opened,0);assert.equal(app.account().positions.length,0);
 assert.match(app.node('auto-message').textContent,/No ranked pair still qualifies/);
});
test('losses arriving while acquiring the account transaction lock are rechecked before E.open',async()=>{
 const app=harness({onTransact:account=>({...account,closed:losses()})});await app.start();
 assert.equal(app.scanResults[0].eligible,true);assert.equal(app.counts().analyzed,2);
 assert.equal(app.counts().transactions,1);assert.equal(app.counts().opened,0);
 assert.equal(app.account().positions.length,0);assert.equal(app.node('auto-state').textContent,'ENTRY BLOCKED');
 assert.match(app.node('auto-message').textContent,/Repeated losing/);
});
test('realized losses arriving at the entry transaction cannot spend an exhausted daily risk reserve',async()=>{
 const app=harness({onTransact:account=>({...account,cash:1470.55,day:'2026-11-04',dayStartEquity:1500})});await app.start();
 assert.equal(app.scanResults[0].eligible,true);
 assert.equal(app.account().positions.length,0);assert.equal(app.account().cash,1470.55);
 assert.equal(app.node('auto-state').textContent,'ENTRY BLOCKED');
 assert.match(app.node('auto-message').textContent,/Remaining daily Demo loss allowance/);
});
test('an obsolete sub-$5 target fails instead of silently clamping or rewriting the decision',async()=>{
 const app=harness({decision:plan({targetNet:1})});await app.start();
 assert.equal(app.counts().opened,0);assert.equal(app.account().positions.length,0);
 assert.match(app.node('auto-message').textContent,/target does not match/);
});
test('missing feedback module cannot silently authorize a Futures entry',async()=>{
 const app=harness({feedback:null});await app.start();
 assert.equal(app.counts().opened,0);assert.equal(app.scanResults[0].eligible,false);
 assert.match(app.node('auto-message').textContent,/feedback unavailable/);
});
