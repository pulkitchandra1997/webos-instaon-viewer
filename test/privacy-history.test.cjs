'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const {inspect}=require('../tools/privacy.cjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'webos-history-test-')),secret='fixture-sensitive-history-123';
function git(args){const r=cp.spawnSync('git',args,{cwd:tmp,encoding:'utf8'});assert.strictEqual(r.status,0,'Fixture Git command failed');}
try{
  git(['init','-q']);git(['config','user.name','Fixture Contributor']);git(['config','user.email','fixture@example.invalid']);
  fs.writeFileSync(path.join(tmp,'.gitignore'),'config.local.json\n');
  fs.writeFileSync(path.join(tmp,'config.local.json'),'\uFEFF'+JSON.stringify({recorder:{password:secret}}));
  fs.writeFileSync(path.join(tmp,'notes.md'),secret);
  git(['add','.']);assert(inspect(tmp,false).some(f=>f.rule==='private-value'));
  git(['commit','-qm','Fixture with sensitive content']);
  fs.writeFileSync(path.join(tmp,'notes.md'),'Sanitized current content');git(['add','.']);git(['commit','-qm','Fixture current clean']);
  assert.deepStrictEqual(inspect(tmp,false),[]);
  assert(inspect(tmp,true).some(f=>f.rule==='private-value'),'A later cleanup must not hide a historical leak');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('Privacy guard checks Git history, not only the latest sanitized worktree.');
