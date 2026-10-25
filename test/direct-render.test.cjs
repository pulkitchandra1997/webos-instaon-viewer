'use strict';
const vm=require('vm'),fs=require('fs'),assert=require('assert');const window={};
vm.runInNewContext(fs.readFileSync(__dirname+'/../src/render.js','utf8'),{window});
let contextOptions;
assert.throws(()=>new window.CameraRenderer({getContext(type,options){contextOptions=options;return null;}}),/unavailable/);
assert.strictEqual(contextOptions.preserveDrawingBuffer,true,'Independent camera tiles must retain their previous pixels between paints');
const renderer=Object.create(window.CameraRenderer.prototype);renderer.canvas={};renderer.gl={isContextLost(){return true;}};
assert.throws(()=>renderer.paint({width:2,height:2,data:new Uint8Array(6)}),/context lost/,'Lost GPU contexts must not count as painted frames');
console.log('PASS graphics-context loss fails before false paint success');
