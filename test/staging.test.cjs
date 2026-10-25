'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {withFreshOutput}=require('../tools/staging.cjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'webos-staging-test-')),out=path.join(tmp,'build/direct');
try{
  fs.mkdirSync(path.join(out,'app'),{recursive:true});fs.writeFileSync(path.join(out,'app/obsolete.txt'),'old generated output');
  withFreshOutput(tmp,({app,service})=>{fs.writeFileSync(path.join(app,'index.html'),'new');fs.writeFileSync(path.join(service,'main.cjs'),'new');});
  assert(!fs.existsSync(path.join(out,'app/obsolete.txt')),'Obsolete entries must not survive a successful rebuild');
  assert.strictEqual(fs.readFileSync(path.join(out,'app/index.html'),'utf8'),'new');
  assert.throws(()=>withFreshOutput(tmp,({app})=>{fs.writeFileSync(path.join(app,'partial.txt'),'incomplete');throw new Error('fixture failure');}),/fixture failure/);
  assert.strictEqual(fs.readFileSync(path.join(out,'app/index.html'),'utf8'),'new','Failed rebuild must preserve completed output');
  assert(!fs.existsSync(path.join(out,'app/partial.txt')));
  assert.deepStrictEqual(fs.readdirSync(path.join(tmp,'build')),['direct'],'No private staging/previous copies should remain after success or failure');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('Fresh staging drops obsolete output and preserves the last complete build on failure.');
