'use strict';
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

// Loopback is on the TV itself. Nothing is served on the laptop/LAN in the IPK.
async function createBridge() {
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer((request, response) => { response.writeHead(404); response.end(); });
  const sockets = new WebSocket.Server({noServer:true, maxPayload:16384, perMessageDeflate:false});
  let closed = false;
  const counts={framesIn:0,sent:0,acked:0,queued:0,dropped:0};
  function drop(ws,channel){const queue=ws.pending.get(channel)||[];for(const packet of queue)ws.pendingBytes-=packet.length;ws.pending.delete(channel);ws.waitKeyframe.add(channel);ws.discontinuity.add(channel);counts.dropped+=queue.length||1;}
  function send(ws,channel,packet){
    if(Date.now()-packet.readDoubleLE(12)>750){drop(ws,channel);return false;}
    if(ws.readyState!==WebSocket.OPEN)return false;
    ws.inFlight.add(channel);counts.sent++;
    ws.send(packet,{binary:true},error=>{if(error)ws.terminate();});return true;
  }
  server.on('upgrade', (request, socket, head) => {
    if (closed || request.url !== '/media/' + token) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws, request));
  });
  sockets.on('connection', ws => {
    ws.waitKeyframe = new Set(Array.from({length:64},(_,i)=>i+1));ws.inFlight=new Set();ws.discontinuity=new Set();ws.pending=new Map();ws.pendingBytes=0;
    ws.on('error', () => {});
    // A channel gets one credit back only after its frame has been consumed.
    ws.on('message', (data,isBinary) => {
      try{
        if(isBinary||data.length>128)throw new Error('Invalid acknowledgement');
        const ack=JSON.parse(data.toString());
        if(ack.type!=='ack'||!Number.isInteger(ack.channel)||ack.channel<1||ack.channel>64)throw new Error('Invalid acknowledgement');
        if(!ws.inFlight.delete(ack.channel))return;counts.acked++;
        const queue=ws.pending.get(ack.channel);
        if(queue&&queue.length){const packet=queue.shift();ws.pendingBytes-=packet.length;if(!queue.length)ws.pending.delete(ack.channel);send(ws,ack.channel,packet);}
      }catch(error){ws.close(1008);}
    });
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    token,
    url:'ws://127.0.0.1:' + server.address().port + '/media/' + token,
    frame(channel, frame) {
      if (!Number.isInteger(channel) || channel < 1 || channel > 64) throw new Error('Invalid channel');
      if (!Buffer.isBuffer(frame.data) || frame.data.length > 2*1024*1024) throw new Error('Frame too large');
      if (closed) return 0;
      counts.framesIn++;
      const header = Buffer.alloc(24);
      header.write('CPFR'); header[4] = 1; header[5] = channel;
      header[6] = frame.codec === 'h264' ? 1 : 2; header[7] = (frame.keyframe ? 1 : 0)|(frame.subtype===0?4:0);
      header.writeUInt32LE((frame.timestamp || 0) >>> 0, 8);
      header.writeDoubleLE(Date.now(), 12); header.writeUInt32LE(frame.data.length, 20);
      let sent = 0;
      sockets.clients.forEach(ws => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if(ws.bufferedAmount>512*1024){drop(ws,channel);return;}
        if (ws.waitKeyframe.has(channel)) { if (!frame.keyframe) return; ws.waitKeyframe.delete(channel); }
        const clientHeader=Buffer.from(header);
        if(ws.discontinuity.has(channel)){clientHeader[7]|=2;ws.discontinuity.delete(channel);}
        const packet=Buffer.concat([clientHeader,frame.data]);
        if(ws.inFlight.has(channel)){
          const queue=ws.pending.get(channel)||[];
          if(queue.length>=8||ws.pendingBytes+packet.length>2*1024*1024||(queue.length&&Date.now()-queue[0].readDoubleLE(12)>750)){drop(ws,channel);return;}
          queue.push(packet);ws.pending.set(channel,queue);ws.pendingBytes+=packet.length;counts.queued++;return;
        }
        if(send(ws,channel,packet))sent++;
      });
      return sent;
    },
    reset(){sockets.clients.forEach(ws=>{ws.pending.clear();ws.pendingBytes=0;ws.waitKeyframe=new Set(Array.from({length:64},(_,i)=>i+1));ws.discontinuity=new Set(ws.waitKeyframe);});},
    stats(){return {counts:Object.assign({},counts),clients:Array.from(sockets.clients,ws=>({inFlight:ws.inFlight.size,pendingPackets:Array.from(ws.pending.values()).reduce((n,q)=>n+q.length,0),pendingBytes:ws.pendingBytes}))};},
    async close() {
      if (closed) return; closed = true;
      sockets.clients.forEach(ws => ws.terminate());
      await new Promise(resolve => sockets.close(resolve));
      await new Promise(resolve => server.close(resolve));
    }
  };
}
module.exports = {createBridge};
