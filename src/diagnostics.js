(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.CameraDiagnostics=factory();
}(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function finiteNonNegative(value){return Number.isFinite(value)&&value>=0;}
  function channelStats(){return {received:0,painted:0,replaced:0,totalDecodeMs:0,maxDecodeMs:0,latencySamples:0,totalLatencyMs:0,maxLatencyMs:0,lastPresentedAt:0};}
  function create(now){
    now=typeof now==='function'?now:Date.now;
    var aggregate={received:0,painted:0,replaced:0,maxQueueDepth:0,totalDecodeMs:0,maxDecodeMs:0,latencySamples:0,totalLatencyMs:0,maxLatencyMs:0};
    var channels={};
    function stats(channel){var key=String(channel);return channels[key]||(channels[key]=channelStats());}
    function received(frame,queueDepth){
      var channel=frame&&frame.channel;if(!Number.isInteger(channel)||channel<1)return;
      var current=stats(channel);current.received++;aggregate.received++;
      if(Number.isFinite(queueDepth)&&queueDepth>=0){aggregate.maxQueueDepth=Math.max(aggregate.maxQueueDepth,queueDepth);}
    }
    function replaced(channel){
      if(!Number.isInteger(channel)||channel<1)return;
      stats(channel).replaced++;aggregate.replaced++;
    }
    function painted(frame,presentedAt){
      var channel=frame&&frame.channel;if(!Number.isInteger(channel)||channel<1)return;
      var current=stats(channel);current.painted++;aggregate.painted++;
      var decodeMs=Number(frame.decodeMs);
      if(finiteNonNegative(decodeMs)){current.totalDecodeMs+=decodeMs;current.maxDecodeMs=Math.max(current.maxDecodeMs,decodeMs);aggregate.totalDecodeMs+=decodeMs;aggregate.maxDecodeMs=Math.max(aggregate.maxDecodeMs,decodeMs);}
      var source=Number(frame.sourceSentAt),present=Number.isFinite(presentedAt)?presentedAt:now();
      if(source>0&&finiteNonNegative(present)&&present>=source){var latency=present-source;current.latencySamples++;current.totalLatencyMs+=latency;current.maxLatencyMs=Math.max(current.maxLatencyMs,latency);aggregate.latencySamples++;aggregate.totalLatencyMs+=latency;aggregate.maxLatencyMs=Math.max(aggregate.maxLatencyMs,latency);}
      current.lastPresentedAt=present;
    }
    function clone(value){return JSON.parse(JSON.stringify(value));}
    return {metrics:aggregate,channels:channels,received:received,replaced:replaced,painted:painted,snapshot:function(){return {aggregate:clone(aggregate),channels:clone(channels)};}};
  }
  return {create:create};
}));
