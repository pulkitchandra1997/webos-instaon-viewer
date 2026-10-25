'use strict';
// Offline only. The fake recorder/relay is either a local UDP peer or a byte
// datagram peer. The client handshake, crypto, PTCP and Duplex code are real.
const assert = require('assert').strict;
const crypto = require('crypto');
const dgram = require('dgram');
const { EventEmitter } = require('events');
const { openInstaTunnel, MultiTunnel, FramedPtcpSession, RtspClient } = require('./core/index.cjs');
const { BodyFramer } = require('./core/ptcp.cjs');
const { InstaSocket } = require('./core/socket.cjs');
const { buildRequest, deviceKey, deviceAuth, encryptAddress } = require('./core/protocol.cjs');
const { PtcpSession, bodies } = require('./build/transport-node12.cjs');
const tests = [];
const test = (name, run) => tests.push({ name, run });
const turn = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function deadline(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Local fixture deadline exceeded')), ms || 2000);
  })]).then(value => { clearTimeout(timer); return value; }, error => { clearTimeout(timer); throw error; });
}
function signalSource() {
  const events = new EventEmitter();
  const signal = { aborted: false,
    addEventListener: (name, fn) => events.on(name, fn),
    removeEventListener: (name, fn) => events.removeListener(name, fn) };
  return { signal, listeners: () => events.listenerCount('abort'), abort: () => {
    if (!signal.aborted) { signal.aborted = true; events.emit('abort'); }
  } };
}
function packet(sent, body, recv) {
  const h = Buffer.alloc(24);
  h.write('PTCP'); h.writeUInt32BE(sent >>> 0, 4); h.writeUInt32BE((recv || 0) >>> 0, 8);
  h.writeUInt32BE(0xffff, 12); h.writeUInt32BE(1, 16);
  return Buffer.concat([h, body]);
}
function link(options, receive) {
  let client, peer, stopped = false;
  const queues = { fromClient: [], fromPeer: [] };
  const wire = (direction, target, data) => {
    queues[direction].push(Buffer.from(data));
    setImmediate(() => { if (!stopped) target().input(data); });
  };
  client = new FramedPtcpSession(Object.assign({ ackDelayMs: 1, heartbeatMs: 1000000 }, options, {
    transmit: data => wire('fromClient', () => peer, data)
  }));
  peer = new PtcpSession({ ackDelayMs: 1, heartbeatMs: 1000000,
    transmit: data => wire('fromPeer', () => client, data) });
  if (receive) peer.on('body', receive.bind(null, peer));
  let closeCalls = 0;
  const socket = { bytesIn: 0, bytesOut: 0, close: () => { closeCalls++; } };
  const tunnel = new MultiTunnel(socket, client, {}, options);
  return { client, peer, tunnel, queues, closeCalls: () => closeCalls, close: () => {
    tunnel.close(); peer.close(); stopped = true;
  } };
}
async function openLocalPeer(options) {
  const o = options || {}, servers = {}, errors = [], requests = [], clients = new Set();
  let remote, clientPeer, binds = [], rtspSeq = 0;
  const rtspBuffers = new Map();
  const unescape = text => text.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const get = (body, name) => { const m = body.match(new RegExp('<' + name + '>([^<]*)</' + name + '>')); return m ? unescape(m[1]) : null; };
  const info = { randsalt: 'fixture-salt', rtspport: 8554, httpport: 8080 };
  const cipher = crypto.createCipheriv('aes-256-ofb', Buffer.from('kRjmsUB&ezmdGLL67H#$ojw@XflcaIaf'), Buffer.from('MydvJw*Iw1w&i^kk'));
  const encryptedInfo = Buffer.concat([cipher.update(JSON.stringify(info) + '\u0000\u0000'), cipher.final()]).toString('base64');
  function send(server, to, value) { server.send(Buffer.isBuffer(value) ? value : Buffer.from(value), to.port, to.address); }
  function response(server, to, seq, code, body) {
    send(server, to, 'HTTP/1.1 ' + (code || 200) + ' Fixture\r\ncseq: ' + seq + '\r\n'+(o.cloudDate?'Date: '+o.cloudDate+'\r\n':'')+'\r\n<body>' + (body || '') + '</body>');
  }
  function media(body) {
    if (body.type === 'sync') { remote.send(bodies.sync()); return; }
    if (body.type === 'bind') {
      binds.push(body.realm);
      if (binds.length === (o.waitForBinds || 1)) {
        const ready = binds.slice().reverse().map(id => bodies.status(id, 'CONN'));
        // CONN frames for multiple realms deliberately share one PTCP datagram.
        remote.send(Buffer.concat(ready));
      }
      return;
    }
    if (body.type !== 'data') return;
    if (!o.rtsp) { remote.send(bodies.data(body.realm, body.data)); return; }
    const pending = Buffer.concat([rtspBuffers.get(body.realm) || Buffer.alloc(0), body.data]);
    rtspBuffers.set(body.realm, pending);
    const end = pending.indexOf('\r\n\r\n');
    if (end < 0) return;
    const text = pending.toString('utf8', 0, end);
    rtspBuffers.set(body.realm, pending.subarray(end + 4));
    const method = text.split(' ')[0], seq = /CSeq:\s*(\d+)/i.exec(text)[1];
    let headers = '', payload = '';
    if (method === 'DESCRIBE') {
      payload = 'v=0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=control:trackID=0\r\n';
      headers = 'Content-Type: application/sdp\r\n';
    } else if (method === 'SETUP') headers = 'Session: fixture-' + body.realm + ';timeout=60\r\nTransport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n';
    const reply = Buffer.from('RTSP/1.0 200 OK\r\nCSeq: ' + seq + '\r\n' + headers + 'Content-Length: ' + Buffer.byteLength(payload) + '\r\n\r\n' + payload);
    if (method === 'PLAY') {
      const channel = Number(/channel=(\d+)/.exec(text)[1]);
      const rtp = Buffer.alloc(16);
      rtp[0] = 0x80; rtp[1] = 0xe0; rtp.writeUInt16BE(++rtspSeq, 2); rtp.writeUInt32BE(90000 + channel, 4);
      rtp[12] = 0x65; rtp[13] = channel; rtp[14] = channel; rtp[15] = channel;
      const interleaved = Buffer.from([0x24, 0, 0, rtp.length]);
      const wire = Buffer.concat([reply, interleaved, rtp]);
      // Split across both a PTCP body boundary and an RTSP/RTP boundary.
      remote.send(Buffer.concat([bodies.data(body.realm, wire.subarray(0, 7)), bodies.data(body.realm, wire.subarray(7))]));
    } else remote.send(bodies.data(body.realm, reply));
  }
  function handle(role, server, data, from) {
    clients.add(from.address + ':' + from.port);
    if (data.toString('ascii', 0, 4) === 'PTCP') {
      if (!remote) {
        clientPeer = from;
        remote = new PtcpSession({ ackDelayMs: 1, heartbeatMs: 1000000, transmit: value => send(servers.agent, clientPeer, value) });
        remote.on('body', media);
      }
      remote.input(data); return;
    }
    const text = data.toString(), first = text.split('\r\n')[0], path = first.split(' ')[1];
    const seq = /CSeq:\s*(-?\d+)/i.exec(text)[1], body = text.slice(text.indexOf('\r\n\r\n') + 4);
    requests.push(path);
    const addr = name => '127.0.0.1:' + servers[name].address().port;
    if (o.ignore) return;
    if(o.cloudDate&&path!=='/online/stun'){
      const stamp=/Created="([^"]+)"/.exec(text),bodyStamp=get(body,'CreateDate'),serverTime=Date.parse(o.cloudDate);
      if(!stamp||Math.abs(Date.parse(stamp[1])-serverTime)>5000||(bodyStamp&&Math.abs(Number(bodyStamp)*1000-serverTime)>5000)){response(server,from,seq,403);return;}
    }
    if (path === '/online/stun') {
      assert.equal(text.indexOf('Authorization:'), -1);
      response(server, from, Number(seq) + 100, 200, '<WrongSequence>true</WrongSequence>');
      response(server, from, seq, 100);
      response(server, from, seq);
    } else if (path.indexOf('/online/p2psrv/') === 0) response(server, from, seq, 200, '<US>' + addr('device') + '</US>');
    else if (path === '/online/relay') response(server, from, seq, 200, '<Address>' + addr('relay') + '</Address>');
    else if (path.indexOf('/probe/device/') === 0) response(server, from, seq);
    else if (path.indexOf('/info/device/') === 0) response(server, from, seq, 200, '<Info>' + encryptedInfo + '</Info><DevVersion>fixture-fw</DevVersion>');
    else if (/\/p2p-channel$/.test(path)) {
      const nonce = get(body, 'Nonce'), time = get(body, 'CreateDate'), encrypted = get(body, 'LocalAddr');
      const key = crypto.createHash('md5').update('fixture-user:Login to fixture-salt:fixture-password').digest('hex').toUpperCase();
      assert.equal(get(body, 'DevAuth'), crypto.createHmac('sha256', key).update(nonce + time + encrypted).digest('base64'));
      const derived = crypto.pbkdf2Sync(key, nonce, 20000, 32, 'sha256');
      const decipher = crypto.createDecipheriv('aes-256-ofb', derived, Buffer.from('2z52*lk9o6HRyJrf'));
      const plain = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString();
      assert.ok(plain.endsWith('127.0.0.1:' + from.port));
      assert.equal(get(body, 'IpEncrptV2'), 'true');
      response(server, from, seq, o.rejectChannel ? 403 : 200);
    } else if (path === '/relay/agent') response(server, from, seq, 200, '<Agent>' + addr('agent') + '</Agent><Token>fixture-token</Token>');
    else if (path.indexOf('/relay/start/') === 0) response(server, from, seq);
    else if (/\/relay-channel$/.test(path)) {
      const key = crypto.createHash('md5').update('fixture-user:Login to fixture-salt:fixture-password').digest('hex').toUpperCase();
      assert.equal(get(body, 'DevAuth'), crypto.createHmac('sha256', key).update(get(body, 'Nonce') + get(body, 'CreateDate')).digest('base64'));
      response(servers.agent, from, seq);
    } else throw new Error('Unexpected local fixture route');
  }
  for (const role of ['cloud', 'device', 'relay', 'agent']) {
    const server = dgram.createSocket('udp4');
    servers[role] = server;
    server.on('message', (data, from) => { try { handle(role, server, data, from); } catch (error) { errors.push(error); } });
    await new Promise(resolve => server.bind(0, '127.0.0.1', resolve));
  }
  return { cloud: { host: '127.0.0.1', port: servers.cloud.address().port }, requests, clients, errors,
    get remote() { return remote; }, get binds() { return binds; },
    close: async () => {
      if (remote) remote.close();
      await Promise.all(Object.keys(servers).map(role => new Promise(resolve => servers[role].close(resolve))));
    } };
}

