'use strict';
const fs = require('fs');
const assert = require('assert');
const {EventEmitter} = require('events');
const implementation = fs.existsSync(__dirname + '/engine.cjs') ? require('./engine.cjs') : {};
async function run() {
  assert.strictEqual(typeof implementation.CameraEngine, 'function', 'Direct multi-camera engine is missing');
  let finishDiscovery;
  const observed=new implementation.CameraEngine({}, {open:(_,options)=>{if(options.onProgress)options.onProgress('cloud-dns');return new Promise((_,reject)=>{finishDiscovery=reject;});}});
  const observing=observed.select([1],0).catch(()=>{});await new Promise(resolve=>setImmediate(resolve));
  assert.strictEqual(observed.stats()[0].stage,'cloud-dns','A pending connection must expose its actual safe handshake stage');
  finishDiscovery(Object.assign(new Error('private endpoint must never be logged'),{code:'ERR_INSTAON_TIMEOUT',stage:'cloud-dns'}));await observing;
  assert.strictEqual(observed.stats()[0].failureCode,'ERR_INSTAON_TIMEOUT');await observed.close();
  const clients = [], closedStreams = []; let tunnelClosed = 0;
  const tunnel = new EventEmitter(); tunnel.close = () => { tunnelClosed++; };
  tunnel.connect = async port => { assert.strictEqual(port,554); return {destroyed:false,destroy(){if(!this.destroyed){this.destroyed=true;closedStreams.push(this);}}}; };
  class Rtsp extends EventEmitter {
    constructor(stream, opts){super();this.stream=stream;this.opts=opts;clients.push(this);}
    async start(){return {codec:'h265'};}
    async close(){this.stream.destroy();}
  }
  const engine = new implementation.CameraEngine({deviceid:'fixture',username:'user',password:'secret'}, {
    open:async () => ({tunnel, info:{rtspport:554}}), Rtsp, staggerMs:0
  });
  let frames=0;engine.on('frame', (channel, frame) => {assert.strictEqual(channel,3); assert.strictEqual(frame.data.length,4); frames++;});
  engine.on('error', () => {});
  await engine.select([1,2,3,4,5,6,7,8,9,10],1);
  assert.strictEqual(clients.length,10, 'Ten independent RTSP clients must be started');
  assert(clients[9].opts.url.includes('channel=10&subtype=1'));
  clients[2].emit('frame',{codec:'h265',data:Buffer.from([0,0,0,1]),keyframe:true,timestamp:3});
  assert.strictEqual(frames,1);
  await engine.select([1,2,3,4],1);
  assert.strictEqual(closedStreams.length,6,'Hidden channel connections must close');
  assert.strictEqual(clients.length,10,'Unchanged channels must not reconnect');
  await assert.rejects(engine.select([0],1), /channel/);
  await engine.close(); await engine.close();
  assert.strictEqual(tunnelClosed,1); assert.strictEqual(closedStreams.length,10);
  let resolveOpen;
  const lateTunnel = new EventEmitter(); let lateClosed=0;lateTunnel.close=()=>lateClosed++;
  let abortObserved=false;
  const late = new implementation.CameraEngine({}, {open:(_,opts) => {if(opts&&opts.signal)opts.signal.addEventListener('abort',()=>abortObserved=true);return new Promise(resolve=>resolveOpen=resolve);},Rtsp,staggerMs:0});
  late.on('error',()=>{});
  const selecting=late.select([1],1); await new Promise(resolve=>setImmediate(resolve));
  await late.close();resolveOpen({tunnel:lateTunnel,info:{}});await selecting;
  assert(abortObserved,'Closing during discovery must abort the live handshake immediately');
  assert.strictEqual(lateClosed,1,'Cancellation during discovery must close late tunnel');
  console.log('PASS ten RTSP channels, frame routing, selection cleanup, cancellation');
  await lifecycleTests();
}

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
function fixture(options) {
  const o=options||{},clients=[],streams=[];let now=1000,opens=0;
  const tunnel=new EventEmitter();tunnel.closeCalls=0;tunnel.close=()=>{tunnel.closeCalls++;};
  tunnel.connect=(port,opts)=>{
    const stream={destroyed:false,destroy(){this.destroyed=true;}};streams.push(stream);
    return o.bind?o.bind(stream,opts):Promise.resolve(stream);
  };
  class Client extends EventEmitter {
    constructor(stream,opts){super();this.stream=stream;this.opts=opts;this.index=clients.length;this.closeCalls=0;clients.push(this);}
    start(){return o.start?o.start(this):Promise.resolve();}
    close(){this.closeCalls++;this.stream.destroy();return o.close?o.close(this):Promise.resolve();}
  }
  const engine=new implementation.CameraEngine({username:'fixture-user',password:'fixture-password'},{
    open:async()=>{opens++;return {tunnel,info:null};},Rtsp:Client,staggerMs:0,now:()=>now,
    retryBaseMs:100,retryMaxMs:400,firstFrameTimeoutMs:15000,staleMs:15000,closeTimeoutMs:20
  });
  engine.on('error',()=>{});
  return {engine,clients,streams,tunnel,now:value=>{now=value;},opens:()=>opens};
}
async function lifecycleTests() {
  // A cancelled client can reject start() after the replacement is already live.
  const first=deferred(),f=fixture({start:c=>c.index===0?first.promise:Promise.resolve()});
  try {
    const old=f.engine.select([1],1);await tick();
    await f.engine.select([1],0);const fresh=f.clients[1];
    first.reject(new Error('Old request rejected after replacement'));await old;
    assert.strictEqual(f.engine.entries.get(1).client,fresh);
    assert.strictEqual(fresh.closeCalls,0);
    assert.strictEqual(f.clients[0].listenerCount('frame'),0);
    assert.strictEqual(f.clients[0].listenerCount('close'),0);
    assert.doesNotThrow(()=>f.clients[0].emit('error',new Error('Late adapter error')));
    console.log('PASS stale selection failure cannot close its replacement');
  } finally {await f.engine.close();}

  const a=fixture();
  try {
    await Promise.all([a.engine.select([1,2,3],1),a.engine.select([1,2,3],1),a.engine.reconcile(),a.engine.reconcile()]);
    assert.strictEqual(a.clients.length,3);assert.strictEqual(a.opens(),1);
    await a.engine.select([3,4],0);
    assert.deepStrictEqual(a.engine.stats().map(s=>[s.channel,s.subtype]),[[3,0],[4,0]]);
    assert(a.clients.slice(0,3).every(c=>c.stream.destroyed));
    console.log('PASS concurrent selections/reconcile share attempts and preserve newest intent');
  } finally {await a.engine.close();}

  const bind=deferred(),b=fixture({bind:()=>bind.promise});
  try {
    const old=b.engine.select([1],1);await tick();
    await b.engine.select([],1);await old;
    const lateStream={destroyed:false,destroy(){this.destroyed=true;}};
    bind.resolve(lateStream);await tick();
    assert.strictEqual(lateStream.destroyed,true);assert.strictEqual(b.clients.length,0);
    console.log('PASS late bind completion is closed after selection cancellation');
  } finally {await b.engine.close();}

  const r=fixture({start:c=>c.opts.url.includes('channel=1&')?Promise.reject(new Error('fixture failure')):Promise.resolve()});
  try {
    await r.engine.select([1,2],1);const neighbour=r.engine.entries.get(2).client;
    assert.strictEqual(r.engine.stats()[0].state,'error');assert.strictEqual(r.engine.stats()[0].nextRetryAt,1100);
    await r.engine.reconcile();assert.strictEqual(r.clients.length,2);
    r.now(1100);await Promise.all([r.engine.reconcile(),r.engine.reconcile()]);
    assert.strictEqual(r.clients.length,3);assert.strictEqual(r.engine.stats()[0].nextRetryAt,1300);
    r.now(1300);await r.engine.reconcile();assert.strictEqual(r.engine.stats()[0].nextRetryAt,1700);
    r.now(1700);await r.engine.reconcile();assert.strictEqual(r.engine.stats()[0].nextRetryAt,2100);
    assert.strictEqual(r.engine.entries.get(2).client,neighbour);assert.strictEqual(neighbour.closeCalls,0);
    assert.strictEqual(r.tunnel.closeCalls,0);
    console.log('PASS failed channels retry with bounded exponential backoff without restarting neighbours');
  } finally {await r.engine.close();}

  const z=fixture();
  try {
    await z.engine.select([1,2],1);
    z.now(16000);z.clients[1].emit('frame',{data:Buffer.alloc(1)});
    await z.engine.reconcile();
    assert.strictEqual(z.engine.stats()[0].state,'stalled');assert.strictEqual(z.engine.stats()[0].lastFrame,0);
    assert.strictEqual(z.engine.stats()[0].startedAt,1000);
    const neighbour=z.engine.entries.get(2).client;
    z.now(16100);await z.engine.reconcile();assert.strictEqual(z.clients.length,3);
    const replacement=z.engine.entries.get(1).client;
    replacement.emit('frame',{data:Buffer.alloc(1)});assert.strictEqual(z.engine.stats()[0].retryCount,0);
    z.now(31100);neighbour.emit('frame',{data:Buffer.alloc(1)});await z.engine.reconcile();
    assert.strictEqual(z.engine.stats()[0].state,'stalled');assert.strictEqual(neighbour.closeCalls,0);
    console.log('PASS zero-first-frame and fifteen-second stale feeds recover per channel');
  } finally {await z.engine.close();}

  const c=fixture();
  try {
    await c.engine.select([1,2],1);const healthy=c.engine.entries.get(2).client;
    c.clients[0].emit('close');assert.strictEqual(c.engine.stats()[0].state,'closed');
    c.now(1100);await c.engine.reconcile();assert.strictEqual(c.clients.length,3);
    const missing=c.engine.entries.get(1);c.engine.entries.delete(1);await c.engine.dispose(missing);
    await c.engine.reconcile();assert.strictEqual(c.clients.length,4);
    assert.strictEqual(c.engine.entries.get(2).client,healthy);
    console.log('PASS closed and missing desired channels recover on reconcile');
  } finally {await c.engine.close();}

  const pending=deferred(),h=fixture({start:()=>pending.promise,close:()=>new Promise(()=>{})});
  const selecting=h.engine.select([1],1);await tick();
  const close=h.engine.close();assert.strictEqual(h.engine.close(),close);await close;await selecting;
  assert(h.streams[0].destroyed);assert.strictEqual(h.tunnel.closeCalls,1);
  assert.strictEqual(h.engine.stats().length,0);assert.strictEqual(h.clients[0].listenerCount('frame'),0);
  pending.reject(new Error('Late RTSP start rejection'));await tick();
  console.log('PASS shutdown interrupts RTSP start and bounds uncooperative client close');
  await serializedStartupTests();
  console.log('PASS 8 lifecycle/recovery regression groups');
}
async function serializedStartupTests() {
  const starts=[];let active=0,maximum=0;
  const s=fixture({start:()=>{
    active++;maximum=Math.max(maximum,active);const d=deferred();starts.push(d);
    return d.promise.finally(()=>{active--;});
  }});
  try {
    const selecting=s.engine.select(Array.from({length:10},(_,i)=>i+1),1);
    for(let i=0;i<10;i++) {
      await tick();assert.strictEqual(s.clients.length,i+1,'Next RTSP negotiation must wait for the previous PLAY');
      assert.strictEqual(s.streams.length,i+1,'Bind must be inside the same startup gate');
      assert.strictEqual(active,1);starts[i].resolve();
    }
    await selecting;assert.strictEqual(maximum,1);assert.strictEqual(s.clients.length,10);
    assert(s.clients.every(client=>client.closeCalls===0&&!client.stream.destroyed),'Serial startup must preserve ten concurrent media streams');
    assert(s.engine.stats().every(entry=>entry.state==='playing'));
    console.log('PASS bind/RTSP startup is serial while ten established media streams stay concurrent');
  } finally {await s.engine.close();}

  const first=deferred(),q=fixture({start:client=>client.index===0?first.promise:Promise.resolve()});
  try {
    const old=q.engine.select(Array.from({length:10},(_,i)=>i+1),1);await tick();
    assert.strictEqual(q.clients.length,1);assert.strictEqual(q.engine.startupQueue.length,9);
    await q.engine.select([11],0);await old;
    assert.strictEqual(q.clients.length,2);assert(q.clients[1].opts.url.includes('channel=11&subtype=0'));
    assert.strictEqual(q.engine.startupQueue.length,0);assert.strictEqual(q.engine.startupBusy,false);
    first.reject(new Error('Cancelled previous negotiation'));await tick();
    assert.strictEqual(q.engine.entries.get(11).client,q.clients[1]);
    console.log('PASS cancelled active and queued negotiations release the gate without starting stale channels');
  } finally {await q.engine.close();}

  const failing=fixture({bind:()=>{const error=new Error('fixture failure');error.code='ERR_REALM_REFUSED';return Promise.reject(error);}});
  try {
    await failing.engine.select([1],1);
    let state=failing.engine.stats()[0];assert.strictEqual(state.failureCode,'ERR_REALM_REFUSED');assert.strictEqual(state.failureStage,'bind');
    failing.now(1100);await failing.engine.reconcile();state=failing.engine.stats()[0];assert.strictEqual(state.failureCode,'ERR_REALM_REFUSED');
    let transportError;failing.engine.on('error',error=>{transportError=error;});
    failing.tunnel.session={closedReason:'ERR_PTCP_FRAME'};failing.tunnel.emit('closed','ERR_PTCP_CLOSED');
    assert.strictEqual(transportError.code,'ERR_PTCP_FRAME');assert.strictEqual(failing.engine.stats()[0].transportCode,'ERR_PTCP_FRAME');
    console.log('PASS channel failure stage/code and original PTCP close reason survive into stats/error.code');
  } finally {await failing.engine.close();}
}
run().catch(error=>{console.error(error);process.exit(1);});
