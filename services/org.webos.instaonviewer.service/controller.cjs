'use strict';
const {CameraEngine}=require('./engine.cjs');
const {createBridge}=require('./bridge.cjs');
class ViewerController {
  constructor(credentials,dependencies){
    const d=dependencies||{};this.credentials=credentials;this.Engine=d.Engine||CameraEngine;this.createBridge=d.createBridge||createBridge;
    this.cameraCount=Number.isInteger(credentials.cameraCount)&&credentials.cameraCount>=1&&credentials.cameraCount<=10?credentials.cameraCount:10;
    this.session=null;this.sequence=0;this.channels=Array.from({length:this.cameraCount},(_,i)=>i+1);this.subtype=1;
  }
  current(s){return this.session===s&&!s.closed;}
  respond(s,payload){if(this.current(s))try{s.owner.respond(Object.assign({returnValue:true,subscribed:true},payload));}catch(error){this.stop();}}
  async open(owner){
    if(this.session&&!this.session.closed){
      if(this.session.owner.uniqueToken!==owner.uniqueToken){owner.respond({returnValue:false,errorText:'Viewer already active'});return;}
      this.respond(this.session,{state:'connecting',mediaUrl:this.session.bridge&&this.session.bridge.url});return;
    }
    const s={id:++this.sequence,owner,closed:false,bridge:null,engine:null,retry:null,timer:null,attempts:0};this.session=s;
    try{
      const bridge=await this.createBridge();
      if(!this.current(s)){await bridge.close();return;}
      s.bridge=bridge;this.respond(s,{state:'connecting',mediaUrl:bridge.url,protocol:1});
      s.timer=setInterval(()=>{
        if(!this.current(s)||!s.engine)return;
        this.respond(s,{state:'stats',channels:s.engine.stats()});
        s.engine.reconcile().catch(()=>this.retry(s));
      },2000);
      await this.attempt(s);
    }catch(error){if(this.current(s))this.retry(s);}
  }
  async attempt(s){
    if(!this.current(s))return;
    const engine=new this.Engine(this.credentials);s.engine=engine;
    engine.on('frame',(channel,frame)=>{if(this.current(s)&&s.engine===engine){s.attempts=0;s.bridge.frame(channel,frame);}});
    engine.on('channel',channel=>{if(s.engine===engine)this.respond(s,{state:'channel',channel});});
    engine.on('error',()=>{if(s.engine===engine)this.retry(s);});
    try{await engine.select(this.channels,this.subtype);if(this.current(s)&&s.engine===engine)this.respond(s,{state:'playing'});}
    catch(error){if(this.current(s)&&s.engine===engine)this.retry(s);}
  }
  retry(s){
    if(!this.current(s)||s.retry)return;
    this.respond(s,{state:'reconnecting'});
    const delay=Math.min(30000,3000*Math.pow(2,Math.min(s.attempts++,4)));
    s.retry=setTimeout(async()=>{
      s.retry=null;if(!this.current(s))return;
      const old=s.engine;s.engine=null;if(old)await old.close();
      if(!this.current(s))return;
      if(!s.bridge){this.session=null;return this.open(s.owner);}
      s.bridge.reset();this.respond(s,{state:'connecting',mediaUrl:s.bridge.url,protocol:1,reset:true});
      await this.attempt(s);
    },delay);
  }
  async select(payload,message){
    const channels=payload.channels,subtype=Array.isArray(channels)&&channels.length===1&&payload.subtype===0?0:1;
    if(!Array.isArray(channels)||!channels.length||channels.length>this.cameraCount||channels.some(n=>!Number.isInteger(n)||n<1||n>this.cameraCount)){
      message.respond({returnValue:false,errorText:'Invalid camera selection'});return;
    }
    this.channels=Array.from(new Set(channels));this.subtype=subtype;
    const s=this.session;
    if(s&&this.current(s)&&s.engine)await s.engine.select(this.channels,this.subtype).catch(()=>this.retry(s));
    message.respond({returnValue:true});
  }
  stats(){return this.session&&this.session.engine?this.session.engine.stats():[];}
  diagnostics(){return this.session&&this.session.bridge?this.session.bridge.stats():null;}
  async stop(token){
    const s=this.session;if(!s||(token&&s.owner.uniqueToken!==token))return;
    s.closed=true;this.session=null;clearInterval(s.timer);clearTimeout(s.retry);
    const engine=s.engine;s.engine=null;if(engine)await engine.close();
    if(s.bridge)await s.bridge.close();s.bridge=null;
  }
}
module.exports={ViewerController};