test('CP request bytes match the existing discovery implementation', async () => {
  const prior = require('./instaon-discovery.cjs');
  const o = { created: '2026-10-25T15:30:00+05:30', nonce: -456, body: '<body>测试</body>', pcsID: 'fixture' };
  assert.deepEqual(buildRequest('/fixture', -123, o), prior.buildRequest('/fixture', -123, o));
  const key = deviceKey('fixture-user', 'fixture-password', 'fixture-salt');
  const expected = crypto.createHash('md5').update('fixture-user:Login to fixture-salt:fixture-password').digest('hex').toUpperCase();
  assert.equal(key.toString(), expected);
  const a = deviceAuth('u<&', key, 123, 's<&', 'payload', 1700000000000);
  assert.ok(a.includes('<UserName>u&lt;&amp;</UserName>') && a.includes('<RandSalt>s&lt;&amp;</RandSalt>'));
  assert.ok(a.includes(crypto.createHmac('sha256', expected).update('1231700000000payload').digest('base64')));
  const encrypted = await encryptAddress(key, 42, '127.0.0.1:1234');
  const decipher = crypto.createDecipheriv('aes-256-ofb', crypto.pbkdf2Sync(expected, '42', 20000, 32, 'sha256'), Buffer.from('2z52*lk9o6HRyJrf'));
  assert.equal(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString(), '127.0.0.1:1234');
});

