'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(base,'index.html'),'utf8'),src=fs.readFileSync(path.join(base,'static/live-auto.js'),'utf8');
test('Real has the same scan, select, automatic entry and pause workflow as Demo',()=>{
 for(const id of ['live-auto-toggle','live-auto-scan-only','live-auto-confirm','live-auto-progress','live-auto-shortlist','live-auto-universe','live-auto-choice'])assert.ok(html.includes('id="'+id+'"'),id);
 for(const code of ['M.scanMarkets',"mode:'live'","action:'arm'","action:'enter'","'omega-real-autopilot'"])assert.ok(src.includes(code),code);
});
test('Automatic live entry never arms on reload, when tab is hidden, or in demo mode',()=>{
 assert.ok(src.includes('let running=false'));
 assert.ok(src.includes('if(document.hidden&&running)pause('));
 assert.ok(src.includes("window.addEventListener('beforeunload'"));
 assert.ok(src.includes("document.body.dataset.account!=='real'"));
 assert.ok(!src.includes('localStorage.setItem'));
});
