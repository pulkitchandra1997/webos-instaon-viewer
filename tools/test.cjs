'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),root=path.resolve(__dirname,'..');
const files=fs.readdirSync(path.join(root,'test')).filter(f=>/\.test\.cjs$/.test(f)).map(f=>'test/'+f)
  .concat(fs.readdirSync(path.join(root,'services/org.webos.instaonviewer.service')).filter(f=>/\.test\.cjs$/.test(f)).map(f=>'services/org.webos.instaonviewer.service/'+f))
  .concat(['experiments/direct-tv/instaon-discovery.test.cjs','experiments/direct-tv/core-test.cjs']);
for(const file of files){const r=cp.spawnSync(process.execPath,[file],{cwd:root,encoding:'utf8',timeout:60000});if(r.status!==0){console.error('FAIL '+file+'\n'+r.stdout+'\n'+r.stderr);process.exit(1);}console.log('PASS '+file);}
console.log(files.length+' test files passed; offline fixtures only, no recorder, cloud or TV connections.');
