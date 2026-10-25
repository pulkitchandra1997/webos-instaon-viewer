'use strict';
const assert=require('assert'),{EventEmitter}=require('events');
const {CameraEngine}=require('../services/org.webos.instaonviewer.service/engine.cjs');
const {ViewerController}=require('../services/org.webos.instaonviewer.service/controller.cjs');
(async()=>{
  const credentials={deviceid:'fixture',username:'fixture-user',password:'fixture-password',cloud:{host:'cloud.example.invalid',port:9000},cameraCount:6};let received;
  const tunnel=new EventEmitter();tunnel.close=()=>{};
  const e=new CameraEngine(credentials,{open:async(c,opts)=>{received=opts;return {tunnel};}});
  await e.ensureConnection();assert.deepStrictEqual(received.cloud,credentials.cloud);await e.close();
  const controller=new ViewerController(credentials);assert.deepStrictEqual(controller.channels,[1,2,3,4,5,6]);
  let reply;await controller.select({channels:[7],subtype:1},{respond:r=>{reply=r;}});assert.strictEqual(reply.returnValue,false);
  console.log('Configured cloud reaches transport; configured camera count bounds service selection.');
})().catch(e=>{console.error(e);process.exitCode=1;});