test('cloud Date compensates a skewed TV clock for both WSSE and device authentication',async()=>{
  const peer=await openLocalPeer({cloudDate:new Date(Date.now()+18*60*1000).toISOString()}),clockBefore=Date.now();let result;
  try{
    result=await openInstaTunnel({deviceid:'fixture-device',username:'fixture-user',password:'fixture-password'},
      {cloud:peer.cloud,localAddresses:['127.0.0.1'],timeoutMs:500});
    assert(result.tunnel&&!result.tunnel.closed);assert.strictEqual(peer.errors.length,0);
    assert(Math.abs(Date.now()-clockBefore)<5000,'Synchronization must not modify the system clock');
  }finally{if(result)result.close();await peer.close();}
});

test('PTCP framing: byte fragmentation, coalescing, bind dialects and exact realm isolation', async () => {
  const got = [], framer = new BodyFramer(body => got.push(body));
  const oldBind = bodies.bind(71, 554), newBind = Buffer.from(oldBind); newBind.writeUIntBE(8, 1, 3);
  const input = Buffer.concat([bodies.sync(), oldBind, newBind, bodies.heartbeat(), bodies.status(71, 'CONN'), bodies.data(71, Buffer.from('a')), bodies.data(72, Buffer.from('bc'))]);
  for (const byte of input) framer.push(Buffer.from([byte]));
  assert.deepEqual(got.map(b => b.type), ['sync', 'bind', 'bind', 'heartbeat', 'status', 'data', 'data']);
  assert.equal(got[1].port, 554); assert.equal(got[2].port, 554);
  assert.equal(got[5].realm, 71); assert.equal(got[5].data.toString(), 'a');
  assert.equal(got[6].realm, 72); assert.equal(got[6].data.toString(), 'bc');
  assert.equal(framer.buffer.length, 0);
  got.length = 0; framer.push(input); assert.equal(got.length, 7);
});

