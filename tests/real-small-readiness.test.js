'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'static/live-parity.js'),'utf8');
const small=fs.readFileSync(path.join(root,'lib/small-live.js'),'utf8');
const legacy=fs.readFileSync(path.join(root,'api/manual-live.js'),'utf8');
test('real account readiness uses $15 small-account server policy, not the $450 legacy floor',()=>{
 assert.match(ui,/\/api\/manual-live\?profile=small&action=status/);
 assert.match(ui,/policy\.minEquityUsd/);
 assert.match(ui,/policy\.tradeUsd/);
 assert.match(ui,/d\.equity>=policy\.minEquityUsd&&d\.available>=policy\.tradeUsd/);
 assert.match(ui,/Insufficient balance for a \$15 live trade/);
 assert.doesNotMatch(ui,/Insufficient balance for a \$90 live trade/);
 assert.match(small,/const ORDER_USD=15,MAX_USD=16,EXPOSURE=\.20/);
 assert.match(small,/minEquityUsd:ORDER_USD\/EXPOSURE/);
 assert.match(small,/tradeUsd:ORDER_USD/);
});
test('website readiness does not loosen the older $90/$450 real-money safeguards',()=>{
 assert.match(ui,/legacy \$90\/\$450 workflow is separate/);
 assert.match(legacy,/return profile==='small'\?small\(req,res\):legacy\(req,res\)/);
 const policy=fs.readFileSync(path.join(root,'lib/live-policy.js'),'utf8');
 assert.match(policy,/MIN_LIVE_EQUITY_USD=450/);
 assert.match(policy,/MIN_LIVE_ORDER_USD=90/);
});
