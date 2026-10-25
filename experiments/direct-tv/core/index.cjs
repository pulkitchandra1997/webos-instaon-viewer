'use strict';
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const os = require('os');
const { promisify } = require('util');
const { RtspClient } = require('../build/transport-node12.cjs');
const { InstaSocket } = require('./socket.cjs');
const { FramedPtcpSession } = require('./ptcp.cjs');
const { MultiTunnel } = require('./multi-tunnel.cjs');
const { CLOUD, xml, decryptInfo, deviceKey, encryptAddress, deviceAuth } = require('./protocol.cjs');
const { bodies } = require('../build/transport-node12.cjs');
const { fault, onAbort, positive } = require('./errors.cjs');

async function endpoint(value) {
  let host, port;
  if (typeof value === 'string') {
    const i = value.lastIndexOf(':'); host = value.slice(0, i); port = Number(value.slice(i + 1));
  } else if (value) { host = value.host; port = value.port; }
  if (typeof host !== 'string' || !host || !Number.isInteger(port) || port < 1 || port > 65535) throw fault('ERR_INSTAON_ENDPOINT', 'Invalid InstaOn peer endpoint');
  if (!net.isIPv4(host)) host = (await promisify(dns.lookup)(host, { family: 4 })).address;
  return { host, port };
}
function localAddresses() {
  const interfaces = os.networkInterfaces(), addresses = [];
  for (const key of Object.keys(interfaces)) {
    for (const i of interfaces[key] || []) if ((i.family === 'IPv4' || i.family === 4) && !i.internal) addresses.push(i.address);
  }
  return addresses.length ? addresses : ['127.0.0.1'];
}

