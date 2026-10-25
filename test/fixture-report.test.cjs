'use strict';
const assert=require('assert');
const {runReport}=require('../tools/fixture-report.cjs');
const report=runReport(3);
assert.strictEqual(report.kind,'synthetic-fixture-report');
assert.strictEqual(report.scenarios.length,5);
assert.deepStrictEqual(report.scenarios.map(s=>[s.channels,s.quality]),[[4,'SD'],[8,'SD'],[10,'SD'],[16,'SD'],[1,'HD']]);
for(const scenario of report.scenarios){assert.strictEqual(scenario.received,scenario.painted);assert.strictEqual(scenario.replaced,0);assert(scenario.averageDecodeMs>0);assert(scenario.averagePresentationLatencyMs>=0);}
assert(report.warning.includes('Synthetic timings only'));
console.log('PASS synthetic performance report covers SD wall layouts and HD enlargement');
