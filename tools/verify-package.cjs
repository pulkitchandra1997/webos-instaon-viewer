'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto'),assert=require('assert');
const root=path.resolve(__dirname,'..');
function verify(){
  const info=require('../appinfo.json'),file=path.join(root,'build/release',info.id+'_'+info.version+'_all.ipk'),bytes=fs.readFileSync(file);
  assert.strictEqual(bytes.toString('ascii',0,8),'!<arch>\n');const members=new Map();
  for(let o=8;o+60<=bytes.length;){const h=bytes.subarray(o,o+60),size=Number(h.toString('ascii',48,58).trim()),name=h.toString('ascii',0,16).trim().replace(/\/$/,'');assert(Number.isFinite(size)&&size>=0);members.set(name,bytes.subarray(o+60,o+60+size));o+=60+size+(size%2);}
  const data=zlib.gunzipSync(members.get('data.tar.gz')),files=new Map();
  for(let o=0;o+512<=data.length;){const h=data.subarray(o,o+512);if(h.every(b=>b===0))break;const name=h.toString('utf8',0,100).split('\0')[0],prefix=h.toString('utf8',345,500).split('\0')[0],size=parseInt(h.toString('ascii',124,136).replace(/\0/g,'').trim()||'0',8);assert(Number.isFinite(size)&&size>=0);if(h[156]===0||h[156]===48)files.set((prefix?prefix+'/':'')+name,data.subarray(o+512,o+512+size));o+=512+Math.ceil(size/512)*512;}
  function find(suffix){const entries=Array.from(files).filter(([n])=>n.endsWith(suffix));assert.strictEqual(entries.length,1,'Missing/ambiguous packaged file '+suffix);return entries[0][1];}
  assert.strictEqual(JSON.parse(find('/'+info.id+'/appinfo.json')).version,info.version);
  for(const [key,size] of [['icon',80],['largeIcon',130]]){const png=find('/'+info.id+'/'+info[key]);assert.strictEqual(png.toString('hex',0,8),'89504e470d0a1a0a');assert.strictEqual(png.readUInt32BE(16),size);assert.strictEqual(png.readUInt32BE(20),size);}
  for(const name of ['main.cjs','credentials.private.json'])assert(find('/'+info.id+'.service/'+name).equals(fs.readFileSync(path.join(root,'build/direct/service',name))),'Packaged service differs from staged build');
  assert(!Array.from(files.keys()).some(n=>/\.(exe|dll|so)$/i.test(n)),'Unexpected native binary');
  for(const asset of require('../assets/decoder-manifest.json').assets)assert.strictEqual(crypto.createHash('sha256').update(find('/'+info.id+'/'+asset.path)).digest('hex'),asset.sha256);
  const r=require('./config.cjs').loadConfig(root).recorder;
  for(const [name,value] of files){if(!name.includes('/applications/'+info.id+'/'))continue;for(const secret of Object.values(r))if(secret.length>=4)assert(!value.includes(Buffer.from(secret)),'Private connection data in frontend');}
  console.log('Private package verified: metadata, icons, service config equality and decoder integrity. Do not publish the IPK.');
}
if(require.main===module)try{verify();}catch(_){console.error('Package verification failed; inspect private build locally without publishing it.');process.exitCode=1;}
module.exports={verify};
