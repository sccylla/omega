'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),src=fs.readFileSync(path.join(root,'static/live-parity.js'),'utf8');
test('manual live workflow displays real confirmation and exchange-managed exits',()=>{
 for(const id of ['live-preview','live-manual-ticket','live-order-confirm','live-ticket-summary','live-execute','live-prepare-specific'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('PLACE REAL $90 TRADE'));
 assert.ok(html.includes('No Telegram bot required'));
 assert.ok(html.includes('class="real-workspace" hidden'));
});
test('manual UI cannot execute without explicit confirmation and signed preview',()=>{
 assert.ok(src.includes("entryConfirm.value!=='PLACE REAL $90 TRADE'"));
 assert.ok(src.includes('previewToken'));
 assert.ok(src.includes("post:{action:'preview'"));
 assert.ok(src.includes("post:{action:'execute'"));
 assert.ok(!src.includes("post:{action:'start'"));
});
