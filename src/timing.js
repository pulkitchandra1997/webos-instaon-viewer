(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CameraTiming=factory();}(typeof self!=='undefined'?self:this,function(){
  'use strict';
  var RTP_MOD=4294967296,NTP_EPOCH=2208988800;
  function bytes(value){return value instanceof ArrayBuffer?new Uint8Array(value):value;}
  function parseSenderReports(value){
    var data=bytes(value),reports=[];if(!data||data.byteLength<4)return reports;
    for(var offset=0;offset+4<=data.byteLength;){
      var view=new DataView(data.buffer,data.byteOffset+offset,data.byteLength-offset),version=view.getUint8(0)>>>6,words=view.getUint16(2);
      var length=(words+1)*4;if(version!==2||length<4||offset+length>data.byteLength)break;
      if(view.getUint8(1)===200&&length>=28){
        var seconds=view.getUint32(8),fraction=view.getUint32(12);
        reports.push({ssrc:view.getUint32(4),ntpSeconds:seconds,ntpFraction:fraction,ntpMs:(seconds-NTP_EPOCH)*1000+fraction/4294967296*1000,rtpTimestamp:view.getUint32(16)});
      }
      offset+=length;
    }
    return reports;
  }
  function ClockMapper(clockRate){
    if(!(clockRate>0))throw new Error('clockRate must be positive');
    this.clockRate=clockRate;this.lastExtended=null;this.anchorRtp=null;this.anchorNtpMs=null;
  }
  ClockMapper.prototype.extend=function(timestamp){
    timestamp=timestamp>>>0;if(this.lastExtended===null){this.lastExtended=timestamp;return timestamp;}
    var base=this.lastExtended-(this.lastExtended%RTP_MOD),candidate=base+timestamp;
    if(candidate-this.lastExtended>RTP_MOD/2)candidate-=RTP_MOD;
    if(this.lastExtended-candidate>RTP_MOD/2)candidate+=RTP_MOD;
    this.lastExtended=Math.max(this.lastExtended,candidate);return candidate;
  };
  ClockMapper.prototype.senderReport=function(report){
    if(!report||!Number.isFinite(report.ntpMs))return null;
    var extended=this.extend(report.rtpTimestamp);this.anchorRtp=extended;this.anchorNtpMs=report.ntpMs;return extended;
  };
  ClockMapper.prototype.map=function(timestamp){
    if(this.anchorRtp===null||this.anchorNtpMs===null)return null;
    return this.anchorNtpMs+(this.extend(timestamp)-this.anchorRtp)*1000/this.clockRate;
  };
  function AlignmentBuffer(channels,options){
    options=options||{};this.channels=channels;this.toleranceMs=Number.isFinite(options.toleranceMs)?options.toleranceMs:50;this.maxFrames=Number.isInteger(options.maxFrames)&&options.maxFrames>0?options.maxFrames:8;this.queues={};for(var i=0;i<channels.length;i++)this.queues[channels[i]]=[];
  }
  AlignmentBuffer.prototype.push=function(frame){if(!frame||this.queues[frame.channel]===undefined)return;var queue=this.queues[frame.channel];queue.push(frame);if(queue.length>this.maxFrames)queue.splice(0,queue.length-this.maxFrames);};
  AlignmentBuffer.prototype.poll=function(){
    var heads=this.channels.map(function(channel){return this.queues[channel][0];},this);
    if(heads.some(function(frame){return !frame||!Number.isFinite(frame.timestampMs);}))return {status:'unsynchronized',reason:'missing-timestamp'};
    var times=heads.map(function(frame){return frame.timestampMs;}),min=Math.min.apply(Math,times),max=Math.max.apply(Math,times);
    if(max-min>this.toleranceMs){this.queues[this.channels[times.indexOf(min)]].shift();return {status:'waiting',reason:'outside-tolerance',skipped:true};}
    var frames={};this.channels.forEach(function(channel){frames[channel]=this.queues[channel].shift();},this);return {status:'aligned',timestampMs:(min+max)/2,frames:frames};
  };
  return {parseSenderReports:parseSenderReports,ClockMapper:ClockMapper,AlignmentBuffer:AlignmentBuffer};
}));
