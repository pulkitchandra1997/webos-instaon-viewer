'use strict';
const assert=require('assert'),fs=require('fs'),{EventEmitter}=require('events');
const implementation=fs.existsSync(__dirname+'/controller.cjs')?require('./controller.cjs'):{};
async function run(){
  assert.strictEqual(typeof implementation.ViewerController,'function','Session-safe service controller is missing');
  const engines=[];class Engine extends EventEmitter{constructor(){super();engines.push(this);this.selections=[];this.closes=0;}async select(channels,subtype){this.selections.push({channels,subtype});}stats(){return [];}async reconcile(){} async close(){this.closes++;}}
  const replies=[],owner={uniqueToken:'a',respond(v){replies.push(v);}};
  let resolveBridge,bridgeClosed=0;const bridge={url:'ws://127.0.0.1/fixture',frame(){},async close(){bridgeClosed++;}};
  const controller=new implementation.ViewerController({}, {Engine,createBridge:()=>new Promise(resolve=>resolveBridge=resolve)});
  const opening=controller.open(owner);await new Promise(resolve=>setImmediate(resolve));await controller.stop();resolveBridge(bridge);await opening;
  assert.strictEqual(engines.length,0,'Bridge resolving after stop must never open cameras');assert.strictEqual(bridgeClosed,1);
  const active=new implementation.ViewerController({}, {Engine,createBridge:async()=>bridge});
  await active.open(owner);await active.open(owner);assert.strictEqual(engines.length,1,'Repeated subscription must not orphan an engine');
  assert.strictEqual(engines[0].selections[0].subtype,1,'The ten-camera grid must start on the SD substream');
  const configReply={respond(){}};
  await active.select({channels:[1,2,3,4],subtype:0},configReply);
  await active.select({channels:[1,2],subtype:1},configReply);
  assert.strictEqual(engines[0].selections[1].subtype,1,'A multi-camera request must stay SD even with an old HD preference');
  assert.strictEqual(engines[0].selections[2].subtype,1);
  assert.deepStrictEqual(engines[0].selections[2].channels,[1,2]);
  await active.select({channels:[3],subtype:0},configReply);
  assert.strictEqual(engines[0].selections[3].subtype,0,'A single enlarged camera must use HD');
  await active.stop();assert.strictEqual(engines[0].closes,1);assert.strictEqual(bridgeClosed,2);
  console.log('PASS late startup cancellation, repeated open, latest selection, session cleanup');
}
run().catch(error=>{console.error(error);process.exit(1);});
