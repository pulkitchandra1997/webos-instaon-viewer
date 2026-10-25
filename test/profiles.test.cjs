'use strict';
const assert=require('assert');
const profiles=require('../tools/profiles.cjs');
const base={viewer:{cameraCount:10,defaultView:10}};
const migrated=profiles.migrateConfig(base);
assert.strictEqual(migrated.profiles.length,1);
assert.deepStrictEqual(migrated.profiles[0],{version:1,id:'default',name:'Default',cameraCount:10,defaultView:10,labels:{},order:[1,2,3,4,5,6,7,8,9,10],fit:'fit',ratio:'auto'});
const custom={version:1,id:'home',name:'Home',cameraCount:4,defaultView:4,labels:{'1':'Front'},order:[1,2,3,4],fit:'fill',ratio:'4:3'};
assert.deepStrictEqual(profiles.validateProfile(custom),custom);
const exported=profiles.exportProfile(Object.assign({},custom,{username:'secret',password:'secret'}));
assert(!exported.includes('secret'));
assert.deepStrictEqual(JSON.parse(exported),custom);
for(const invalid of [
  Object.assign({},custom,{id:'bad id'}),
  Object.assign({},custom,{cameraCount:11}),
  Object.assign({},custom,{defaultView:2}),
  Object.assign({},custom,{order:[1,1,2,3]}),
  Object.assign({},custom,{labels:{'5':'outside'}}),
  Object.assign({},custom,{ratio:'21:9'})
])assert.throws(()=>profiles.validateProfile(invalid));
console.log('PASS versioned non-secret profile migration, validation, and export');
