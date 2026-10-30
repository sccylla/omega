'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {durableWorkerState}=require('../lib/trading-worker');
const env={OMEGA_REQUIRE_PERSISTENT_DISK:'true'};
test('live worker refuses an ephemeral directory even with a fake mount listing',()=>{
 assert.equal(durableWorkerState('/tmp/omega',env,()=>''),false);
 assert.equal(durableWorkerState('/var/data/omega',env,()=>''),false);
 assert.equal(durableWorkerState('/var/data/omega',env,()=>['36 22 0:29 / / rw - overlay overlay rw','37 22 8:1 / /other rw - ext4 disk rw'].join('\n')),false);
});
test('durable worker recognizes an actual /var/data mount',()=>{
 assert.equal(durableWorkerState('/var/data/omega-state',env,()=>['36 22 0:29 / / rw - overlay overlay rw','37 22 8:1 / /var/data rw - ext4 /dev/sdb rw'].join('\n')),true);
 assert.equal(durableWorkerState('/var/data/omega',{},()=>''),true);
});
