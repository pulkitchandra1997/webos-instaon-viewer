'use strict';
const assert=require('assert'),{capabilities}=require('./capabilities.cjs');
const value=capabilities();
assert.strictEqual(value.liveView,true);assert.strictEqual(value.qualitySwitch,true);assert.strictEqual(value.multiViewMax,10);
for(const field of ['ptz','audio','talk','playback','snapshots','discovery'])assert.strictEqual(value[field],false);
assert(value.unsupportedReason.includes('authorized'));
console.log('PASS explicit read-only capability contract hides unsupported controls');