test('PTCP reliability: reordered, duplicated and overlapping datagrams retain every byte once', async () => {
  const got = [], s = new FramedPtcpSession({ transmit: () => {}, ackDelayMs: 1 });
  s.on('body', b => { if (b.type === 'data') got.push([b.realm, b.data.toString()]); });
  try {
    const wire = Buffer.concat([bodies.data(8, Buffer.from('alpha')), bodies.data(9, Buffer.from('beta'))]);
    s.input(packet(5, wire.subarray(5, 16)));
    s.input(packet(0, wire.subarray(0, 5)));
    // Three bytes overlap: only the new tail should enter the framer.
    s.input(packet(13, wire.subarray(13)));
    s.input(packet(0, wire));
    assert.deepEqual(got, [[8, 'alpha'], [9, 'beta']]);
    assert.equal(s.received, wire.length); assert.equal(s.framer.buffer.length, 0);
    assert.equal(s.early.size, 0);
  } finally { s.close(); }
});

test('PTCP framing fails closed on oversized data or unsized authentication commands', async () => {
  const header = Buffer.alloc(12); header.writeUInt32BE(0x10010000, 0); header.writeUInt32BE(3, 4);
  const s = new FramedPtcpSession({ transmit: () => {}, maxBodyBytes: 100 });
  s.input(packet(0, header));
  assert.equal(s.closedReason, 'ERR_PTCP_READ_LIMIT'); assert.equal(s.framer.buffer.length, 0);
  const s2 = new FramedPtcpSession({ transmit: () => {} });
  s2.input(packet(0, bodies.command(0x19, Buffer.from('ambiguous'))));
  assert.equal(s2.closedReason, 'ERR_PTCP_FRAME');
  const s3 = new FramedPtcpSession({ transmit: () => {}, maxReorderPackets: 1 });
  s3.input(packet(100, Buffer.from('a'))); s3.input(packet(101, Buffer.from('b')));
  assert.equal(s3.closedReason, 'ERR_PTCP_REORDER_LIMIT'); assert.equal(s3.early.size, 0);
});

