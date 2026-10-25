'use strict';
// This guard is defense-in-depth, not a guarantee. Review every staged file.
const fs=require('fs'),path=require('path'),cp=require('child_process');
function secretVariants(values){return [...new Set(values.filter(v=>typeof v==='string'&&v.length>=4).flatMap(v=>{
  const escaped=JSON.stringify(v).slice(1,-1);
  return [v,escaped,JSON.stringify(escaped).slice(1,-1),encodeURIComponent(v),Buffer.from(v).toString('base64'),Buffer.from(v).toString('hex'),v.split('').map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('')];
}))];}
function scanEntry(file,bytes,values){
  const findings=[],name=file.replace(/\\/g,'/');
  const add=rule=>findings.push({file:name,rule});
  if(/(^|\/)(config\.local\.json|[^/]*\.private\.json|\.login\.secret|\.env(?:\..*)?|node_modules|build|dist|reports|work|private|vendor|simulator|logs|captures)(\/|$)/i.test(name)||/\.(ipk|zip|7z|apk|exe|dll|so|wasm|pcap\w*|har|log|pem|key|mp4|hevc|yuv)$/i.test(name)||/(^|\/)module-libDecodeSDK\.js$/i.test(name))add('forbidden-path');
  if(/\.(png|jpe?g|gif|webp|avif|mov|avi|mkv)$/i.test(name)&&!['src/icon.png','src/largeIcon.png','src/logo-400.png'].includes(name))add('forbidden-path');
  // Check actual bytes even for images: secrets can also leak in image metadata.
  const text=bytes.toString('utf8');
  if(secretVariants(values).some(v=>text.toLowerCase().includes(v.toLowerCase())))add('private-value');
  if(/\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/.test(text))add('private-address');
  if(/[a-z]:[\\/](?:users|documents and settings)[\\/][^\s"<>]+/i.test(text))add('personal-path');
  if(/-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----|\bgh[pousr]_[a-zA-Z0-9]{30,}|\bgithub_pat_[a-zA-Z0-9_]{30,}/.test(text))add('credential-pattern');
  if(/(?:rtsp|https?):\/\/[^\s/]+:[^\s/]+@/i.test(text))add('embedded-url-credentials');
  return findings;
}
function git(root,args){const r=cp.spawnSync('git',args,{cwd:root,encoding:null,maxBuffer:32*1024*1024});if(r.status!==0)throw new Error('Git privacy inspection failed.');return r.stdout;}
function privateValues(root){
  const file=path.join(root,'config.local.json');if(!fs.existsSync(file))return [];
  let c;try{c=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(_){throw new Error('Cannot parse private config for privacy checking.');}
  const r=c.recorder||{},t=c.television||{},d=c.development||{};
  return [r.instaOnId,r.username,r.password,t.host,t.privateKeyPath,...Object.values(d).filter(v=>typeof v==='string'),...((c.privacy||{}).forbiddenStrings||[])].filter(v=>typeof v==='string'&&v.length>=4);
}
function inspect(root,history){
  const values=privateValues(root),findings=[];
  const entries=git(root,['ls-files','--stage','-z']).toString('utf8').split('\0').filter(Boolean);
  if(!entries.length)throw new Error('No staged/tracked files to inspect. Run git add on the reviewed source first.');
  for(const entry of entries){
    const m=entry.match(/^\d+ ([a-f0-9]+) \d\t([\s\S]+)$/);if(!m)throw new Error('Unexpected Git index entry.');
    findings.push(...scanEntry(m[2],git(root,['cat-file','blob',m[1]]),values));
    const actual=path.join(root,m[2]);if(fs.existsSync(actual))findings.push(...scanEntry(m[2],fs.readFileSync(actual),values));
  }
  if(history){
    const seen=new Set();
    for(const line of git(root,['rev-list','--objects','--all']).toString('utf8').trim().split('\n')){
      if(!line)continue;const sha=line.slice(0,40),file=line.slice(41);
      if(seen.has(sha)||git(root,['cat-file','-t',sha]).toString('utf8').trim()!=='blob')continue;seen.add(sha);
      findings.push(...scanEntry(file||'<history-blob>',git(root,['cat-file','blob',sha]),values));
    }
    findings.push(...scanEntry('<commit-metadata>',git(root,['log','--all','--format=%an%n%ae%n%cn%n%ce%n%B']),values));
  }
  return [...new Map(findings.map(f=>[f.file+'\0'+f.rule,f])).values()];
}
if(require.main===module){
  try{const findings=inspect(path.resolve(__dirname,'..'),process.argv.includes('--history'));if(findings.length){for(const f of findings)console.error('BLOCKED '+f.rule+' in '+f.file);process.exitCode=1;}else console.log('Privacy check passed for staged/tracked source'+(process.argv.includes('--history')?' and all reachable Git history':'')+'. Matched values are never printed.');}
  catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={scanEntry,secretVariants,inspect};
