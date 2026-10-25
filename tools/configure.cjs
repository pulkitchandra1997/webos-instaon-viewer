'use strict';
const fs=require('fs'),path=require('path');
function configure(root){
  try{fs.copyFileSync(path.join(root,'config.example.json'),path.join(root,'config.local.json'),fs.constants.COPYFILE_EXCL);return true;}
  catch(error){if(error.code==='EEXIST')return false;throw new Error('Could not create private config file.');}
}
if(require.main===module)try{
  console.log(configure(path.resolve(__dirname,'..'))?'Created ignored config.local.json. Edit it locally; never paste its contents into logs or issues.':'config.local.json already exists; left unchanged.');
}catch(error){console.error(error.message);process.exitCode=1;}
module.exports={configure};
