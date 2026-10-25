(function(){
  'use strict';
  var grid=document.getElementById('grid'),status=document.getElementById('status'),message=document.getElementById('message'),summary=document.getElementById('summary');
  var profileData=window.VIEWER_PROFILE||{},profiles=Array.isArray(profileData.profiles)&&profileData.profiles.length?profileData.profiles:[profileData],profileId;try{profileId=localStorage.getItem('direct-profile');}catch(error){}
  var profile=profiles.find(function(item){return item&&item.id===profileId;})||profiles[0]||{},cameraCount=Number.isInteger(profile.cameraCount)&&profile.cameraCount>=1&&profile.cameraCount<=10?profile.cameraCount:10;
  var tiles=[],view=[4,8,10,16].indexOf(profile.defaultView)>=0?profile.defaultView:10,expanded=0,worker,subscription,ready=false,paused=false,mediaUrl='',retry,closing=false,background=false,epoch=0,startedAt=0,lastFrameAt=0;
  var settings={fit:profile.fit==='fill'?'fill':'fit',ratio:['auto','8:9','4:3','16:9'].indexOf(profile.ratio)>=0?profile.ratio:'auto'};try{Object.assign(settings,JSON.parse(localStorage.getItem('direct-settings')||'{}'));}catch(error){}
  var diagnostics=window.CameraDiagnostics&&window.CameraDiagnostics.create?window.CameraDiagnostics.create(Date.now):null;
  var metrics=diagnostics?diagnostics.metrics:{received:0,painted:0,replaced:0,maxQueueDepth:0,maxProcessingMs:0,wasmBytes:0,presentationBatches:0,captureSync:'unverified'};
  window.cameraDiagnostics={metrics:metrics,channels:tiles,measurements:diagnostics?function(){return diagnostics.snapshot();}:function(){return {aggregate:metrics,channels:{}};}};
  var pendingPaints=new Map(),paintHandle=null;
  function clearPresentation(){if(paintHandle!==null)cancelAnimationFrame(paintHandle);paintHandle=null;pendingPaints.clear();}
  function channelOrder(){return Array.isArray(profile.order)&&profile.order.length===cameraCount?profile.order:Array.from({length:cameraCount},function(_,i){return i+1;});}
  function selected(){var order=channelOrder();return expanded?[expanded]:order.slice(0,Math.min(view,cameraCount));}
  function quality(){return expanded?0:1;}
  function call(method,parameters,onSuccess){return webOS.service.request('luna://org.webos.instaonviewer.service/',{method:method,parameters:parameters||{},onSuccess:onSuccess||function(){},onFailure:function(error){if(method==='open')fail(error.errorText||'On-TV service unavailable');}});}
  function fit(tile){if(!tile.frame)return;var ratio=CameraLayout.displayRatio(tile.frame.sar,tile.frame.width,tile.frame.height,settings.ratio);if(settings.ratio==='8:9')ratio=8/9;var size=CameraLayout.fitRect(tile.surface.clientWidth,tile.surface.clientHeight,ratio,settings.fit==='fill');tile.canvas.style.width=size.width+'px';tile.canvas.style.height=size.height+'px';}
  function updateSelection(){
    grid.dataset.view=String(view);tiles.forEach(function(t,i){t.element.hidden=i>=view;fit(t);});
    document.querySelectorAll('button[data-view]').forEach(function(b){b.classList.toggle('active',Number(b.dataset.view)===view);});
    if(ready&&worker)worker.postMessage({type:'select',channels:selected(),subtype:quality()});
    if(subscription&&!paused)call('select',{channels:selected(),subtype:quality()});
  }
  function applyProfile(next){
    if(!next||typeof next!=='object')return;
    profile=next;cameraCount=Number.isInteger(profile.cameraCount)&&profile.cameraCount>=1&&profile.cameraCount<=10?profile.cameraCount:10;
    view=[4,8,10,16].indexOf(profile.defaultView)>=0?profile.defaultView:10;expanded=0;
    settings.fit=profile.fit==='fill'?'fill':'fit';settings.ratio=['auto','8:9','4:3','16:9'].indexOf(profile.ratio)>=0?profile.ratio:'auto';
    tiles.forEach(function(t){t.element.classList.remove('enlarged');t.element.hidden=t.channel>view;t.label.textContent=(profile.labels&&profile.labels[String(t.channel)])||'Channel '+t.channel;t.health.textContent=t.channel<=cameraCount?'Waiting':'Not configured';});
    try{localStorage.setItem('direct-profile',profile.id||'default');localStorage.setItem('direct-settings',JSON.stringify(settings));}catch(error){}
    var fit=document.getElementById('fit'),ratio=document.getElementById('ratio');if(fit)fit.value=settings.fit;if(ratio)ratio.value=settings.ratio;
    updateSelection();
  }
  function enlarge(channel){if(channel>cameraCount)return;expanded=expanded===channel?0:channel;tiles.forEach(function(t){t.element.classList.toggle('enlarged',t.channel===expanded);fit(t);});updateSelection();}
  for(var c=1;c<=16;c++){
    var element=document.createElement('button');element.className='tile';element.setAttribute('aria-label','Enlarge Channel '+c);
    var surface=document.createElement('div');surface.className='surface';var canvas=document.createElement('canvas');canvas.hidden=true;surface.appendChild(canvas);
    var caption=document.createElement('div');caption.className='caption';var label=document.createElement('span');label.textContent=(profile.labels&&profile.labels[String(c)])||'Channel '+c;var health=document.createElement('span');health.className='health';health.textContent=c<=cameraCount?'Waiting':'Not configured';caption.append(label,health);element.append(surface,caption);grid.appendChild(element);
    var tile={channel:c,element:element,surface:surface,canvas:canvas,label:label,health:health,renderer:null,frame:null,count:0,lastPaint:0};tiles.push(tile);
    (function(channel){element.addEventListener('click',function(){enlarge(channel);});})(c);
  }
  function fail(text){metrics.lastFailure=text;status.textContent='Retrying';message.textContent=text;if(!closing&&!paused&&!retry)retry=setTimeout(function(){retry=null;start();},4000);}
  function stop(){
    epoch++;
    clearPresentation();
    if(subscription){subscription.cancel();subscription=null;}
    if(worker){worker.terminate();worker=null;}ready=false;mediaUrl='';
    clearTimeout(retry);retry=null;call('stop');
  }
  function start(){
    if(closing||paused||background)return;
    clearPresentation();
    var current=++epoch;startedAt=Date.now();lastFrameAt=0;mediaUrl='';
    if(subscription){subscription.cancel();subscription=null;}
    if(worker)worker.terminate();ready=false;
    worker=new Worker('direct-worker.js');
    worker.onerror=function(error){if(current===epoch)fail('Decoder error: '+(error.message||'worker stopped'));};
    worker.onmessage=function(event){
      if(current!==epoch)return;
      var m=event.data;
      if(m.type==='ready'){
        ready=true;metrics.wasmBytes=m.wasmBytes;worker.postMessage({type:'select',channels:selected(),subtype:quality()});
        subscription=webOS.service.request('luna://org.webos.instaonviewer.service/',{method:'open',subscribe:true,parameters:{subscribe:true},onSuccess:function(reply){
          if(current!==epoch)return;
          if(reply.mediaUrl&&reply.mediaUrl!==mediaUrl){mediaUrl=reply.mediaUrl;worker.postMessage({type:'connect',url:mediaUrl});call('select',{channels:selected(),subtype:quality()});}
          if(reply.state==='connecting'||reply.state==='reconnecting'){status.textContent='Connecting';message.textContent='Connecting directly through CP PLUS InstaOn…';}
          if(reply.state==='channel'&&reply.channel.state==='error')tiles[reply.channel.channel-1].health.textContent='Stream unavailable';
        },onFailure:function(error){fail(error.errorText||'On-TV service unavailable');}});
      }
      if(m.type==='error')fail(m.message);
      if(m.type==='health'){metrics.wasmBytes=m.stats.wasmBytes;metrics.decoder=m.stats;}
      if(m.type==='channel-error'){metrics.lastChannelFailure=m.message;tiles[m.channel-1].health.textContent='Waiting for keyframe';}
      if(m.type==='socket-close')fail('Media link closed');
      if(m.type==='frame'){
        if(pendingPaints.has(m.channel)){if(diagnostics)diagnostics.replaced(m.channel);else metrics.replaced=(metrics.replaced||0)+1;}
        pendingPaints.set(m.channel,m);if(diagnostics)diagnostics.received(m,pendingPaints.size);else{metrics.received++;metrics.maxQueueDepth=Math.max(metrics.maxQueueDepth,pendingPaints.size);}
        if(paintHandle!==null)return;
        paintHandle=requestAnimationFrame(function(){
          paintHandle=null;var batch=Array.from(pendingPaints.values());pendingPaints.clear();metrics.presentationBatches++;
          batch.forEach(function(m){
        if(current!==epoch)return;
        var t=tiles[m.channel-1];if(!t||selected().indexOf(m.channel)===-1){worker.postMessage({type:'painted',channel:m.channel});return;}
        try{
          if(!t.renderer)t.renderer=new CameraRenderer(t.canvas);
          t.canvas.hidden=false;t.renderer.paint(m);t.frame=m;t.lastPaint=Date.now();lastFrameAt=t.lastPaint;t.count++;fit(t);if(diagnostics)diagnostics.painted(m,t.lastPaint);else metrics.painted++;
          var delay=m.decodeMs;metrics.maxProcessingMs=Math.max(metrics.maxProcessingMs,delay);
          t.health.textContent=t.count+' frames';
          var active=selected(),live=active.filter(function(channel){return Date.now()-tiles[channel-1].lastPaint<3000;}).length;
          status.textContent=live===active.length?'LIVE':'PARTIAL';
          message.textContent=live+'/'+active.length+' channels painting · '+(expanded?'HD':'SD')+' · direct cloud connection · no gateway';
          var measured=diagnostics&&diagnostics.snapshot().aggregate,latency=measured&&measured.latencySamples?Math.round(measured.totalLatencyMs/measured.latencySamples)+' ms avg':'n/a';
          summary.textContent='View '+view+' · decode '+delay+' ms · presentation latency '+latency+' · shared decoder '+Math.round(metrics.wasmBytes/1048576)+' MiB · Select a camera to enlarge';
        }catch(error){if(t.renderer)t.renderer.close();t.renderer=null;var replacement=document.createElement('canvas');t.canvas.replaceWith(replacement);t.canvas=replacement;fail(error.message);}
        finally{if(worker&&current===epoch)worker.postMessage({type:'painted',channel:m.channel});}
          });
        });
      }
    };
  }
  var profileSelect=document.getElementById('profile');if(profileSelect){profiles.forEach(function(item){var option=document.createElement('option');option.value=item.id||'default';option.textContent=item.name||item.id||'Default';profileSelect.appendChild(option);});profileSelect.value=profile.id||'default';profileSelect.onchange=function(){var next=profiles.find(function(item){return item.id===profileSelect.value;});if(next)applyProfile(next);};}
  document.querySelectorAll('button[data-view]').forEach(function(button){button.onclick=function(){view=Number(button.dataset.view);expanded=0;tiles.forEach(function(t){t.element.classList.remove('enlarged');});updateSelection();};});
  var panel=document.getElementById('panel');
  function focus(element){if(element&&element.focus)element.focus();}
  var viewButtons=Array.from(document.querySelectorAll('button[data-view]'));
  var controls=viewButtons.concat([document.getElementById('settings'),document.getElementById('toggle')]);
  document.getElementById('settings').onclick=function(){panel.hidden=!panel.hidden;focus(document.getElementById(panel.hidden?'settings':'fit'));};
  document.getElementById('dismiss').onclick=function(){panel.hidden=true;focus(document.getElementById('settings'));};
  function navigate(key){
    var active=document.activeElement,index=controls.indexOf(active),tile=tiles.findIndex(function(t){return t.element===active;});
    if(!panel.hidden){
      var fields=['fit','ratio','dismiss'].map(function(id){return document.getElementById(id);}),field=fields.indexOf(active);
      // Native select menus retain their normal up/down behavior. Left/right
      // move between settings fields without overriding the platform picker.
      if((key==='ArrowUp'||key==='ArrowDown')&&active&&(active===fields[0]||active===fields[1]))return false;
      focus(fields[Math.max(0,Math.min(fields.length-1,field+(key==='ArrowLeft'||key==='ArrowUp'?-1:1)))]);return true;
    }
    if(expanded){
      if(key==='ArrowLeft'||key==='ArrowRight'){var next=Math.max(1,Math.min(Math.min(view,cameraCount),expanded+(key==='ArrowRight'?1:-1)));if(next!==expanded)enlarge(next);}
      focus(tiles[expanded-1].element);return true;
    }
    if(index>=0){
      if(key==='ArrowDown')focus(tiles[0].element);
      else if(key==='ArrowLeft'||key==='ArrowRight')focus(controls[Math.max(0,Math.min(controls.length-1,index+(key==='ArrowRight'?1:-1)))]);
      return true;
    }
    if(tile<0||tile>=view){focus(tiles[0].element);return true;}
    var columns=view===4?2:view===10?5:4,nextTile=tile;
    if(key==='ArrowUp'){if(tile<columns){focus(viewButtons.find(function(b){return Number(b.dataset.view)===view;}));return true;}nextTile-=columns;}
    if(key==='ArrowDown'&&tile+columns<view)nextTile+=columns;
    if(key==='ArrowLeft'&&tile%columns)nextTile--;
    if(key==='ArrowRight'&&tile%columns<columns-1&&tile+1<view)nextTile++;
    focus(tiles[nextTile].element);return true;
  }
  ['fit','ratio'].forEach(function(id){var select=document.getElementById(id);select.value=settings[id];select.onchange=function(){settings[id]=select.value;localStorage.setItem('direct-settings',JSON.stringify(settings));tiles.forEach(fit);};});
  document.getElementById('toggle').onclick=function(){paused=!paused;this.textContent=paused?'Resume all':'Pause all';if(paused){stop();status.textContent='Paused';}else start();};
  window.addEventListener('resize',function(){tiles.forEach(fit);});
  document.addEventListener('visibilitychange',function(){background=document.hidden;if(background)stop();else if(!paused)start();});
  var healthTimer=setInterval(function(){
    if(closing||paused||background)return;
    var active=selected(),count=0;active.forEach(function(channel){var t=tiles[channel-1];if(t.lastPaint&&Date.now()-t.lastPaint<3000)count++;else if(t.lastPaint)t.health.textContent='No recent frames';});
    // Discovery/authentication may take 45 seconds, followed by serial bind,
    // RTSP and the first keyframe. Do not cancel a valid cold-start handshake.
    if(!count&&ready&&Date.now()-(lastFrameAt||startedAt)>(lastFrameAt?30000:90000)){fail('No recent camera frames');return;}
    if(count<active.length&&ready){status.textContent=count?'PARTIAL':'Connecting';message.textContent=count+'/'+active.length+' channels fresh · retrying unavailable channels';}
  },1000);
  document.addEventListener('keydown',function(event){
    var key=event.key||({37:'ArrowLeft',38:'ArrowUp',39:'ArrowRight',40:'ArrowDown'})[event.keyCode];
    if(/^Arrow/.test(key||'')){if(navigate(key))event.preventDefault();return;}
    if(event.key==='Enter'||event.keyCode===13){var target=document.activeElement;if(target&&target!==document.getElementById('fit')&&target!==document.getElementById('ratio')&&typeof target.click==='function'){event.preventDefault();if(!event.repeat)target.click();}return;}
    if(event.key==='Escape'||event.keyCode===461){if(!panel.hidden){panel.hidden=true;focus(document.getElementById('settings'));}else if(expanded){var old=expanded;enlarge(expanded);focus(tiles[old-1].element);}else if(event.keyCode===461&&webOS.platformBack)webOS.platformBack();event.preventDefault();}
  });
  window.addEventListener('beforeunload',function(){closing=true;clearInterval(healthTimer);stop();tiles.forEach(function(t){if(t.renderer)t.renderer.close();});});
  updateSelection();focus(tiles[0].element);if(window.webOS&&webOS.service)start();else message.textContent='This standalone build must run in webOS TV or its simulator.';
}());
