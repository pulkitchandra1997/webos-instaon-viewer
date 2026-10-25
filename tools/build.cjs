'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),esbuild=require('esbuild');
const {loadConfig,serviceConfig,publicProfile}=require('./config.cjs');
const {withFreshOutput}=require('./staging.cjs');
const {secretVariants}=require('./privacy.cjs');
const root=path.resolve(__dirname,'..');
function build(){
  const config=loadConfig(root);
  // Validate every external prerequisite before writing credential-bearing outputs.
  const decoderDir=path.resolve(root,config.development.decoderAssetsDirectory||'private/decoder');
  const manifest=require('../assets/decoder-manifest.json');
  const assets=manifest.assets.map(entry=>{
    let bytes;try{bytes=fs.readFileSync(path.join(decoderDir,entry.path));}catch(_){throw new Error('Authorized decoder assets required; see docs/SETUP.md.');}
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Decoder integrity mismatch: '+entry.path);
    return {entry,bytes};
  });
  const cliDir=config.development.webosCliDirectory;
  const sdk=config.development.webosSdkScript|| (cliDir&&path.join(cliDir,'files/templates/tv-sdk-templates/bootplate-web/webOSTVjs-1.2.13/webOSTV.js'));
  if(!sdk||!fs.existsSync(path.resolve(root,sdk)))throw new Error('Set development.webosSdkScript or webosCliDirectory in config.local.json.');
  withFreshOutput(root,({app,service})=>{
  const serviceSource=path.join(root,'services/org.webos.instaonviewer.service');
  esbuild.buildSync({absWorkingDir:root,entryPoints:[path.join(serviceSource,'main.cjs')],bundle:true,platform:'node',target:'node12',format:'cjs',external:['webos-service','./credentials.private.json'],outfile:path.join(service,'main.cjs')});
  for(const name of ['package.json','services.json'])fs.copyFileSync(path.join(serviceSource,name),path.join(service,name));
  for(const [source,dest] of [['direct.html','index.html'],['direct.js','index.js'],['direct.css','styles.css'],['direct-worker.js','direct-worker.js'],['render.js','render.js'],['layout.js','layout.js'],['diagnostics.js','diagnostics.js'],['timing.js','timing.js'],['icon.svg','icon.svg'],['icon.png','icon.png'],['largeIcon.png','largeIcon.png']])fs.copyFileSync(path.join(root,'src',source),path.join(app,dest));
  for(const name of ['annexb.js','shared-hevc-decoder.js'])fs.copyFileSync(path.join(root,'experiments/direct-tv/decoder',name),path.join(app,name));
  fs.copyFileSync(path.resolve(root,sdk),path.join(app,'webOSTV.js'));
  fs.copyFileSync(path.join(root,'appinfo.json'),path.join(app,'appinfo.json'));
  fs.writeFileSync(path.join(app,'viewer-profile.js'),'window.VIEWER_PROFILE='+JSON.stringify(publicProfile(config))+';\n');
  for(const {entry,bytes} of assets)fs.writeFileSync(path.join(app,entry.path),bytes);
  for(const dir of [app,service])fs.copyFileSync(path.join(root,'experiments/direct-tv/THIRD_PARTY_NOTICES.md'),path.join(dir,'THIRD_PARTY_NOTICES.md'));
  fs.copyFileSync(path.join(root,'node_modules/ws/LICENSE'),path.join(service,'LICENSE-ws.txt'));
  const privateBytes=JSON.stringify(serviceConfig(config));
  fs.writeFileSync(path.join(service,'credentials.private.json'),privateBytes,{mode:0o600});
  // Never ship private connection fields in the frontend.
  for(const file of fs.readdirSync(app)){
    if(!/\.(js|html|json|css|md)$/.test(file))continue;
    const text=fs.readFileSync(path.join(app,file),'utf8');
    for(const secret of secretVariants(Object.values(config.recorder)))if(text.includes(secret))throw new Error('Private connection data found in frontend output; build must not be shared.');
  }
  });
  console.log('Built private app + on-device service in build/direct. Outputs contain credentials: NEVER publish them.');
}
if(require.main===module)try{build();}catch(error){console.error(error.message);process.exitCode=1;}
module.exports={build};
