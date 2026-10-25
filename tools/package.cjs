'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const {loadConfig}=require('./config.cjs'),root=path.resolve(__dirname,'..');
try{
  const config=loadConfig(root),cli=path.resolve(root,config.development.webosCliDirectory||'private/missing-cli','bin/ares-package.js');
  if(!fs.existsSync(cli))throw new Error('Set development.webosCliDirectory to the installed @webos-tools/cli package directory.');
  if(!fs.existsSync(path.join(root,'build/direct/service/credentials.private.json')))throw new Error('Run npm run build first.');
  fs.mkdirSync(path.join(root,'build/release'),{recursive:true});
  // Preserve audited vendor glue byte-for-byte; the default packager rewrites JS.
  const r=cp.spawnSync(process.execPath,[cli,'--no-minify','build/direct/app','build/direct/service','-o','build/release'],{cwd:root,encoding:'utf8'});
  if(r.status!==0)throw new Error('webOS packager failed; verify the installed CLI and staged metadata.');
  require('./verify-package.cjs').verify();
  console.log('Private IPK generated in ignored build/release. Do not attach it to GitHub releases.');
}catch(error){console.error(error.message);process.exitCode=1;}
