'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
class Element {
  constructor(){this.handlers={};this.dataset={};this.children=[];this.style={};this.className='';this.hidden=false;this.clientWidth=600;this.clientHeight=300;const self=this;this.classList={contains(n){return self.className.split(' ').includes(n);},toggle(n,on){const values=new Set(self.className.split(' ').filter(Boolean));if(on===undefined)on=!values.has(n);if(on)values.add(n);else values.delete(n);self.className=Array.from(values).join(' ');},remove(n){this.toggle(n,false);}};}
  setAttribute(){} append(...elements){for(const e of elements){if(e.parent&&e.parent!==this){const old=e.parent.children.indexOf(e);if(old>=0)e.parent.children.splice(old,1);}if(e.parent===this){const old=this.children.indexOf(e);if(old>=0)this.children.splice(old,1);}e.parent=this;this.children.push(e);}} appendChild(e){this.append(e);} addEventListener(name,handler){this.handlers[name]=handler;} click(){if(this.onclick)this.onclick();if(this.handlers.click)this.handlers.click();if(this.parent)this.parent.click();}
  focus(){document.activeElement=this;}
}
const ids={};for(const id of ['grid','status','message','summary','settings','dismiss','toggle','panel','fit','ratio','profile','capabilities'])ids[id]=new Element();
ids.panel.hidden=true;
const views=[4,8,10,16].map(n=>{const e=new Element();e.dataset.view=String(n);return e;});
ids.grid.dataset.view='10';
const document={handlers:{},getElementById(id){return ids[id];},createElement(){return new Element();},querySelectorAll(selector){return selector==='button[data-view]'?views:views.concat(ids.grid);},addEventListener(name,handler){this.handlers[name]=handler;}};
const workers=[];class Worker{constructor(){workers.push(this);this.messages=[];}postMessage(m){this.messages.push(m);}terminate(){}}
let platformBackCalls=0,now=100000,healthTick;const scheduled=[],requests=[],paintTicks=[];
class Clock extends Date{static now(){return now;}}
const webOS={platformBack(){platformBackCalls++;},service:{request(uri,options){requests.push(options);return {cancel(){}};}}};
const window={webOS,VIEWER_PROFILE:{cameraCount:10,defaultView:10,profiles:[{version:1,id:'default',name:'Default',cameraCount:10,defaultView:10,labels:{},order:[1,2,3,4,5,6,7,8,9,10],fit:'fit',ratio:'auto'},{version:1,id:'small',name:'Small profile',cameraCount:3,defaultView:4,labels:{'1':'Door'},order:[3,1,2],fit:'fill',ratio:'4:3'}]},addEventListener(){}};
vm.runInNewContext(fs.readFileSync(__dirname+'/../src/direct.js','utf8'),{document,window,webOS,Worker,Date:Clock,requestAnimationFrame(callback){paintTicks.push(callback);return paintTicks.length;},cancelAnimationFrame(){paintTicks.length=0;},CameraRenderer:function(){this.paint=function(){};},setInterval(callback){healthTick=callback;return 1;},clearInterval(){},setTimeout(callback,delay){scheduled.push({callback,delay});return scheduled.length;},clearTimeout(){},localStorage:{getItem(){return null;},setItem(){}},CameraLayout:require('../src/layout.js'),Map,Set,console});
assert.strictEqual(ids.grid.dataset.view,'10','Fresh launch must always default to ten-camera view');
assert.strictEqual(ids.grid.children.filter(e=>!e.hidden).length,10,'Fresh launch must display exactly ten camera tiles');
assert(views[2].classList.contains('active'),'Ten-camera view must be the selected startup layout');
assert.strictEqual(document.activeElement,ids.grid.children[0],'TV remote must have a focused tile at launch');
document.handlers.keydown({key:'ArrowRight',keyCode:39,preventDefault(){}});assert.strictEqual(document.activeElement,ids.grid.children[1]);
document.handlers.keydown({key:'ArrowDown',keyCode:40,preventDefault(){}});assert.strictEqual(document.activeElement,ids.grid.children[6]);
document.handlers.keydown({key:'ArrowUp',keyCode:38,preventDefault(){}});assert.strictEqual(document.activeElement,ids.grid.children[1]);
document.handlers.keydown({key:'ArrowUp',keyCode:38,preventDefault(){}});assert.strictEqual(document.activeElement,views[2],'Up from the top row must reach the view controls');
document.handlers.keydown({key:'ArrowLeft',keyCode:37,preventDefault(){}});assert.strictEqual(document.activeElement,views[1]);
document.handlers.keydown({key:'ArrowLeft',keyCode:37,preventDefault(){}});assert.strictEqual(document.activeElement,views[0]);
document.handlers.keydown({key:'ArrowLeft',keyCode:37,preventDefault(){}});assert.strictEqual(document.activeElement,ids.profile,'Profile selector must be reachable from the remote control row');
document.activeElement=views[0];
const tile=ids.grid.children[0];tile.click();assert(tile.classList.contains('enlarged'),'A single click must enlarge a camera');
tile.click();assert(!tile.classList.contains('enlarged'));
document.activeElement=tile;
let enterPrevented=false;
document.handlers.keydown({key:'Enter',keyCode:13,preventDefault(){enterPrevented=true;}});
assert(enterPrevented,'The TV remote Enter handler must own activation and suppress the inconsistent native default');
// A browser only synthesizes the native click when keydown was not cancelled.
if(!enterPrevented)tile.click();assert(tile.classList.contains('enlarged'),'Remote Enter must activate a button exactly once');
document.handlers.keydown({key:'Escape',preventDefault(){}});assert(!tile.classList.contains('enlarged'));
document.handlers.keydown({keyCode:461,preventDefault(){}});
assert.strictEqual(platformBackCalls,1,'TV Back at the root must return to the platform, not trap the user');
views[0].onclick();assert.strictEqual(ids.grid.dataset.view,'4');assert.strictEqual(ids.grid.children.filter(e=>!e.hidden).length,4);
views[3].onclick();assert.strictEqual(ids.grid.children.filter(e=>!e.hidden).length,16);
views[2].onclick();workers[0].onmessage({data:{type:'ready',wasmBytes:201326592}});
now+=35000;healthTick();assert.strictEqual(scheduled.length,0,'A valid 45-second handshake must not be interrupted after 35 seconds');
const open=requests.find(r=>r.method==='open');open.onSuccess({state:'connecting',mediaUrl:'ws://127.0.0.1/fixture'});
assert(requests.filter(r=>r.method==='select').every(r=>r.parameters.subtype===1),'Every grid layout must request SD');
ids.grid.children[2].click();
assert.deepStrictEqual(Array.from(workers[0].messages.filter(m=>m.type==='select').pop().channels),[3],'Enlargement must stop decoding hidden HD streams');
assert.strictEqual(requests.filter(r=>r.method==='select').pop().parameters.subtype,0,'An enlarged camera must request HD');
document.handlers.keydown({key:'Escape',preventDefault(){}});
assert.deepStrictEqual(Array.from(workers[0].messages.filter(m=>m.type==='select').pop().channels),[1,2,3,4,5,6,7,8,9,10],'Back must restore the ten-camera HD selection');
assert.strictEqual(requests.filter(r=>r.method==='select').pop().parameters.subtype,1,'Returning to the grid must restore SD');
for(let channel=1;channel<=10;channel++)workers[0].onmessage({data:{type:'frame',channel,width:2,height:2,sar:{numerator:1,denominator:1},decodeMs:1,data:new Uint8Array(6)}});
assert.strictEqual(window.cameraDiagnostics.metrics.painted,0,'Available camera frames must share a presentation tick, not paint independently');
assert.strictEqual(paintTicks.length,1);paintTicks.shift()();
assert.strictEqual(ids.status.textContent,'LIVE');
window.cameraDiagnostics.channels[9].lastPaint=now-10000;
workers[0].onmessage({data:{type:'frame',channel:1,width:2,height:2,sar:{numerator:1,denominator:1},decodeMs:1,data:new Uint8Array(6)}});
paintTicks.shift()();
assert.strictEqual(ids.status.textContent,'PARTIAL','Fresh frames on other cameras must not hide one stale channel');
workers[0].onmessage({data:{type:'error',message:'Decoder heap budget exceeded'}});
assert.strictEqual(window.cameraDiagnostics.metrics.lastFailure,'Decoder heap budget exceeded','Diagnostics must retain decoder failures after status updates');
scheduled[scheduled.length-1].callback();
workers[0].onerror({message:'Error from an old terminated worker'});
assert.strictEqual(window.cameraDiagnostics.metrics.lastFailure,'Decoder heap budget exceeded','A terminated worker must not restart a newer session');
ids.profile.value='small';ids.profile.onchange();
assert.strictEqual(ids.grid.children.filter(e=>!e.hidden).length,4,'Selecting a profile must apply its preferred layout');
assert.strictEqual(ids.grid.children[0].children[1].children[0].textContent,'Channel 3','Selecting a profile must apply its configured visual ordering');
assert.strictEqual(ids.grid.children[1].children[1].children[0].textContent,'Door','Selecting a profile must apply camera labels');
assert.strictEqual(ids.fit.value,'fill');assert.strictEqual(ids.ratio.value,'4:3','Selecting a profile must apply display settings');
document.activeElement=ids.grid.children[0];document.handlers.keydown({key:'ArrowRight',keyCode:39,preventDefault(){}});assert.strictEqual(document.activeElement,ids.grid.children[1],'Remote navigation must follow profile-defined tile ordering');
console.log('PASS single click/Enter enlargement, Back, four/sixteen layout controls');
