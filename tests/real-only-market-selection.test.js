'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const page=read('index.html'),scout=read('static/seconds-lab.js'),focus=read('static/focus-v8.js');
const demoStart=page.indexOf('id="view-demo"'),realStart=page.indexOf('id="view-real"');
test('automatic market selection, live scalper and evidence inspector appear only in Real Account',()=>{
 assert.ok(demoStart>=0&&realStart>demoStart);
 const demo=page.slice(demoStart,realStart),real=page.slice(realStart);
 assert.ok(!demo.includes('AUTOMATIC MARKET SELECTION'));
 assert.ok(!demo.includes('id="demo-auto-panel"'));
 assert.ok(!demo.includes('id="demo-seconds-lab"'));
 assert.ok(!demo.includes('id="auto-toggle"'));
 assert.ok(!demo.includes('id="demo-seconds-start"'));
 assert.ok(demo.includes('id="demo-manual-panel"'));
 assert.ok(!demo.includes('id="demo-manual-panel" hidden'));
 assert.ok(real.includes('AUTOMATIC MARKET SELECTION'));
 assert.ok(real.includes('Evidence-driven autopilot'));
 assert.ok(real.includes('id="live-auto-toggle"'));
 assert.ok(real.includes('id="seconds-lab"'));
 assert.ok(real.includes('id="seconds-check"'));
 assert.ok(real.includes('id="decision-analyze"'));
 assert.ok(real.includes('Four-hour trend and positive historical holdout evidence are mandatory'));
 assert.ok(real.includes('FORWARD-TEST STATUS:'));
});
test('production loads real account scout but never loads legacy virtual scalp execution',()=>{
 for(const script of ['auto-v7.js','demo-seconds-lab.js','demo-seconds-account.js',
  'demo-seconds-signals.js','demo-seconds-guard.js','seconds-shadow.js'])
  assert.ok(!page.includes('src="/static/'+script+'"'),script);
 assert.ok(page.includes('src="/static/live-auto.js"'));
 assert.ok(page.includes('src="/static/seconds-lab.js"'));
 assert.ok(page.includes('src="/static/decision-panel.js"'));
 assert.ok(page.includes('src="/static/home-v6.js"'));
 assert.ok(focus.includes("manual.hidden=false"));
});
test('real scalp market selection uses $15, observes twenty pairs, and cannot execute orders',()=>{
 assert.match(scout,/const NOTIONAL=15,GOAL_NET=\.05,MAX_PAIRS=20/);
 assert.match(scout,/E\.validSymbols\(\$\('seconds-pairs'\)\.value,\{maxSymbols:MAX_PAIRS\}\)/);
 assert.match(scout,/mode:'live_small',fresh:true/);
 assert.match(scout,/topics\.slice\(i,i\+10\)/);
 assert.match(scout,/document\.body\.dataset\.account!=='real'/);
 assert.match(scout,/Strict live evidence also qualifies/);
 for(const forbidden of ['/api/auto-live', '/v5/order/create', "action:'enter'", 'BYBIT_LIVE_API_KEY',
  'OmegaSecondsShadow','S.step('])
  assert.ok(!scout.includes(forbidden),forbidden);
});
test('real autopilot retains individual $15 start authorization and separately rechecks strict live evidence',()=>{
 const browser=read('static/live-auto.js'),server=read('api/auto-live.js'),policy=read('lib/advanced-decision.js');
 assert.match(browser,/START REAL \$15 AUTOPILOT/);
 assert.match(browser,/mode:'live_small'/);
 assert.match(server,/mode:'live_small'/);
 assert.match(server,/await analyze\(symbol\)/);
 assert.match(server,/guardAccount\(recent\)/);
 assert.match(server,/await broker\.enter\(ticket,link\)/);
 assert.match(policy,/required:!demo/); // historical evidence is mandatory for live_small
 assert.match(policy,/smallLive\?15:MIN_LIVE_ORDER_USD/);
 assert.ok(!page.includes('DEMO FORWARD TEST'));
});
