'use strict';

const VIEWS=[4,8,10,16],RATIOS=['auto','8:9','4:3','16:9'],FITS=['fit','fill'];
function fail(field){throw new Error('Invalid profile field: '+field);}
function text(value,field){if(typeof value!=='string'||!value.trim()||value.length>64)fail(field);}
function validateProfile(profile){
  if(!profile||typeof profile!=='object')fail('profile');
  if(profile.version!==1)fail('version');
  if(typeof profile.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(profile.id))fail('id');
  text(profile.name,'name');
  if(!Number.isInteger(profile.cameraCount)||profile.cameraCount<1||profile.cameraCount>10)fail('cameraCount');
  if(!VIEWS.includes(profile.defaultView))fail('defaultView');
  if(!Array.isArray(profile.order)||profile.order.length!==profile.cameraCount||new Set(profile.order).size!==profile.order.length||profile.order.some(channel=>!Number.isInteger(channel)||channel<1||channel>profile.cameraCount))fail('order');
  if(!profile.labels||typeof profile.labels!=='object'||Array.isArray(profile.labels))fail('labels');
  for(const [channel,label] of Object.entries(profile.labels)){if(!/^([1-9]|10)$/.test(channel)||Number(channel)>profile.cameraCount)fail('labels.'+channel);text(label,'labels.'+channel);}
  if(!FITS.includes(profile.fit))fail('fit');
  if(!RATIOS.includes(profile.ratio))fail('ratio');
  return profile;
}
function migrateConfig(config){
  if(!config||typeof config!=='object'||!config.viewer)fail('config');
  if(Array.isArray(config.profiles)&&config.profiles.length)return Object.assign({},config,{profiles:config.profiles.map(validateProfile)});
  const count=config.viewer.cameraCount,view=config.viewer.defaultView;
  const profile={version:1,id:'default',name:'Default',cameraCount:count,defaultView:view,labels:{},order:Array.from({length:count},(_,i)=>i+1),fit:'fit',ratio:'auto'};
  validateProfile(profile);return Object.assign({},config,{profiles:[profile]});
}
function exportProfile(profile){
  const safe=validateProfile(Object.assign({},profile,{username:undefined,password:undefined}));
  return JSON.stringify(safe,null,2)+'\n';
}
module.exports={validateProfile,migrateConfig,exportProfile};
