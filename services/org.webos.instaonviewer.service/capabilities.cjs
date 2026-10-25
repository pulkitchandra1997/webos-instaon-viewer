'use strict';

function capabilities(){
  return {
    version:1,
    liveView:true,
    qualitySwitch:true,
    multiViewMax:10,
    ptz:false,
    audio:false,
    talk:false,
    playback:false,
    snapshots:false,
    discovery:false,
    unsupportedReason:'Optional controls require separately authorized protocol, codec, permission, and licensing evidence.'
  };
}

module.exports={capabilities};
