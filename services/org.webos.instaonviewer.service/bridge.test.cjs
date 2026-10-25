'use strict';
const assert = require('assert');
const fs = require('fs');
const implementation = fs.existsSync(__dirname + '/bridge.cjs') ? require('./bridge.cjs') : {};
const WebSocket = require('ws');
async function run() {
  assert.strictEqual(typeof implementation.createBridge, 'function', 'Authenticated local media bridge is missing');
  const bridge = await implementation.createBridge();
  let unauthorized = false;
  await new Promise(resolve => {
    const bad = new WebSocket(bridge.url.replace(bridge.token, 'wrong'));
    bad.on('unexpected-response', (request, response) => { unauthorized = response.statusCode === 403; response.resume(); bad.terminate(); resolve(); });
    bad.on('error', () => {});
  });
  assert(unauthorized, 'Untrusted local caller must not receive camera frames');
  const socket = new WebSocket(bridge.url);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  assert.strictEqual(bridge.frame(1,{codec:'h265',keyframe:false,data:Buffer.alloc(4)}),0,'A new decoder must not receive delta frames before its keyframe');
  const next = new Promise(resolve => socket.once('message', resolve));
  assert.strictEqual(bridge.frame(3, { codec:'h265', keyframe:true, timestamp:90000, data:Buffer.from([0,0,0,1,0x26,1]) }), 1);
  const data = await next;
  assert.strictEqual(data.toString('ascii', 0, 4), 'CPFR');
  assert.strictEqual(data[5], 3);
  assert.strictEqual(data[6], 2);
  assert.strictEqual(data[7], 1);
  assert.strictEqual(data.readUInt32LE(8), 90000);
  assert.strictEqual(data.readUInt32LE(20), 6);
  assert.deepStrictEqual(Array.from(data.slice(24)), [0,0,0,1,0x26,1]);
  assert.strictEqual(bridge.frame(3,{codec:'h265',keyframe:false,data:Buffer.alloc(4)}),0,'Unpainted frames must consume the channel credit');
  const queued=new Promise(resolve=>socket.once('message',resolve));
  socket.send(JSON.stringify({type:'ack',channel:3}));
  const queuedData=await Promise.race([queued,new Promise(resolve=>setTimeout(()=>resolve(null),300))]);
  assert(queuedData,'A bounded relay burst must preserve the next delta frame after ACK');
  assert.strictEqual(queuedData[7],0);
  // Overflow a stalled consumer: discard the broken reference chain, never grow
  // the queue indefinitely, and explicitly reset on the next keyframe.
  for(let i=0;i<20;i++)bridge.frame(3,{codec:'h265',keyframe:false,data:Buffer.alloc(4)});
  socket.send(JSON.stringify({type:'ack',channel:3}));await new Promise(resolve=>setTimeout(resolve,20));
  assert.strictEqual(bridge.frame(3,{codec:'h265',keyframe:false,data:Buffer.alloc(4)}),0,'After queue overflow, wait for a fresh keyframe');
  const nextKey=new Promise(resolve=>socket.once('message',resolve));
  assert.strictEqual(bridge.frame(3,{codec:'h265',keyframe:true,data:Buffer.alloc(4)}),1);
  assert.strictEqual((await nextKey)[7],3,'Discontinuity must force decoder reset on the next keyframe');
  const hd=new Promise(resolve=>socket.once('message',resolve));
  bridge.frame(4,{codec:'h265',subtype:0,keyframe:true,data:Buffer.alloc(4)});
  assert.strictEqual((await hd)[7],5,'HD packets must carry their quality tag across a switch');
  assert.throws(() => bridge.frame(0, {data:Buffer.alloc(1)}), /channel/);
  assert.throws(() => bridge.frame(1, {data:Buffer.alloc(2*1024*1024+1)}), /large/);
  const closed = new Promise(resolve => socket.once('close', resolve));
  await bridge.close(); await closed;
  assert.strictEqual(bridge.frame(1, {codec:'h265',data:Buffer.alloc(1)}), 0);
  console.log('PASS authenticated bridge, frame wire format, bounds, socket cleanup');
}
run().catch(error => { console.error(error); process.exit(1); });
