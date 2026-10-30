'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const yaml=fs.readFileSync(path.join(root,'render.yaml'),'utf8');
const server=fs.readFileSync(path.join(root,'scripts/server.js'),'utf8');
test('Render worker requires persistent storage, one instance, and a manual paid deployment',()=>{
 assert.match(yaml,/plan: starter/);
 assert.match(yaml,/numInstances: 1/);
 assert.match(yaml,/autoDeployTrigger: off/);
 assert.match(yaml,/mountPath: \/var\/data/);
 assert.match(yaml,/healthCheckPath: \/healthz/);
 assert.match(yaml,/OMEGA_WORKER_DATA_DIR/);
 assert.match(yaml,/OMEGA_LIVE_ORDERS_ENABLED\n\s+value: "false"/);
});
test('Render Blueprint never contains secrets or pre-authorizes live orders',()=>{
 for(const name of ['OMEGA_WORKER_TOKEN','BYBIT_LIVE_API_KEY','BYBIT_LIVE_API_SECRET','OMEGA_DASHBOARD_PASSWORD','OMEGA_SESSION_SECRET'])assert.match(yaml,new RegExp('key: '+name+'\\n\\s+sync: false'));
 assert.ok(!yaml.includes('OMEGA_LIVE_ORDERS_ENABLED\n        value: "true"'));
});
test('unprivileged health check is distinct from worker control and cannot arm trades',()=>{
 assert.ok(server.includes("url.pathname === '/healthz' && req.method === 'GET'"));
 assert.ok(server.indexOf("url.pathname === '/healthz'")<server.indexOf("'/worker/control','/worker/paper'"));
 assert.ok(server.includes("auth.safeCompare(req.headers.authorization"));
});
