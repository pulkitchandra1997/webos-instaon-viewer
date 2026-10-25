'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'..');
function frame(){return {pts:null,width:2,height:2,sequence:1,sampleAspectRatio:{numerator:1,denominator:1},data:new Uint8Array(6)};}
function packet(channel,flags,codec){
  const data=new ArrayBuffer(28),v=new DataView(data);
  v.setUint32(0,0x43504652);v.setUint8(4,1);v.setUint8(5,channel);
  v.setUint8(6,codec===undefined?2:codec);v.setUint8(7,flags===undefined?1:flags);
  v.setFloat64(12,Date.now(),true);v.setUint32(20,4,true);return data;
}
function harness(options){
  options=options||{};
  const outputs=[],sockets=[],operations=[],ports=new Set(),timers=new Map(),assetRequests=[];let located,closed=false,context,now=100000,nextTimer=0,wasmBinary;
  class Clock extends Date { static now(){return now;} }
  // No network or vendor WASM executes: only the worker's actual event handlers do.
  function Socket(){this.readyState=1;this.acks=[];sockets.push(this);}
  Socket.OPEN=1;
  Socket.prototype.close=function(){this.readyState=3;};
  Socket.prototype.send=function(data){assert.strictEqual(this.readyState,1);this.acks.push(JSON.parse(data));};
  function AssetRequest(){};
  AssetRequest.prototype.open=function(method,url,async){assetRequests.push({method,url,async});};
  AssetRequest.prototype.send=function(){this.status=0;this.response=new Uint8Array([0,97,115,109,1,0,0,0]).buffer;};
  const sandbox={Map,Set,DataView,Uint8Array,ArrayBuffer,Date:Clock,WebSocket:Socket,XMLHttpRequest:AssetRequest,onmessage:null,
    postMessage(message){outputs.push(message);},close(){closed=true;},
    setInterval(callback,delay){const id=++nextTimer;timers.set(id,{callback,delay,next:now+delay});return id;},
    clearInterval(id){timers.delete(id);},
    importScripts(...files){for(const file of files){
      if(file==='module-libDecodeSDK.js'){located=sandbox.Module.locateFile('libDecodeSDK.wasm');wasmBinary=sandbox.Module.wasmBinary;continue;}
      vm.runInContext(fs.readFileSync(path.join(root,'experiments/direct-tv/decoder',file),'utf8'),context);
    }}};
  context=vm.createContext(sandbox);
  // Node 12 VM needs a declared binding for the Worker's ambient onmessage.
  vm.runInContext('var onmessage;',context);
  vm.runInContext(fs.readFileSync(path.join(root,'src/direct-worker.js'),'utf8'),context);
  const decoder={
    open(channel){operations.push(['open',channel]);if(options.open)options.open(channel);assert(!ports.has(channel));ports.add(channel);},
    close(channel){operations.push(['close',channel]);ports.delete(channel);},
    decode(channel,bytes){assert(ports.has(channel));operations.push(['decode',channel]);return options.decode?options.decode(channel,bytes):frame();},
    dispose(){ports.clear();operations.push(['dispose']);},
    stats(){return options.stats?options.stats():{wasmBytes:201326592,channels:Array.from(ports)};}
  };
  sandbox.SharedHevcDecoder=function(){return decoder;};sandbox.Module.HEAPU8={byteLength:201326592};
  sandbox.Module.onRuntimeInitialized();
  const h={outputs,sockets,operations,located,assetRequests,wasmBinary,send(message){sandbox.onmessage({data:message});},
    connect(){h.send({type:'connect',url:'ws://offline.invalid/media'});return sockets[sockets.length-1];},
    deliver(channel,flags,codec,source){(source||sockets[sockets.length-1]).onmessage({data:packet(channel,flags,codec)});},
    frames(){return outputs.filter(m=>m.type==='frame');},
    decoded(){return operations.filter(op=>op[0]==='decode').length;},
    closed(){return closed;},
    advance(ms){const target=now+ms;for(const [id,timer] of timers)while(timers.has(id)&&timer.next<=target){now=timer.next;timer.next+=timer.delay;timer.callback();}now=target;}};
  return h;
}
let failures=0;
function test(name,run){try{run();console.log('PASS '+name);}catch(error){failures++;console.error('FAIL '+name+': '+error.message);}}

