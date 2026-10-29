'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const scan=require('../lib/opportunity-scanner');const api=require('../api/scanner');const live=require('../lib/live-readonly');const liveApi=require('../api/live');const fx=require('../lib/forex-practice');
function ticker(overrides={}){return {symbol:'BTCUSDT',lastPrice:'90000',bid1Price:'89995',ask1Price:'90005',turnover24h:'155000000',price24hPcnt:'.087',fundingRate:'.0001',...overrides};}
test('Buy and sell screening are symmetric and never a win-probability',()=>{
 const buy=scan.futuresScreen(ticker()),sell=scan.futuresScreen(ticker({price24hPcnt:'-.087'}));
 assert.ok(buy.buyScore>buy.sellScore);assert.ok(sell.sellScore>sell.buyScore);assert.equal(buy.screenType,'24H_SNAPSHOT_ONLY');assert.ok(!('winProbability' in buy));
});
test('Illiquid and wide-spread markets never become buy or sell watchlist',()=>{
 const weak=scan.futuresScreen(ticker({turnover24h:'1500',bid1Price:'70000',ask1Price:'90005'}));assert.equal(weak.status,'WAIT');assert.ok(weak.reason.includes('Low'));
});
test('Invalid or missing Bybit ticker data is rejected, no invented signals',()=>{
 for(const t of [ticker({symbol:'BAD/USDT'}),ticker({ask1Price:'0'}),ticker({lastPrice:'Infinity'}),ticker({turnover24h:'0'})])assert.equal(scan.futuresScreen(t),null);
});
test('Forex closed markets never emit a current buy/sell watchlist',()=>{
 const end=Date.parse('2026-10-09T20:00:00Z');let price=1.1;let rows=[];for(let i=0;i<100;i++){const tm=end-(99-i)*300000;price+=.0002;rows.push([tm,price-.0001,price+.0004,price-.0004,price,40]);}
 const r=scan.forexScreen('EUR_USD',rows,Date.parse('2026-10-10T11:00:00Z'));assert.equal(r.status,'MARKET CLOSED');assert.ok(r.buyScore>=0&&r.sellScore>=0);
});
test('Forex catalog broadens to 40+ pairs but demo execution remains 3 pair allowlist',()=>{
 assert.ok(fx.INSTRUMENTS.size>=40);assert.ok(fx.INSTRUMENTS.has('EUR_JPY'));assert.ok(!fx.SAFE_ORDERS.has('EUR_JPY'));
 assert.throws(()=>fx.previewMath({pair:'EUR_JPY',side:'BUY',riskPct:.1,stopPips:15},{positions:[],pending:0,ask:1.2,bid:1.19,equity:10000,available:3000,marginRate:.04}),/Invalid pair/);
});
test('Forex scanner without practice account returns no invented data',async()=>{
 let oldToken=process.env.OANDA_PRACTICE_TOKEN,oldId=process.env.OANDA_PRACTICE_ACCOUNT_ID;
 delete process.env.OANDA_PRACTICE_TOKEN;delete process.env.OANDA_PRACTICE_ACCOUNT_ID;
 try{const x=await api._forex();assert.equal(x.requiresConnection,true);assert.equal(x.rows.length,0)}finally{if(oldToken===undefined)delete process.env.OANDA_PRACTICE_TOKEN;else process.env.OANDA_PRACTICE_TOKEN=oldToken;if(oldId===undefined)delete process.env.OANDA_PRACTICE_ACCOUNT_ID;else process.env.OANDA_PRACTICE_ACCOUNT_ID=oldId;}
});
test('Live endpoint exposes no broker credentials and disallows live orders',async()=>{
 const result={code:null,body:null};const res={setHeader(){},status(n){result.code=n;return this},json(v){result.body=v;return this}};
 await liveApi({method:'POST',query:{action:'order'},headers:{}},res);assert.equal(result.code,405);assert.match(result.body.error,/read-only/);
 await liveApi({method:'GET',query:{action:'status'},headers:{}},res);assert.equal(result.code,200);assert.equal(result.body.liveOrdersEnabled,false);assert.equal(result.body.automatedOrdersEnabled,false);
 await liveApi({method:'GET',query:{action:'bybit'},headers:{}},res);assert.equal(result.code,401);
 assert.equal(live.bybitBase,'https://api.bybit.com');assert.equal(live.oandaBase,'https://api-fxtrade.oanda.com');
});
test('Public scanner rejects malformed methods and pagination',async()=>{
 const data={code:0,body:null};const res={setHeader(){},status(n){data.code=n;return this},json(v){data.body=v;return this}};
 await api({method:'POST',query:{}},res);assert.equal(data.code,405);
 await api({method:'GET',query:{market:'forex',page:'9000'}},res);assert.equal(data.code,400);
 await api({method:'GET',query:{market:'x'}},res);assert.equal(data.code,400);
});