test('ten independent realms bind before any closes; cross delivery is impossible', async () => {
  const binds = [], allData = new Map();
  const l = link({}, (peer, b) => {
    if (b.type === 'bind') {
      binds.push(b.realm);
      if (binds.length === 10) peer.send(Buffer.concat(binds.slice().reverse().map(id => bodies.status(id, 'CONN'))));
    }
    if (b.type === 'data') peer.send(bodies.data(b.realm, b.data));
  });
  try {
    const realms = await deadline(Promise.all(Array.from({ length: 10 }, () => l.tunnel.connect(554))));
    assert.equal(new Set(realms.map(r => r.id)).size, 10); assert.equal(l.tunnel.realms.size, 10);
    realms.forEach((realm, i) => { allData.set(realm.id, []); realm.on('data', data => allData.get(realm.id).push(data)); realm.write(Buffer.from('camera-' + i)); });
    for (let i = 0; i < 5; i++) await turn();
    realms.forEach((realm, i) => assert.equal(Buffer.concat(allData.get(realm.id)).toString(), 'camera-' + i));
    realms[4].destroy(); await turn();
    l.peer.send(bodies.data(realms[4].id, Buffer.from('late-closed-data')));
    l.peer.send(bodies.data(123, Buffer.from('unknown-realm-data')));
    realms[5].write(Buffer.from('-still-live'));
    for (let i = 0; i < 5; i++) await turn();
    assert.equal(Buffer.concat(allData.get(realms[4].id)).toString(), 'camera-4');
    assert.equal(Buffer.concat(allData.get(realms[5].id)).toString(), 'camera-5-still-live');
  } finally { l.close(); }
  assert.equal(l.tunnel.stats.realms, 0); assert.equal(l.closeCalls(), 1);
  assert.equal(l.client.listenerCount('body'), 0); assert.equal(l.client.listenerCount('closed'), 0); assert.equal(l.client.listenerCount('drain'), 0);
  assert.equal(l.client.outstanding.length, 0); assert.equal(l.client.early.size, 0); assert.equal(l.client.ackTimer, null);
});

test('realm receive limits isolate slow consumers and reclaim queued data on close', async () => {
  const l = link({ maxReadBufferBytes: 32 }, (peer, b) => { if (b.type === 'bind') peer.send(bodies.status(b.realm, 'CONN')); });
  try {
    const pair = await deadline(Promise.all([l.tunnel.connect(554), l.tunnel.connect(554)]));
    let error; pair[0].on('error', e => { error = e; });
    l.peer.send(bodies.data(pair[0].id, Buffer.alloc(20, 1)));
    l.peer.send(bodies.data(pair[0].id, Buffer.alloc(20, 2)));
    l.peer.send(bodies.data(pair[1].id, Buffer.from('ok')));
    for (let i = 0; i < 5; i++) await turn();
    assert.equal(pair[0].destroyed, true); assert.equal(error.code, 'ERR_REALM_READ_LIMIT');
    assert.equal(pair[0].readableLength, 0); assert.equal(pair[1].read().toString(), 'ok');
    assert.equal(l.tunnel.closed, false); assert.equal(l.tunnel.realms.size, 1);
  } finally { l.close(); }
});

