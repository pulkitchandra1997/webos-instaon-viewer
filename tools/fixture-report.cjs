'use strict';

const fs=require('fs'),path=require('path');
const diagnosticsFactory=require('../src/diagnostics.js');

function runScenario(name,channels,quality,frames=30){
  let clock=100000;
  const diagnostics=diagnosticsFactory.create(()=>clock);
  for(let frame=0;frame<frames;frame++){
    for(let channel=1;channel<=channels;channel++){
      const decodeMs=quality==='HD'?6:2;
      const sourceSentAt=clock;
      diagnostics.received({channel},1);
      clock+=decodeMs;
      diagnostics.painted({channel,decodeMs,sourceSentAt},clock+1);
      clock+=1;
    }
  }
  const aggregate=diagnostics.snapshot().aggregate;
  return {name,channels,quality,frames,received:aggregate.received,painted:aggregate.painted,replaced:aggregate.replaced,maxQueueDepth:aggregate.maxQueueDepth,averageDecodeMs:aggregate.painted?aggregate.totalDecodeMs/aggregate.painted:0,averagePresentationLatencyMs:aggregate.latencySamples?aggregate.totalLatencyMs/aggregate.latencySamples:null,maxPresentationLatencyMs:aggregate.maxLatencyMs};
}

function runReport(frames=30){
  return {kind:'synthetic-fixture-report',warning:'Synthetic timings only; this is not a TV, recorder, cloud, FPS, or end-to-end latency measurement.',scenarios:[
    runScenario('wall-4',4,'SD',frames),runScenario('wall-8',8,'SD',frames),runScenario('wall-10',10,'SD',frames),runScenario('wall-16',16,'SD',frames),runScenario('single-enlarged',1,'HD',frames)
  ]};
}

if(require.main===module){
  const frames=Number(process.argv[2]||30);
  if(!Number.isInteger(frames)||frames<1||frames>600)throw new Error('frames must be an integer from 1 to 600');
  const output=runReport(frames),directory=path.join(__dirname,'..','reports');
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'fixture-performance.json');
  fs.writeFileSync(file,JSON.stringify(output,null,2)+'\n');
  console.log('Wrote ignored synthetic fixture report: '+path.relative(path.join(__dirname,'..'),file));
  console.log(JSON.stringify(output,null,2));
}

module.exports={runScenario,runReport};
