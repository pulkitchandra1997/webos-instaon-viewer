'use strict';
const {EventEmitter} = require('events');
const {openInstaTunnel, RtspClient} = require('../../experiments/direct-tv/core/index.cjs');
const ignoreLateClientError=()=>{};

// Node 12 has no global AbortController. The connection core accepts this
// portable AbortSignal interface, including listener removal on settlement.
function cancellation() {
  const listeners = new Set();
  const signal = {aborted:false,
    addEventListener(name, listener) { if(name === 'abort') listeners.add(listener); },
    removeEventListener(name, listener) { if(name === 'abort') listeners.delete(listener); }};
  return {signal, abort() {
    if(signal.aborted)return;
    signal.aborted=true;
    const callbacks=Array.from(listeners);listeners.clear();
    callbacks.forEach(listener=>listener.call(signal,{type:'abort',target:signal}));
  }};
}
function aborted() { const error=new Error('Camera operation cancelled');error.code='ABORT_ERR';return error; }
function diagnosticCode(value, fallback) {
  if(typeof value==='string'&&value.length<=80&&/^(ERR_[A-Z0-9_]+|E[A-Z0-9_]+|ABORT_ERR)$/.test(value))return value;
  const known={'peer silent':'ERR_PTCP_PEER_SILENT','stalled':'ERR_PTCP_STALLED',
    'peer stopped acknowledging':'ERR_PTCP_ACK_TIMEOUT','closed':'ERR_PTCP_CLOSED'};
  return Object.prototype.hasOwnProperty.call(known,value)?known[value]:fallback;
}
function interruptible(promise, signal) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,value)=>{
      if(settled)return;settled=true;signal.removeEventListener('abort',cancel);
      error ? reject(error) : resolve(value);
    };
    const cancel=()=>finish(aborted());
    signal.addEventListener('abort',cancel);
    Promise.resolve(promise).then(value=>finish(null,value),error=>finish(error));
    if(signal.aborted)cancel();
  });
}
function pause(ms, signal) {
  if(!ms)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    let timer;
    const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(aborted());};
    timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);
    signal.addEventListener('abort',cancel);if(signal.aborted)cancel();
  });
}