async function openInstaTunnel(credentials, opts) {
  const o = opts || {}, c = credentials || {};
  const serial = c.deviceid || c.serial;
  if (typeof serial !== 'string' || !serial || typeof c.username !== 'string' || !c.username || typeof c.password !== 'string') throw fault('ERR_INSTAON_CREDENTIALS', 'Device ID, username and password are required');
  const timeout = positive(o.timeoutMs, 8000, 'timeoutMs');
  const totalTimeout = positive(o.handshakeTimeoutMs, 45000, 'handshakeTimeoutMs');
  if (o.signal && o.signal.aborted) throw fault('ABORT_ERR', 'InstaOn connection cancelled');
  const socket = new InstaSocket();
  let session, tunnel, key, stage = 'bind', stopped = false, failed;
  let removeAbort = function () {}, rejectStop;
  const stoppedPromise = new Promise((resolve, reject) => { rejectStop = reject; });
  // Always observed even if a stop lands between two awaited operations.
  stoppedPromise.catch(function () {});
  const stop = error => {
    if (stopped) return;
    stopped = true; failed = error;
    if (session) session.close('ERR_INSTAON_HANDSHAKE');
    socket.close(error);
    rejectStop(error);
  };
  const timer = setTimeout(() => stop(fault('ERR_INSTAON_TIMEOUT', 'InstaOn handshake timeout')), totalTimeout);
  removeAbort = onAbort(o.signal, () => stop(fault('ABORT_ERR', 'InstaOn connection cancelled')));
  socket.onFailure = stop;
  const wait = async (name, work) => {
    stage = name;
    if(typeof o.onProgress==='function')try{o.onProgress(name);}catch(_){}
    if (stopped) throw failed;
    const value = await Promise.race([Promise.resolve().then(work), stoppedPromise]);
    if (stopped) throw failed;
    return value;
  };
  const call = (name, peer, target, body, extra) => wait(name, () => socket.call(peer, target, body, Object.assign({ timeoutMs: timeout }, extra)));
  try {
    await wait('bind', () => socket.bind());
    const main = await wait('cloud-dns', () => endpoint(o.cloud || CLOUD));
    const clockSent=Date.now();
    const warmup=await call('stun', main, '/online/stun', undefined, { warmup: true });
    // STUN is unauthenticated and returns the selected cloud peer's time. Use
    // it only for this session's protocol timestamps, never set the TV clock.
    // Bound the adjustment to one day and ignore malformed/missing dates.
    const clockReceived=Date.now(),cloudTime=Date.parse(warmup.headers.date);
    const offset=cloudTime+(clockReceived-clockSent)/2-clockReceived;
    if(Number.isFinite(offset)&&Math.abs(offset)<=86400000)socket.clockOffsetMs=offset;
    const authNow=()=>Date.now()+socket.clockOffsetMs;
    const online = await call('online', main, '/online/p2psrv/' + encodeURIComponent(serial));
    const relayRes = await call('relay', main, '/online/relay');
    const peer = await wait('device-dns', () => endpoint(online.body['body/US']));
    await call('probe', peer, '/probe/device/' + encodeURIComponent(serial));
    const infoRes = await call('info', peer, '/info/device/' + encodeURIComponent(serial));
    const info = decryptInfo(infoRes.body['body/Info']);
    const ips = o.localAddresses || localAddresses();
    if (!Array.isArray(ips) || !ips.length || ips.some(ip => !net.isIPv4(ip))) throw fault('ERR_INSTAON_OPTIONS', 'Invalid localAddresses');
    const address = (ips.length > 1 ? ips.slice(1).join(',') : ips[0]) + ',' + ips[0] + ':' + socket.localPort;
    const salt = info && info.randsalt || '';
    let encrypted = address, auth = '';
    if (salt) {
      key = deviceKey(c.username, c.password, salt);
      const nonce = crypto.randomBytes(4).readUInt32BE(0);
      encrypted = await wait('channel-auth', () => encryptAddress(key, nonce, address));
      auth = deviceAuth(c.username, key, nonce, salt, encrypted,authNow());
    }
    const identify = Array.from(crypto.randomBytes(8), x => x.toString(16).padStart(2, '0')).join(' ');
    const body = '<body>' + auth + '<Identify>' + identify + '</Identify><' + (salt ? 'IpEncrptV2' : 'IpEncrpt') + '>true</' + (salt ? 'IpEncrptV2' : 'IpEncrpt') + '><NatValueT>0</NatValueT><version>6.7.15</version><sVersion>1.1.0</sVersion><LocalAddr>' + encrypted + '</LocalAddr><Pid>0</Pid><ClientId>' + crypto.randomBytes(16).toString('hex') + ':' + (info && info.rtspport || 554) + '</ClientId></body>';
    const channelSeq = socket.request(main, '/device/' + encodeURIComponent(serial) + '/p2p-channel', body, { pcsID: crypto.randomBytes(16).toString('hex') });
    const relay = await wait('relay-dns', () => endpoint(relayRes.body['body/Address']));
    const agentRes = await call('agent', relay, '/relay/agent');
    if (!agentRes.body['body/Token']) throw fault('ERR_INSTAON_PROTOCOL', 'Missing InstaOn relay token');
    const agent = await wait('agent-dns', () => endpoint(agentRes.body['body/Agent']));
    await call('agent-start', agent, '/relay/start/' + encodeURIComponent(agentRes.body['body/Token']), '<body><Client>:0</Client></body>');
    const channel = await wait('channel', () => socket.readFinal(main, timeout, [channelSeq]));
    if (channel.code !== 200) {
      const error = fault('ERR_INSTAON_REJECTED', 'InstaOn channel rejected'); error.statusCode = channel.code; throw error;
    }
    // Install PTCP before telling the recorder to join: SYNC may race the HTTP
    // join notification. Only the selected relay's datagrams enter the session.
    session = new FramedPtcpSession(Object.assign({}, o.ptcp, { transmit: data => socket.send(agent, data) }));
    const metadata = { info, firmware: infoRes.body['body/DevVersion'] || null };
    tunnel = new MultiTunnel(socket, session, metadata, o);
    let synced = false;
    const syncListener = b => { if (b.type === 'sync') synced = true; };
    session.on('body', syncListener);
    socket.onOther = (data, from) => { if (from.address === agent.host && from.port === agent.port) session.input(data); };
    const relayAuth = salt ? deviceAuth(c.username, key, crypto.randomBytes(4).readUInt32BE(0), salt, '',authNow()) : '';
    socket.request(main, '/device/' + encodeURIComponent(serial) + '/relay-channel', '<body>' + relayAuth + '<agentAddr>' + xml(agentRes.body['body/Agent']) + '</agentAddr></body>');
    const joined = await wait('agent-join', () => socket.readFinal(agent, timeout));
    if (joined.code !== 200) throw fault('ERR_INSTAON_REJECTED', 'InstaOn relay join rejected');
    await wait('ptcp-sync', () => new Promise((resolve, reject) => {
      let syncTimer;
      const finish = error => {
        clearTimeout(syncTimer);
        session.removeListener('body', onBody);
        session.removeListener('closed', onClosed);
        error ? reject(error) : resolve();
      };
      const onBody = b => { if (b.type === 'sync') finish(); };
      const onClosed = () => finish(fault('ERR_PTCP_CLOSED', 'PTCP closed during handshake'));
      session.on('body', onBody); session.once('closed', onClosed);
      syncTimer = setTimeout(() => finish(fault('ERR_INSTAON_TIMEOUT', 'PTCP sync timeout')), timeout);
      if (session.closed) return onClosed();
      if (synced) return finish();
      try { session.send(bodies.sync()); } catch (_) { onClosed(); }
    }));
    session.removeListener('body', syncListener);
    removeAbort();
    tunnel.abortCleanup = onAbort(o.signal, () => tunnel.close('ERR_INSTAON_ABORTED'));
    return { tunnel, info, firmware: metadata.firmware, close: reason => tunnel.close(reason) };
  } catch (error) {
    if (tunnel) tunnel.close('ERR_INSTAON_HANDSHAKE');
    else { if (session) session.close('ERR_INSTAON_HANDSHAKE'); socket.close(); }
    const safe = fault(error.code && /^(ERR_[A-Z0-9_]+|ABORT_ERR)$/.test(error.code) ? error.code : 'ERR_INSTAON_HANDSHAKE', 'InstaOn connection failed during ' + stage);
    safe.stage = stage;
    if (Number.isInteger(error.statusCode)) safe.statusCode = error.statusCode;
    throw safe;
  } finally {
    clearTimeout(timer); removeAbort();
    if (key) key.fill(0);
  }
}
module.exports = { openInstaTunnel, MultiTunnel, FramedPtcpSession, RtspClient };
