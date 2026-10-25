'use strict';
// CP PLUS app-dialect discovery, informed by CamMob (MIT, rajpdus 2026).
// See THIRD_PARTY_NOTICES.md. This requests metadata only; it never binds a
// relay, takes over a live session, sends the recorder password, or records video.
const crypto = require('crypto');
const dgram = require('dgram');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

const CLOUD = Object.freeze({ host: 'instaonserver.com', port: 8800,
  username: '89d61b61dc9a69fdcc03e4ff3a3be2f5', userKey: '993c7d7c95542c684c30ff9a9b831249' });
function created(date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const n = Math.abs(offset);
  const local = new Date(date.getTime() + offset * 60000).toISOString().slice(0, 19);
  return local + sign + String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}
function buildRequest(target, sequence, options) {
  const o = options || {};
  const date = o.created || created(new Date());
  const nonce = o.nonce === undefined ? crypto.randomBytes(4).readInt32BE(0) : o.nonce;
  const digest = crypto.createHash('sha1').update(String(nonce) + date + 'DHP2P:' + CLOUD.username + ':' + CLOUD.userKey).digest('base64');
  let text = (o.body === undefined ? 'DHGET' : 'DHPOST') + ' ' + target + ' HTTP/1.1\r\n';
  if (!o.warmup) text += 'X-Version: 6.7.15\r\nX-Sversion: 1.1.0\r\n';
  if (o.pcsID) text += 'x-pcs-request-id: ' + o.pcsID + '\r\n';
  text += 'X-ToUType: Client/Dmss_Android\r\nCSeq: ' + sequence + '\r\n';
  if (!o.warmup) text += 'Authorization: WSSE profile="UsernameToken"\r\nX-WSSE: UsernameToken Username="' + CLOUD.username + '", PasswordDigest="' + digest + '", Nonce="' + nonce + '", Created="' + date + '"\r\n';
  if (o.body !== undefined) text += 'Content-Type: \r\nContent-Length: ' + Buffer.byteLength(o.body) + '\r\n';
  return Buffer.from(text + '\r\n' + (o.body || ''));
}
function parseResponse(data) {
  const raw = data.toString('utf8').replace(/\r\n/g, '\n');
  const split = raw.indexOf('\n\n');
  const lines = (split < 0 ? raw : raw.slice(0, split)).split('\n');
  const first = lines.shift().match(/^HTTP\/\S+\s+(\d{3})\s*(.*)$/);
  if (!first) return null;
  const headers = {};
  lines.forEach(line => { const p = line.indexOf(':'); if (p >= 0) headers[line.slice(0, p).trim().toLowerCase()] = line.slice(p + 1).trim(); });
  const body = {}; const stack = [];
  const xml = split < 0 ? '' : raw.slice(split + 2);
  const re = /<(\/?)([A-Za-z0-9_:.-]+)[^>]*?(\/?)>|([^<]+)/g; let m;
  while ((m = re.exec(xml))) {
    if (m[4] !== undefined) { if (m[4].trim() && stack.length) body[stack.join('/')] = m[4].trim(); }
    else if (m[1]) stack.pop();
    else if (!m[3]) stack.push(m[2]);
  }
  return { code: Number(first[1]), status: first[2], headers, body };
}
function resolve(host) {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('DNS timeout')), 3500);
    dns.lookup(host, { family: 4 }, (error, address) => { clearTimeout(timer); error ? fail(error) : done(address); });
  });
}
class DiscoverySocket {
  constructor() { this.socket = dgram.createSocket('udp4'); this.closed = false; }
  async bind() { await new Promise((done, fail) => { this.socket.once('error', fail); this.socket.bind(0, '0.0.0.0', () => { this.socket.removeListener('error', fail); done(); }); }); }
  async call(peer, target, options) {
    if (this.closed) throw new Error('socket closed');
    const sequence = crypto.randomBytes(4).readInt32BE(0);
    const request = buildRequest(target, sequence, options);
    return new Promise((done, fail) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error('response timeout')), 3500);
      const finish = (error, value) => {
        if (settled) return; settled = true; clearTimeout(timer);
        this.socket.removeListener('message', onMessage); this.socket.removeListener('error', onError);
        error ? fail(error) : done(value);
      };
      const onError = error => finish(error);
      const onMessage = (data, from) => {
        if (from.address !== peer.host || from.port !== peer.port) return;
        const response = parseResponse(data);
        if (!response || response.code < 200) return;
        if (response.headers.cseq !== undefined && Number(response.headers.cseq) !== sequence) return;
        finish(null, response);
      };
      this.socket.on('message', onMessage); this.socket.once('error', onError);
      this.socket.send(request, peer.port, peer.host, error => { if (error) finish(error); });
    });
  }
  close() { if (!this.closed) { this.closed = true; this.socket.close(); } }
}
async function discover(serial) {
  const sock = new DiscoverySocket(); const steps = [];
  try {
    await sock.bind();
    const main = { host: await resolve(CLOUD.host), port: CLOUD.port };
    for (const endpoint of ['/online/stun', '/online/p2psrv/' + encodeURIComponent(serial), '/online/relay']) {
      const response = await sock.call(main, endpoint, { warmup: endpoint === '/online/stun' });
      steps.push({ stage: endpoint.replace(serial, '<device>'), code: response.code, bodyKeys: Object.keys(response.body) });
      if (endpoint.indexOf('/online/p2psrv/') === 0) {
        const us = response.body['body/US'];
        if (response.code !== 200 || !us) return { complete: false, steps };
        const pos = us.lastIndexOf(':');
        const peer = { host: await resolve(us.slice(0, pos)), port: Number(us.slice(pos + 1)) };
        for (const name of ['probe', 'info']) {
          const reply = await sock.call(peer, '/' + name + '/device/' + encodeURIComponent(serial));
          steps.push({ stage: '/' + name + '/device/<device>', code: reply.code, bodyKeys: Object.keys(reply.body) });
        }
      }
    }
    return { complete: steps.every(s => s.code === 200), steps };
  } catch (error) { return { complete: false, steps, error: error.code || error.message }; }
  finally { sock.close(); }
}
module.exports = { CLOUD, buildRequest, parseResponse, DiscoverySocket, discover, created };
// Deliberately no command-line live probe: npm test uses loopback fixtures only.
