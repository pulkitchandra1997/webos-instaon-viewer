'use strict';
const assert=require('assert'),timing=require('../src/timing.js');
const packet=new Uint8Array(28),view=new DataView(packet.buffer);view.setUint8(0,0x80);view.setUint8(1,200);view.setUint16(2,6);view.setUint32(4,0x12345678);view.setUint32(8,2208988801);view.setUint32(12,0x80000000);view.setUint32(16,90000);
const reports=timing.parseSenderReports(packet);assert.strictEqual(reports.length,1);assert.strictEqual(reports[0].ssrc,0x12345678);assert.strictEqual(reports[0].rtpTimestamp,90000);assert(Math.abs(reports[0].ntpMs-1500)<0.001);
const mapper=new timing.ClockMapper(90000);mapper.senderReport(reports[0]);assert(Math.abs(mapper.map(180000)-2500)<0.001);
const wrap=new timing.ClockMapper(90000);wrap.senderReport({ntpMs:1000,rtpTimestamp:0xffffff00});assert(Math.abs(wrap.map(0x100)-1005.69)<0.02,'RTP wraparound must extend timestamps');
const buffer=new timing.AlignmentBuffer([1,2],{toleranceMs:5,maxFrames:2});buffer.push({channel:1,timestampMs:100});buffer.push({channel:2,timestampMs:103});let aligned=buffer.poll();assert.strictEqual(aligned.status,'aligned');assert.deepStrictEqual(Object.keys(aligned.frames),['1','2']);
buffer.push({channel:1,timestampMs:200});buffer.push({channel:2,timestampMs:220});assert.strictEqual(buffer.poll().status,'waiting');assert.strictEqual(buffer.poll().status,'unsynchronized');
console.log('PASS RTCP sender reports, RTP wraparound mapping, and bounded alignment fallback');
