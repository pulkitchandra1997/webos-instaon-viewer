'use strict';
const Service=require('webos-service');
const {ViewerController}=require('./controller.cjs');
const controller=new ViewerController(require('./credentials.private.json'));
const service=new Service('org.webos.instaonviewer.service');
service.register('open',message=>{
  if(!message.isSubscription)return message.respond({returnValue:false,errorText:'A subscription is required'});
  controller.open(message).catch(()=>message.respond({returnValue:false,errorText:'Viewer could not start'}));
},message=>controller.stop(message.uniqueToken));
service.register('select',message=>controller.select(message.payload||{},message).catch(()=>message.respond({returnValue:false,errorText:'Selection failed'})));
service.register('status',message=>message.respond({returnValue:true,version:'0.4.2',quality:controller.subtype===0?'HD':'SD',transport:'InstaOn UDP/PTCP',gateway:false,node:process.version,channels:controller.stats(),media:controller.diagnostics()}));
service.register('stop',message=>controller.stop().then(()=>message.respond({returnValue:true})));
process.on('SIGTERM',()=>controller.stop().then(()=>process.exit(0)));
process.on('SIGINT',()=>controller.stop().then(()=>process.exit(0)));
