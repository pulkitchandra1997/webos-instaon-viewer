'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {loadConfig,validateConfig,serviceConfig,publicProfile}=require('../tools/config.cjs');
const example=JSON.parse(fs.readFileSync(path.join(__dirname,'../config.example.json'),'utf8'));
assert.throws(()=>validateConfig(example),/recorder/);
const fixture=JSON.parse(JSON.stringify(example));
fixture.recorder={instaOnId:'fixture-device-123',username:'fixture-user',password:'fixture-password-123'};
assert.strictEqual(validateConfig(fixture).viewer.defaultView,10);
assert.deepStrictEqual(serviceConfig(fixture),{deviceid:'fixture-device-123',username:'fixture-user',password:'fixture-password-123',cloud:{host:'instaonserver.com',port:8800},cameraCount:10});
assert.deepStrictEqual(publicProfile(fixture),{cameraCount:10,defaultView:10});
assert(!JSON.stringify(publicProfile(fixture)).includes('fixture-'));
for(const field of ['instaOnId','username','password']){
  const invalid=JSON.parse(JSON.stringify(fixture));invalid.recorder[field]='';assert.throws(()=>validateConfig(invalid),/recorder/);
}
for(const count of [0,11,2.5]){const invalid=JSON.parse(JSON.stringify(fixture));invalid.viewer.cameraCount=count;assert.throws(()=>validateConfig(invalid),/cameraCount/);}
for(const port of [0,65536,'8800']){const invalid=JSON.parse(JSON.stringify(fixture));invalid.cloud.port=port;assert.throws(()=>validateConfig(invalid),/port/);}
const custom=JSON.parse(JSON.stringify(fixture));custom.cloud={host:'cloud.example.invalid',port:9000};custom.viewer.cameraCount=6;custom.viewer.defaultView=8;
assert.strictEqual(serviceConfig(custom).cloud.port,9000);assert.deepStrictEqual(publicProfile(custom),{cameraCount:6,defaultView:8});
custom.profiles=[{version:1,id:'home',name:'Home',cameraCount:6,defaultView:8,labels:{'1':'Front'},order:[1,2,3,4,5,6],fit:'fit',ratio:'auto'}];
assert.strictEqual(validateConfig(custom).profiles[0].id,'home');assert.strictEqual(publicProfile(custom).profiles[0].name,'Home');
const invalidProfiles=JSON.parse(JSON.stringify(custom));invalidProfiles.profiles[0].order=[1,1,2,3,4,5];assert.throws(()=>validateConfig(invalidProfiles),/profiles/);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'webos-config-test-'));
try{
  assert.throws(()=>loadConfig(tmp),/config.local.json/);
  fs.writeFileSync(path.join(tmp,'config.local.json'),'{fixture-password-123');
  assert.throws(()=>loadConfig(tmp),e=>!e.message.includes('fixture-password-123'));
  fs.writeFileSync(path.join(tmp,'config.local.json'),JSON.stringify(fixture));
  const loaded=loadConfig(tmp);assert.strictEqual(loaded.recorder.username,'fixture-user');assert.deepStrictEqual(loaded.profiles[0],{version:1,id:'default',name:'Default',cameraCount:10,defaultView:10,labels:{},order:[1,2,3,4,5,6,7,8,9,10],fit:'fit',ratio:'auto'});
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('Config validation, derived service config and safe public profile passed.');
