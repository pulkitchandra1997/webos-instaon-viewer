'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {assertNoLinks}=require('./simulator.cjs');
function withFreshOutput(root,produce){
  const parent=path.resolve(root,'build'),out=path.join(parent,'direct');
  assertNoLinks(parent);assertNoLinks(out);fs.mkdirSync(parent,{recursive:true});
  const staging=fs.mkdtempSync(path.join(parent,'direct-staging-'));
  const previous=path.join(parent,'direct-previous-'+crypto.randomUUID());
  function removeGenerated(target){
    // Only this call's two exact temporary children can ever be removed.
    if(![staging,previous].includes(target)||path.dirname(target)!==parent)throw new Error('Unsafe generated build cleanup target.');
    if(!fs.existsSync(target))return;assertNoLinks(target);
    const resolved=fs.realpathSync(target),resolvedParent=fs.realpathSync(parent);
    if(path.dirname(resolved)!==resolvedParent)throw new Error('Generated build cleanup escaped its build directory.');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
  try{
    const app=path.join(staging,'app'),service=path.join(staging,'service');fs.mkdirSync(app);fs.mkdirSync(service);
    produce({app,service});
    const hadOutput=fs.existsSync(out);
    if(hadOutput)fs.renameSync(out,previous);
    try{fs.renameSync(staging,out);}catch(error){if(hadOutput)fs.renameSync(previous,out);throw error;}
    removeGenerated(previous);
  }finally{removeGenerated(staging);}
}
module.exports={withFreshOutput};
