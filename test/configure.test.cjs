'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {configure}=require('../tools/configure.cjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'webos-configure-test-'));
try{
  fs.writeFileSync(path.join(tmp,'config.example.json'),'{"fixture":true}');
  assert.strictEqual(configure(tmp),true);
  fs.writeFileSync(path.join(tmp,'config.local.json'),'preserve-existing-private-file');
  assert.strictEqual(configure(tmp),false);
  assert.strictEqual(fs.readFileSync(path.join(tmp,'config.local.json'),'utf8'),'preserve-existing-private-file');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('Configure creates once and never overwrites existing private configuration.');
