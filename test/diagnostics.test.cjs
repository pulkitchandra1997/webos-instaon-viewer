'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const sandbox={window:{}};sandbox.self=sandbox.window;
vm.runInNewContext(fs.readFileSync(__dirname+'/../src/diagnostics.js','utf8'),sandbox);
const diagnostics=sandbox.window.CameraDiagnostics.create(()=>1000);

diagnostics.received({channel:2},3);
diagnostics.replaced(2);
diagnostics.painted({channel:2,decodeMs:7,sourceSentAt:900},930);
let snapshot=diagnostics.snapshot();
assert.deepStrictEqual(JSON.parse(JSON.stringify(snapshot.aggregate)),{received:1,painted:1,replaced:1,maxQueueDepth:3,totalDecodeMs:7,maxDecodeMs:7,latencySamples:1,totalLatencyMs:30,maxLatencyMs:30});
assert.deepStrictEqual(JSON.parse(JSON.stringify(snapshot.channels['2'])),{received:1,painted:1,replaced:1,totalDecodeMs:7,maxDecodeMs:7,latencySamples:1,totalLatencyMs:30,maxLatencyMs:30,lastPresentedAt:930});

diagnostics.received({channel:2},0);
diagnostics.painted({channel:2,decodeMs:-1,sourceSentAt:0},940);
snapshot=diagnostics.snapshot();
assert.strictEqual(snapshot.aggregate.received,2);
assert.strictEqual(snapshot.aggregate.painted,2);
assert.strictEqual(snapshot.aggregate.latencySamples,1);
assert.strictEqual(snapshot.aggregate.maxQueueDepth,3);
console.log('PASS diagnostics records queue, drops, decode time, and presentation latency');
