'use strict';
const fs=require('fs'),path=require('path');
const {validateProfile}=require('./profiles.cjs');
function invalid(field){throw new Error('Invalid configuration field: '+field);}
function text(value,field){if(typeof value!=='string'||!value.trim()||value.startsWith('REPLACE_'))invalid(field);}
function port(value,field){if(!Number.isInteger(value)||value<1||value>65535)invalid(field);}
function validateConfig(c,options){
  const o=options||{};
  if(!c||typeof c!=='object'||!c.recorder||!c.cloud||!c.viewer||!c.development||!c.television)invalid('structure');
  if(!o.allowPlaceholders)for(const field of ['instaOnId','username','password'])text(c.recorder[field],'recorder.'+field);
  text(c.cloud.host,'cloud.host');if(!/^[a-zA-Z0-9.-]+$/.test(c.cloud.host))invalid('cloud.host');port(c.cloud.port,'cloud.port');
  if(!Number.isInteger(c.viewer.cameraCount)||c.viewer.cameraCount<1||c.viewer.cameraCount>10)invalid('viewer.cameraCount');
  if(![4,8,10,16].includes(c.viewer.defaultView))invalid('viewer.defaultView');
  if(c.profiles!==undefined){if(!Array.isArray(c.profiles)||!c.profiles.length)invalid('profiles');try{c.profiles.forEach(validateProfile);}catch(error){throw new Error('Invalid configuration field: profiles ('+error.message+')');}}
  for(const field of ['simulatorExecutable','simulatorServiceDirectory','webosCliDirectory','decoderAssetsDirectory','webosSdkScript'])if(typeof c.development[field]!=='string')invalid('development.'+field);
  port(c.development.simulatorDebugPort,'development.simulatorDebugPort');
  if(typeof c.television.enabled!=='boolean')invalid('television.enabled');port(c.television.sshPort,'television.sshPort');
  for(const field of ['deviceName','host','username','privateKeyPath'])if(typeof c.television[field]!=='string')invalid('television.'+field);
  if(c.television.enabled){text(c.television.host,'television.host');text(c.television.username,'television.username');}
  if(c.privacy&&(!Array.isArray(c.privacy.forbiddenStrings)||c.privacy.forbiddenStrings.some(v=>typeof v!=='string'||v.length<4)))invalid('privacy.forbiddenStrings');
  return c;
}
function loadConfig(root,options){
  let c;
  try{c=JSON.parse(fs.readFileSync(path.join(root,'config.local.json'),'utf8').replace(/^\uFEFF/,''));}
  catch(error){throw new Error('Cannot read config.local.json; run npm run configure and edit it locally.');}
  return validateConfig(c,options);
}
function serviceConfig(c){return {deviceid:c.recorder.instaOnId,username:c.recorder.username,password:c.recorder.password,cloud:{host:c.cloud.host,port:c.cloud.port},cameraCount:c.viewer.cameraCount};}
function publicProfile(c){const profile={cameraCount:c.viewer.cameraCount,defaultView:c.viewer.defaultView};if(Array.isArray(c.profiles))profile.profiles=c.profiles.map(p=>({version:p.version,id:p.id,name:p.name,cameraCount:p.cameraCount,defaultView:p.defaultView,labels:p.labels,order:p.order,fit:p.fit,ratio:p.ratio}));return profile;}
module.exports={loadConfig,validateConfig,serviceConfig,publicProfile};