test('packaged file decoder is supplied as bytes instead of unsupported file fetch',()=>{
  const h=harness();assert(h.wasmBinary instanceof Uint8Array,'Supply WASM bytes before importing SDK on real TV');
  assert.deepStrictEqual(Array.from(h.wasmBinary),[0,97,115,109,1,0,0,0]);
  assert.deepStrictEqual(h.assetRequests,[{method:'GET',url:'module-libDecodeSDK.wasm',async:false}]);
});

test('quality changes discard old-stream packets and reset only the selected decoder',()=>{
  const h=harness();h.send({type:'select',channels:[1,2],subtype:1});h.connect();h.deliver(1,1);h.send({type:'painted',channel:1});
  h.send({type:'select',channels:[1],subtype:0});const before=h.frames().length;
  h.deliver(1,1);assert.strictEqual(h.frames().length,before,'Old SD keyframes must not be decoded in HD mode');
  h.deliver(1,5);assert.strictEqual(h.frames().length,before+1,'The HD keyframe must start the enlarged stream');h.send({type:'painted',channel:1});
  h.send({type:'select',channels:[1,2],subtype:1});h.deliver(1,5);
  assert.strictEqual(h.frames().length,before+1,'Old HD packets must not contaminate the returning SD grid');
  h.deliver(1,1);assert.strictEqual(h.frames().length,before+2);
});

test('a proven IDR recovers transport drops without repeatedly reallocating a healthy decoder',()=>{
  const h=harness();h.send({type:'select',channels:[1]});const s=h.connect();h.deliver(1);h.send({type:'painted',channel:1});
  const before=h.operations.filter(op=>op[0]==='open').length;
  const bytes=new ArrayBuffer(30),v=new DataView(bytes);v.setUint32(0,0x43504652);v.setUint8(4,1);v.setUint8(5,1);v.setUint8(6,2);v.setUint8(7,3);v.setUint32(20,6,true);new Uint8Array(bytes,24).set([0,0,0,1,0x26,1]);
  s.onmessage({data:bytes});
  assert.strictEqual(h.frames().length,2);assert.strictEqual(h.operations.filter(op=>op[0]==='open').length,before,'IDR already resets HEVC references; do not create another cold-start stall');
});

