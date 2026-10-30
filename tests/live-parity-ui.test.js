'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'static/live-parity.js'),'utf8');
test('real mode exposes explicit readiness checks and analysis-only candidate action',()=>{
 for(const id of ['live-check-readiness','live-readiness-grid','live-readiness-summary','live-preview','live-candidate-rows','real-activate-form','real-pause'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/live-parity\.js/);
 assert.match(html,/live-parity\.css/);
 assert.match(html,/no orders/i);
});
test('live preview can only issue public read-only requests and does not auto activate funded trading',()=>{
 assert.ok(script.includes('mode:\'live\''));
 assert.ok(script.includes('/api/decision?'));
 assert.ok(script.includes('/api/scanner?'));
 assert.ok(script.includes('/api/live?action=status'));
 assert.ok(script.includes('/api/bot'));
 assert.ok(!script.includes("method:'POST'")&&!script.includes('method:"POST"'));
 assert.ok(!script.includes("action:'start'")&&!script.includes('START REAL $10 BOT'));
});
test('production worker remains explicitly gated and exchange protective orders remain in code',()=>{
 const bot=fs.readFileSync(path.join(root,'lib/trading-worker.js'),'utf8');
 const broker=fs.readFileSync(path.join(root,'lib/live-broker.js'),'utf8');
 assert.ok(bot.includes("this.env.OMEGA_LIVE_ORDERS_ENABLED==='true'"));
 assert.ok(bot.includes("body.confirm!=='START REAL $10 BOT'"));
 assert.ok(broker.includes("stopLoss:ticket.stopLoss"));
 assert.ok(broker.includes("takeProfit:ticket.takeProfit"));
});
