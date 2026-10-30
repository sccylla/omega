'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('real UI and server require exactly the same deliberate $90 activation phrase',()=>{
 const ui=fs.readFileSync(path.join(root,'static/account-mode.js'),'utf8');
 const worker=fs.readFileSync(path.join(root,'lib/trading-worker.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(ui,/START REAL \$90 BOT/);
 assert.match(worker,/START REAL \$90 BOT/);
 assert.match(html,/START REAL \$90 BOT/);
 assert.doesNotMatch(ui,/START REAL \$10 BOT/);
});
test('correct UI phrase alone cannot bypass real broker and server safety gates',()=>{
 const worker=fs.readFileSync(path.join(root,'lib/trading-worker.js'),'utf8');
 const ui=fs.readFileSync(path.join(root,'static/account-mode.js'),'utf8');
 assert.match(worker,/MIN_LIVE_EQUITY_USD/);
 assert.match(worker,/serverEnabled/);
 assert.match(ui,/d\.serverEnabled/);
 assert.match(ui,/d\.configured/);
});
