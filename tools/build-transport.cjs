'use strict';
const path=require('path'),esbuild=require('esbuild'),root=path.resolve(__dirname,'..');
esbuild.build({absWorkingDir:root,entryPoints:['experiments/direct-tv/transport-entry.cjs'],bundle:true,platform:'node',target:'node12',format:'cjs',outfile:path.join(root,'experiments/direct-tv/build/transport-node12.cjs'),
  plugins:[{name:'node12-dns',setup(build){build.onResolve({filter:/^(node:)?dns\/promises$/},()=>({path:path.join(root,'experiments/direct-tv/dns-promises.cjs')}));}}]
}).then(()=>console.log('Generated ignored Node 12 transport bundle.')).catch(()=>{console.error('Transport build failed; install locked dependencies first.');process.exitCode=1;});
