'use strict';
importScripts('annexb.js','shared-hevc-decoder.js');
var decoder, selected=[], subtype=1, socket, painting=new Map(), awaitingKey=new Set(), healthy=new Set(), generation=0, healthTimer, fatal=false;
var Module={locateFile:function(name){return name==='libDecodeSDK.wasm'?'module-libDecodeSDK.wasm':name;},onRuntimeInitialized:function(){
  try{
    decoder=new SharedHevcDecoder(Module,{maxChannels:10,maxWidth:1920,maxHeight:1088});
    healthTimer=setInterval(function(){
      if(fatal)return;
      try{postMessage({type:'health',stats:decoder.stats()});}catch(error){reportError(null,error);}
    },2000);
    postMessage({type:'ready',wasmBytes:Module.HEAPU8.byteLength});
  }catch(error){postMessage({type:'error',message:error.message});}
}};
// Packaged TV apps use file://. Chromium fetch() rejects that scheme, while
// XMLHttpRequest in a Worker can read packaged assets. Supplying bytes prevents
// the pinned Emscripten loader from silently waiting forever on a file fetch.
try{
  var wasmRequest=new XMLHttpRequest();wasmRequest.open('GET','module-libDecodeSDK.wasm',false);wasmRequest.responseType='arraybuffer';wasmRequest.send();
  if((wasmRequest.status!==0&&wasmRequest.status!==200)||!wasmRequest.response||!wasmRequest.response.byteLength)throw new Error('Packaged decoder could not be read');
  Module.wasmBinary=new Uint8Array(wasmRequest.response);
  importScripts('module-libDecodeSDK.js');
}catch(error){postMessage({type:'error',message:error.message});}
function reportError(channel,error){
  var message=error.message||String(error);
  if(message.indexOf('Decoder heap budget exceeded')!==-1){
    if(fatal)return;fatal=true;clearInterval(healthTimer);
    postMessage({type:'error',message:message});
  }else postMessage(channel===null?{type:'error',message:message}:{type:'channel-error',channel:channel,message:message});
}
function ack(channel,source){
  if(source&&source.readyState===WebSocket.OPEN){
    try{source.send(JSON.stringify({type:'ack',channel:channel}));}
    catch(error){postMessage({type:'error',message:'Local media acknowledgement failed'});}
  }
}
function receiveFrame(bytes,source){
  if(!(bytes instanceof ArrayBuffer)||bytes.byteLength<24)return;
  var view=new DataView(bytes),channel=view.getUint8(5);
  if(view.getUint32(0)!==0x43504652||view.getUint8(4)!==1||channel<1||channel>64)return;
  // A duplicate must not release the credit belonging to an unpainted frame.
  // Retain its originating socket so a late paint never ACKs a replacement link.
  if(painting.has(channel)){
    if(selected.includes(channel))awaitingKey.add(channel);
    if(painting.get(channel)!==source)ack(channel,source);
    return;
  }
  var emitted=false;
  try{
    if(fatal||!selected.includes(channel))return;
    if(((view.getUint8(7)&4)?0:1)!==subtype)return;
    if(view.getUint32(20,true)!==bytes.byteLength-24||painting.size>=10||!decoder){awaitingKey.add(channel);return;}
    var flags=view.getUint8(7),key=!!(flags&1),discontinuity=!!(flags&2),payload=new Uint8Array(bytes,24),reuse=false;
    // An IDR is self-contained: it flushes old reference pictures without
    // reallocating a healthy decoder. Reinitializing every dropped burst causes
    // repeated expensive cold starts on the TV. CRA/unknown/error paths reset.
    if(key&&healthy.has(channel))try{reuse=HevcAnnexB.nals(payload).some(function(n){return n.type===19||n.type===20;});}catch(_){}
    if(discontinuity){awaitingKey.add(channel);if(!reuse){decoder.close(channel);decoder.open(channel);healthy.delete(channel);}}
    if(view.getUint8(6)!==2)throw new Error('Recorder codec is not HEVC');
    if(awaitingKey.has(channel)){
      if(!key)return;
      if(!discontinuity&&!reuse){decoder.close(channel);decoder.open(channel);healthy.delete(channel);}
      awaitingKey.delete(channel);
    }
    var decodeStart=Date.now(),frame=decoder.decode(channel,payload);healthy.add(channel);
    if(frame){
      painting.set(channel,source);
      postMessage({type:'frame',channel:channel,width:frame.width,height:frame.height,sar:frame.sampleAspectRatio,colour:frame.colour,decodeMs:Date.now()-decodeStart,sequence:frame.sequence,data:frame.data},[frame.data.buffer]);
      emitted=true;
    }
  }catch(error){painting.delete(channel);awaitingKey.add(channel);healthy.delete(channel);reportError(channel,error);}
  finally{if(!emitted)ack(channel,source);}
}
onmessage=function(event){
  var m=event.data;
  if(m.type==='connect'){
    var current=++generation;if(socket)socket.close();
    selected.forEach(function(channel){awaitingKey.add(channel);});
    var source=socket=new WebSocket(m.url);source.binaryType='arraybuffer';
    source.onopen=function(){if(current===generation)postMessage({type:'socket-open'});};
    source.onclose=function(){if(current===generation)postMessage({type:'socket-close'});};
    source.onerror=function(){if(current===generation)postMessage({type:'error',message:'Local media link failed'});};
    source.onmessage=function(event){if(current===generation)receiveFrame(event.data,source);};
  }
  if(m.type==='painted'){
    var owner=painting.get(m.channel);
    if(owner){painting.delete(m.channel);ack(m.channel,owner);}
  }
  if(m.type==='select'){
    var next=m.channels.slice(0,10);
    var nextSubtype=m.subtype===0?0:1,qualityChanged=nextSubtype!==subtype;
    try{
      for(var c of selected)if(!next.includes(c)||qualityChanged){decoder.close(c);awaitingKey.delete(c);healthy.delete(c);}
      for(var c of next)if(!selected.includes(c)||qualityChanged){decoder.open(c);awaitingKey.add(c);}
      selected=next;subtype=nextSubtype;
    }catch(error){reportError(null,error);}
  }
  if(m.type==='stop'){generation++;clearInterval(healthTimer);if(socket)socket.close();painting.clear();if(decoder)decoder.dispose();close();}
};