test('realm cancellation, remote refusal, bind timeout and pending-close cleanup', async () => {
  const controls = signalSource(), l = link({ bindTimeoutMs: 20 }, (peer, b) => {
    if (b.type === 'bind' && b.port === 80) peer.send(bodies.status(b.realm, 'DISC'));
  });
  try {
    const first = l.tunnel.connect(554, { signal: controls.signal });
    const rejected = assert.rejects(first, { code: 'ABORT_ERR' }); controls.abort(); await rejected;
    assert.equal(controls.listeners(), 0);
    await assert.rejects(l.tunnel.connect(80), { code: 'ERR_REALM_REFUSED' });
    await assert.rejects(l.tunnel.connect(554), { code: 'ERR_REALM_BIND_TIMEOUT' });
    assert.equal(l.tunnel.pendingBinds.size, 0); assert.equal(l.tunnel.realms.size, 0);
    const pending = l.tunnel.connect(554);
    const closed = assert.rejects(pending, { code: 'ERR_TUNNEL_CLOSED' });
    let closeEvents = 0; l.tunnel.on('closed', () => closeEvents++);
    l.tunnel.close(); l.tunnel.close(); await closed;
    assert.equal(closeEvents, 1); assert.equal(l.tunnel.pendingBinds.size, 0);
  } finally { l.close(); }
});

test('established realm cancellation leaves its neighbours connected', async () => {
  const control = signalSource(), l = link({}, (peer, b) => { if (b.type === 'bind') peer.send(bodies.status(b.realm, 'CONN')); });
  try {
    const realm = await l.tunnel.connect(554, { signal: control.signal }), other = await l.tunnel.connect(554);
    control.abort(); await turn();
    assert.equal(realm.destroyed, true); assert.equal(other.destroyed, false);
    assert.equal(control.listeners(), 0); assert.equal(l.tunnel.realms.size, 1);
  } finally { l.close(); }
});

test('Duplex writes respect a bounded PTCP send window and resume after real ACKs', async () => {
  const received = [], l = link({ maxPendingBytes: 4096 }, (peer, b) => {
    if (b.type === 'bind') peer.send(bodies.status(b.realm, 'CONN'));
    if (b.type === 'data') received.push(b.data);
  });
  try {
    const realm = await l.tunnel.connect(554), data = Buffer.alloc(20000, 0x5a);
    await deadline(new Promise((resolve, reject) => realm.write(data, error => error ? reject(error) : resolve())));
    for (let i = 0; i < 5; i++) await turn();
    assert.deepEqual(Buffer.concat(received), data);
    assert.ok(l.queues.fromClient.every(p => p.length <= 24 + 12 + 1280));
    assert.ok(l.client.unacked <= 4096);
  } finally { l.close(); }
});

test('ignored write backpressure cannot grow a realm queue beyond its configured bound', async () => {
  const l = link({ maxWriteBufferBytes: 32 }, (peer, b) => { if (b.type === 'bind') peer.send(bodies.status(b.realm, 'CONN')); });
  try {
    const realm = await l.tunnel.connect(554);
    const error = await new Promise(resolve => realm.write(Buffer.alloc(33), resolve));
    await turn(); assert.equal(error.code, 'ERR_REALM_WRITE_LIMIT'); assert.equal(realm.destroyed, true);
    assert.equal(l.tunnel.realms.size, 0);
  } finally { l.close(); }
});