class CameraEngine extends EventEmitter {
  constructor(credentials, dependencies) {
    super();const d=dependencies||{};
    this.credentials=credentials;this.open=d.open||openInstaTunnel;this.Rtsp=d.Rtsp||RtspClient;
    this.now=d.now||Date.now;
    this.staggerMs=d.staggerMs===undefined?120:d.staggerMs;
    this.retryBaseMs=d.retryBaseMs===undefined?1000:d.retryBaseMs;
    this.retryMaxMs=d.retryMaxMs===undefined?15000:d.retryMaxMs;
    this.firstFrameTimeoutMs=d.firstFrameTimeoutMs===undefined?15000:d.firstFrameTimeoutMs;
    this.staleMs=d.staleMs===undefined?15000:d.staleMs;
    this.closeTimeoutMs=d.closeTimeoutMs===undefined?500:d.closeTimeoutMs;
    this.entries=new Map();this.desired=new Map();this.closed=false;this.connection=null;
    this.opening=null;this.generation=0;this.cancel=cancellation();this.closing=null;this.transportFailed=false;
    this.transportCode=null;this.startupBusy=false;this.startupQueue=[];this.connectionStage='opening';this.connectionFailure=null;
  }
  current(entry) {
    return !this.closed && this.entries.get(entry.channel)===entry && this.desired.get(entry.channel)===entry.subtype;
  }
  async ensureConnection() {
    if(this.closed)return null;
    if(this.transportFailed){const error=new Error('InstaOn connection closed');error.code=this.transportCode;throw error;}
    if(this.connection)return this.connection;
    if(!this.opening) {
      const signal=this.cancel.signal;
      // Observe even an opener which ignores cancellation. Its late result is
      // closed, never installed into an engine which has already shut down.
      const raw=Promise.resolve().then(()=>{
        if(signal.aborted)throw aborted();
        this.connectionFailure=null;
        return this.open(this.credentials,{signal,cloud:this.credentials.cloud,onProgress:stage=>{if(typeof stage==='string'&&/^[a-z-]{1,32}$/.test(stage))this.connectionStage=stage;}});
      }).then(connection=>{
        if(this.closed||signal.aborted){connection.tunnel.close();return null;}
        this.connection=connection;
        this.tunnelClosed=reason=>{
          if(this.closed||this.connection!==connection||this.transportFailed)return;
          this.transportFailed=true;
          this.transportCode=this.transportReason(reason)||'ERR_INSTAON_CLOSED';
          const error=new Error('InstaOn connection closed');error.code=this.transportCode;
          this.emit('error',error);
        };
        connection.tunnel.on('closed',this.tunnelClosed);
        return connection;
      });
      const pending=interruptible(raw,signal).catch(error=>{this.connectionFailure={code:diagnosticCode(error.code,'ERR_INSTAON_HANDSHAKE'),stage:this.connectionStage};throw error;}).finally(()=>{if(this.opening===pending)this.opening=null;});
      this.opening=pending;
    }
    return this.opening;
  }
  transportReason(reason) {
    const tunnel=this.connection&&this.connection.tunnel;
    const session=tunnel&&tunnel.session;
    return diagnosticCode(session&&session.closedReason,null)||diagnosticCode(reason,null)||
      diagnosticCode(tunnel&&tunnel.closeReason,null)||this.transportCode;
  }
  acquireStartup(signal) {
    return new Promise((resolve,reject)=>{
      const waiter={signal};
      const cancel=()=>{
        const index=this.startupQueue.indexOf(waiter);
        if(index>=0)this.startupQueue.splice(index,1);
        signal.removeEventListener('abort',cancel);reject(aborted());
      };
      waiter.grant=()=>{
        signal.removeEventListener('abort',cancel);
        if(signal.aborted){reject(aborted());this.drainStartup();return;}
        this.startupBusy=true;
        let released=false;
        resolve(()=>{
          if(released)return;released=true;this.startupBusy=false;this.drainStartup();
        });
      };
      signal.addEventListener('abort',cancel);
      if(signal.aborted){cancel();return;}
      this.startupQueue.push(waiter);this.drainStartup();
    });
  }
  drainStartup() {
    if(this.startupBusy)return;
    const next=this.startupQueue.shift();if(next)next.grant();
  }
  async select(channels, subtype) {
    if(!Array.isArray(channels)||channels.length>16||channels.some(n=>!Number.isInteger(n)||n<1||n>64))throw new Error('Invalid channel selection');
    if(subtype!==0&&subtype!==1)throw new Error('Invalid stream subtype');
    if(this.closed)return;
    ++this.generation;
    this.desired=new Map(channels.map(channel=>[channel,subtype]));
    const retired=[];
    for(const entry of Array.from(this.entries.values())) {
      if(this.desired.get(entry.channel)!==entry.subtype) {
        this.entries.delete(entry.channel);
        retired.push(this.dispose(entry));
      }
    }
    await Promise.all([this.reconcile(),Promise.all(retired)]);
  }
  // Called by the service's existing two-second tick. There is deliberately no
  // retry timer per camera. Each channel has at most one attempt and one entry.
  async reconcile() {
    if(this.closed||!this.desired.size)return;
    const generation=this.generation;
    let connection;
    try {connection=await this.ensureConnection();}
    catch(error){if(this.closed||error.code==='ABORT_ERR')return;throw error;}
    if(this.closed||generation!==this.generation||!connection)return;
    const now=this.now(),jobs=[];
    let stagger=0;
    for(const [channel,subtype] of this.desired) {
      let entry=this.entries.get(channel);
      if(entry&&!entry.failed) {
        const anchor=entry.frames?entry.lastFrame:entry.startedAt;
        const deadline=entry.frames?this.staleMs:this.firstFrameTimeoutMs;
        if(entry.started && now-anchor>=deadline)this.fail(entry,'stalled','FRAME_TIMEOUT');
      }
      if(entry&&(!entry.failed||now<entry.nextRetryAt)) {
        if(entry.job)jobs.push(entry.job);
        continue;
      }
      const previous=entry;
      entry={channel,subtype,frames:0,lastFrame:0,startedAt:now,started:false,state:'queued',
        retryCount:previous?previous.retryCount:0,nextRetryAt:0,failed:false,cancel:cancellation(),client:null,stream:null,
        failureCode:previous?previous.failureCode:null,failureStage:previous?previous.failureStage:null,stage:'queued'};
      // Reserve synchronously BEFORE any await. Overlapping select/reconcile
      // calls consequently share the same attempt, instead of opening twice.
      this.entries.set(channel,entry);
      entry.job=this.startEntry(entry,connection,stagger?this.staggerMs:0,previous).finally(()=>{entry.job=null;});
      jobs.push(entry.job);stagger++;
    }
    await Promise.all(jobs);
  }
  async startEntry(entry, connection, stagger, previous) {
    const signal=entry.cancel.signal;
    let release;
    try {
      if(previous)await this.dispose(previous);
      // The recorder tolerates simultaneous media realms, but negotiations must
      // not overlap. Release this gate after PLAY, never at realm/media close.
      release=await this.acquireStartup(signal);
      await pause(stagger,signal);
      if(!this.current(entry)||signal.aborted)return;
      entry.started=true;entry.startedAt=this.now();entry.state='starting';entry.stage='bind';
      const bind=Promise.resolve().then(()=>connection.tunnel.connect((connection.info&&connection.info.rtspport)||554,{signal}));
      const owned=bind.then(stream=>{
        if(!this.current(entry)||signal.aborted){stream.destroy();return null;}
        entry.stream=stream;return stream;
      });
      const stream=await interruptible(owned,signal);
      if(!stream||!this.current(entry)||signal.aborted)return;
      const client=new this.Rtsp(stream,{url:'rtsp://127.0.0.1/cam/realmonitor?channel='+entry.channel+'&subtype='+entry.subtype,
        user:this.credentials.username,pass:this.credentials.password,timeoutMs:16000});
      entry.client=client;
      entry.stage='rtsp-start';
      // Some adapters report an asynchronous error after destroy/TEARDOWN.
      // Leave this stateless guard when removing the owned event handlers.
      client.on('error',ignoreLateClientError);
      entry.handlers={
        frame:frame=>{
          if(!this.current(entry)||entry.failed)return;
          entry.frames++;entry.lastFrame=this.now();entry.retryCount=0;entry.state='playing';
          this.emit('frame',entry.channel,Object.assign({},frame,{subtype:entry.subtype}));
        },
        error:error=>this.fail(entry,'error',diagnosticCode(error&&error.code,'STREAM_FAILED')),
        close:error=>this.fail(entry,'closed',diagnosticCode(error&&error.code,'STREAM_CLOSED'))
      };
      for(const name of Object.keys(entry.handlers))client.on(name,entry.handlers[name]);
      await interruptible(Promise.resolve().then(()=>client.start()),signal);
      if(this.current(entry)&&!entry.failed&&!signal.aborted) {
        entry.state='playing';entry.stage='media';this.emit('channel',{channel:entry.channel,state:'playing'});
      }
    } catch(error) {
      // A stale attempt may reject after its replacement has started. It must
      // never fetch or delete whichever entry now happens to occupy the slot.
      if(this.current(entry)&&!entry.failed&&error.code!=='ABORT_ERR')this.fail(entry,'error',diagnosticCode(error.code,'STREAM_FAILED'));
    } finally {if(release)release();}
  }
  fail(entry, state, code) {
    if(!this.current(entry)||entry.failed)return;
    entry.failed=true;entry.state=state;entry.retryCount=Math.min(entry.retryCount+1,16);
    entry.failureCode=code;entry.failureStage=entry.stage;
    entry.nextRetryAt=this.now()+Math.min(this.retryMaxMs,this.retryBaseMs*Math.pow(2,entry.retryCount-1));
    this.dispose(entry);
    this.emit('channel',{channel:entry.channel,state,code,stage:entry.failureStage,transportCode:this.transportReason(),retryAt:entry.nextRetryAt});
  }
  dispose(entry) {
    if(entry.disposing)return entry.disposing;
    const client=entry.client,stream=entry.stream;
    if(client&&entry.handlers)for(const name of Object.keys(entry.handlers))client.removeListener(name,entry.handlers[name]);
    entry.handlers=null;entry.cancel.abort();
    // Break pending RTSP reads before TEARDOWN; do not let a missing response
    // block a view switch or cancellation for the client's 16-second timeout.
    if(stream&&!stream.destroyed)try{stream.destroy();}catch(_){}
    let cleanup;
    try{cleanup=client?Promise.resolve(client.close()).catch(()=>{}):Promise.resolve();}
    catch(_){cleanup=Promise.resolve();}
    entry.client=null;entry.stream=null;
    entry.disposing=new Promise(resolve=>{
      const timer=setTimeout(resolve,this.closeTimeoutMs);
      cleanup.then(()=>{clearTimeout(timer);resolve();});
    });
    return entry.disposing;
  }
  stats() {
    return Array.from(this.desired,([channel,subtype])=>{
      const e=this.entries.get(channel);
      return {channel,subtype,frames:e?e.frames:0,lastFrame:e?e.lastFrame:0,
        startedAt:e?e.startedAt:0,state:e?e.state:'opening',retryCount:e?e.retryCount:0,nextRetryAt:e?e.nextRetryAt:0,
        stage:e?e.stage:this.connectionStage,failureCode:e?e.failureCode:(this.connectionFailure&&this.connectionFailure.code),failureStage:e?e.failureStage:(this.connectionFailure&&this.connectionFailure.stage),transportCode:this.transportReason()};
    });
  }
  close() {
    if(this.closing)return this.closing;
    this.closed=true;++this.generation;this.cancel.abort();
    const entries=Array.from(this.entries.values());this.entries.clear();this.desired.clear();
    if(this.connection) {
      if(this.tunnelClosed)this.connection.tunnel.removeListener('closed',this.tunnelClosed);
      this.connection.tunnel.close();this.connection=null;
    }
    this.closing=Promise.all(entries.map(entry=>this.dispose(entry))).then(()=>undefined);
    return this.closing;
  }
}
module.exports={CameraEngine};