test('source worker resolves packaged WASM and measures decode duration',()=>{
  const h=harness();assert.strictEqual(h.located,'module-libDecodeSDK.wasm');
  h.send({type:'select',channels:[1]});h.connect();h.deliver(1);
  const m=h.frames()[0];assert(m);
  assert(Number.isFinite(m.decodeMs)&&m.decodeMs>=0&&m.decodeMs<1000);
  assert(Number.isFinite(m.sourceSentAt)&&m.sourceSentAt>0,'Decoded frames must retain the bridge send timestamp for presentation-latency measurement');
});
test('ten-channel flood emits at most one frame each until painted',()=>{
  const h=harness();h.send({type:'select',channels:[1,2,3,4,5,6,7,8,9,10]});const s=h.connect();
  for(let round=0;round<100;round++)for(let channel=1;channel<=10;channel++)h.deliver(channel);
  assert.strictEqual(h.frames().length,10);assert.strictEqual(h.decoded(),10);
  assert.deepStrictEqual(s.acks,[],'Unpainted frames must retain their channel credits');
  h.send({type:'painted',channel:1});
  assert.deepStrictEqual(s.acks,[{type:'ack',channel:1}]);
  h.deliver(1,3);h.deliver(2);
  assert.strictEqual(h.frames().length,11);assert.strictEqual(h.decoded(),11);
});
test('painted releases a held credit exactly once',()=>{
  const h=harness();h.send({type:'select',channels:[1]});const s=h.connect();
  h.send({type:'painted',channel:1});assert.deepStrictEqual(s.acks,[]);
  h.deliver(1);h.send({type:'painted',channel:1});h.send({type:'painted',channel:1});
  assert.deepStrictEqual(s.acks,[{type:'ack',channel:1}]);
});
test('discarded deltas ACK immediately and discontinuity alone is not a keyframe',()=>{
  const h=harness();h.send({type:'select',channels:[1]});const s=h.connect();
  h.deliver(1,0);h.deliver(1,2);h.deliver(1,0);
  assert.strictEqual(h.decoded(),0);assert.strictEqual(h.frames().length,0);
  assert.deepStrictEqual(s.acks,[{type:'ack',channel:1},{type:'ack',channel:1},{type:'ack',channel:1}]);
  assert(h.operations.some(op=>op[0]==='close'),'Discontinuity must reset the decoder');
  h.deliver(1,1);assert.strictEqual(h.frames().length,1);assert.strictEqual(s.acks.length,3);
});
test('discontinuity after painting resets references and requires a new keyframe',()=>{
  const h=harness();h.send({type:'select',channels:[1]});h.connect();h.deliver(1);h.send({type:'painted',channel:1});
  const before=h.operations.length;h.deliver(1,2);h.deliver(1,0);
  assert.strictEqual(h.frames().length,1);assert.strictEqual(h.decoded(),1);
  assert.deepStrictEqual(h.operations.slice(before,before+2),[['close',1],['open',1]]);
  h.deliver(1,3);assert.strictEqual(h.frames().length,2);
});
test('null decode output ACKs immediately so the next input can make progress',()=>{
  let n=0;const h=harness({decode(){return n++===0?null:frame();}});
  h.send({type:'select',channels:[1]});const s=h.connect();h.deliver(1);
  assert.strictEqual(h.frames().length,0);assert.deepStrictEqual(s.acks,[{type:'ack',channel:1}]);
  h.deliver(1,0);assert.strictEqual(h.frames().length,1);assert.strictEqual(s.acks.length,1);
});
test('decode errors ACK and recover only on a keyframe',()=>{
  let n=0;const h=harness({decode(){if(n++===0)throw new Error('decode failed');return frame();}});
  h.send({type:'select',channels:[1]});const s=h.connect();h.deliver(1);h.deliver(1,0);
  assert.strictEqual(h.decoded(),1);assert.strictEqual(h.frames().length,0);
  assert(h.outputs.some(m=>m.type==='channel-error'));
  assert.deepStrictEqual(s.acks,[{type:'ack',channel:1},{type:'ack',channel:1}]);
  h.deliver(1,1);assert.strictEqual(h.frames().length,1);
});
test('decoder reset errors also release input credit',()=>{
  let opens=0;const h=harness({open(){if(++opens===2)throw new Error('port unavailable');}});
  h.send({type:'select',channels:[1]});const s=h.connect();
  assert.doesNotThrow(()=>h.deliver(1));assert.deepStrictEqual(s.acks,[{type:'ack',channel:1}]);
  assert(h.outputs.some(m=>m.type==='channel-error'));h.deliver(1);assert.strictEqual(h.frames().length,1);
});
test('malformed payload length, unselected frames and unsupported codecs release credit',()=>{
  const h=harness();h.send({type:'select',channels:[1]});const s=h.connect();
  const bad=packet(1);new DataView(bad).setUint32(20,100,true);s.onmessage({data:bad});
  h.deliver(2);h.deliver(1,1,1);
  assert.deepStrictEqual(s.acks,[{type:'ack',channel:1},{type:'ack',channel:2},{type:'ack',channel:1}]);
  assert.strictEqual(h.frames().length,0);assert.strictEqual(h.decoded(),0);
});
test('deselection retains already-emitted credit until its painted message',()=>{
  const h=harness();h.send({type:'select',channels:[1]});const s=h.connect();h.deliver(1);
  h.send({type:'select',channels:[]});assert.deepStrictEqual(s.acks,[]);
  h.send({type:'painted',channel:1});h.deliver(1);
  assert.deepStrictEqual(s.acks,[{type:'ack',channel:1},{type:'ack',channel:1}]);
  assert.strictEqual(h.frames().length,1);
});
test('reconnect ignores old socket callbacks and does not ACK new credit for an old paint',()=>{
  const h=harness();h.send({type:'select',channels:[1]});const old=h.connect();h.deliver(1);
  const current=h.connect();h.deliver(1,1,2,old);old.onerror();old.onclose();
  assert.strictEqual(h.frames().length,1);assert(!h.outputs.some(m=>m.type==='error'||m.type==='socket-close'));
  h.send({type:'painted',channel:1});assert.deepStrictEqual(current.acks,[]);
  h.deliver(1,0);assert.strictEqual(h.frames().length,1,'New sessions must wait for keyframes');
  h.deliver(1,1);h.send({type:'painted',channel:1});
  assert.deepStrictEqual(current.acks,[{type:'ack',channel:1},{type:'ack',channel:1}]);
});
test('selection churn cannot exceed ten outstanding decoded frames',()=>{
  const h=harness();h.send({type:'select',channels:[1,2,3,4,5,6,7,8,9,10]});h.connect();
  for(let c=1;c<=10;c++)h.deliver(c);
  h.send({type:'select',channels:[11,12,13,14,15,16,17,18,19,20]});
  for(let c=11;c<=20;c++)h.deliver(c);
  assert.strictEqual(h.frames().length,10);assert.strictEqual(h.decoded(),10);
  h.send({type:'painted',channel:1});h.deliver(11);
  assert.strictEqual(h.frames().length,11);
});
test('stop closes the socket, disposes the decoder and suppresses late callbacks',()=>{
  const h=harness();h.send({type:'select',channels:[1]});const s=h.connect();h.deliver(1);
  h.send({type:'stop'});h.deliver(1,1,2,s);s.onerror();s.onclose();
  assert(h.closed());assert.strictEqual(s.readyState,3);assert(h.operations.some(op=>op[0]==='dispose'));
  assert.strictEqual(h.frames().length,1);assert(!h.outputs.some(m=>m.type==='error'||m.type==='socket-close'));
});
test('heap budget errors are fatal, release credit and prevent further decoding',()=>{
  const h=harness({decode(){throw new Error('Decoder heap budget exceeded; terminate worker');}});
  h.send({type:'select',channels:[1]});const s=h.connect();h.deliver(1);h.deliver(1);
  assert.deepStrictEqual(s.acks,[{type:'ack',channel:1},{type:'ack',channel:1}]);
  assert.strictEqual(h.outputs.filter(m=>m.type==='error'&&m.message.includes('Decoder heap budget exceeded')).length,1);
  assert.strictEqual(h.outputs.filter(m=>m.type==='channel-error').length,0);assert.strictEqual(h.decoded(),1);
});
test('health reports current decoder stats every two seconds and stops on disposal',()=>{
  let heap=201326592;const h=harness({stats(){return {wasmBytes:heap,channels:[]};}});
  h.advance(1999);assert.strictEqual(h.outputs.filter(m=>m.type==='health').length,0);
  h.advance(1);let health=h.outputs.filter(m=>m.type==='health');assert.strictEqual(health.length,1);assert.strictEqual(health[0].stats.wasmBytes,201326592);
  heap=201327616;h.advance(1999);assert.strictEqual(h.outputs.filter(m=>m.type==='health').length,1);
  h.advance(1);health=h.outputs.filter(m=>m.type==='health');assert.strictEqual(health.length,2);assert.strictEqual(health[1].stats.wasmBytes,201327616);
  h.send({type:'stop'});h.advance(10000);assert.strictEqual(h.outputs.filter(m=>m.type==='health').length,2);
});
if(failures)process.exitCode=1;