test('full authenticated InstaOn handshake plus ten real RtspClient instances over one UDP socket', async () => {
  const peer = await openLocalPeer({ waitForBinds: 10, rtsp: true });
  let result;
  const clients = [];
  try {
    result = await deadline(openInstaTunnel({ deviceid: 'fixture-device', username: 'fixture-user', password: 'fixture-password' },
      { cloud: peer.cloud, localAddresses: ['127.0.0.1'], timeoutMs: 1000, handshakeTimeoutMs: 5000 }), 6000);
    assert.equal(result.info.rtspport, 8554); assert.equal(result.firmware, 'fixture-fw');
    const realms = await deadline(Promise.all(Array.from({ length: 10 }, () => result.tunnel.connect(8554))));
    const frames = [];
    realms.forEach((realm, i) => {
      const client = new RtspClient(realm, { url: 'rtsp://127.0.0.1/cam/realmonitor?channel=' + (i + 1) + '&subtype=1', user: 'fixture-user', pass: 'fixture-password', timeoutMs: 1000 });
      clients.push(client); frames.push([]); client.on('frame', frame => frames[i].push(frame));
    });
    await deadline(Promise.all(clients.map(c => c.start())), 5000);
    for (let i = 0; i < 5; i++) await turn();
    frames.forEach((list, i) => {
      assert.equal(list.length, 1); assert.equal(list[0].codec, 'h264'); assert.equal(list[0].keyframe, true);
      assert.deepEqual(list[0].data, Buffer.from([0, 0, 0, 1, 0x65, i + 1, i + 1, i + 1]));
    });
    assert.equal(peer.clients.size, 1); assert.equal(peer.binds.length, 10); assert.equal(peer.errors.length, 0);
    result.close(); await turn();
    assert.equal(result.tunnel.closed, true); assert.equal(result.tunnel.socket.closed, true);
    assert.equal(result.tunnel.socket.waiters.length, 0); assert.equal(result.tunnel.socket.early.length, 0);
    assert.equal(result.tunnel.session.framer.buffer.length, 0); assert.equal(result.tunnel.session.outstanding.length, 0);
  } finally {
    if (result) result.close();
    await Promise.all(clients.map(client => client.close().catch(() => {})));
    await peer.close();
  }
});

test('handshake cancellation, rejection and timeout expose no credentials and free UDP resources', async () => {
  const peer = await openLocalPeer({ ignore: true }), control = signalSource();
  try {
    const opening = openInstaTunnel({ deviceid: 'fixture-device', username: 'fixture-user', password: 'fixture-password' },
      { cloud: peer.cloud, signal: control.signal, timeoutMs: 5000 });
    const check = assert.rejects(opening, error => error.code === 'ABORT_ERR' && !/fixture-(device|user|password)/.test(error.stack));
    await delay(10); control.abort(); await check; assert.equal(control.listeners(), 0);
    await assert.rejects(openInstaTunnel({ serial: 'fixture-device', username: 'fixture-user', password: 'fixture-password' },
      { cloud: peer.cloud, timeoutMs: 50, handshakeTimeoutMs: 10 }), { code: 'ERR_INSTAON_TIMEOUT' });
  } finally { await peer.close(); }
  const rejected = await openLocalPeer({ rejectChannel: true });
  try {
    await assert.rejects(openInstaTunnel({ deviceid: 'fixture-device', username: 'fixture-user', password: 'fixture-password' },
      { cloud: rejected.cloud, localAddresses: ['127.0.0.1'], timeoutMs: 200 }), error =>
      error.code === 'ERR_INSTAON_REJECTED' && error.statusCode === 403 && !/fixture-(device|user|password)/.test(error.stack));
    assert.equal(rejected.errors.length, 0);
  } finally { await rejected.close(); }
});

test('DH socket close rejects waiters immediately, clears timers, and caps unsolicited responses', async () => {
  const socket = new InstaSocket(), peer = dgram.createSocket('udp4');
  try {
    await new Promise(resolve => peer.bind(0, '127.0.0.1', resolve)); await socket.bind();
    const remote = { host: '127.0.0.1', port: peer.address().port };
    for (let i = 0; i < 50; i++) socket.receive(Buffer.from('HTTP/1.1 200 OK\r\nCSeq: ' + i + '\r\n\r\n'), { address: remote.host, port: remote.port });
    assert.equal(socket.early.length, 32);
    const pending = socket.readFinal(remote, 30000, [1000]);
    const rejected = assert.rejects(pending, { code: 'ERR_INSTAON_CLOSED' }); socket.close(); await rejected;
    assert.equal(socket.waiters.length, 0); assert.equal(socket.early.length, 0); assert.equal(socket.sock.listenerCount('message'), 0);
  } finally { socket.close(); await new Promise(resolve => peer.close(resolve)); }
});

(async () => {
  for (const entry of tests) {
    await entry.run();
    console.log('PASS ' + entry.name);
  }
  console.log(tests.length + ' offline core fixtures passed on ' + process.version);
})().catch(error => { console.error(error); process.exitCode = 1; });
