'use strict';
// Runs unchanged under Node 12.22.2 and modern Node. No real cloud requests.
const assert = require('assert').strict;
const crypto = require('crypto');
const dgram = require('dgram');
const { CLOUD, buildRequest, parseResponse, DiscoverySocket } = require('./instaon-discovery.cjs');
(async () => {
  let checks = 0;
  const date = '2026-10-25T15:30:00+05:30';
  const text = buildRequest('/probe/device/example', -123, { created: date, nonce: -456 }).toString();
  const digest = crypto.createHash('sha1').update('-456' + date + 'DHP2P:' + CLOUD.username + ':' + CLOUD.userKey).digest('base64');
  assert.ok(text.includes('PasswordDigest="' + digest + '"')); checks++;
  assert.ok(text.includes('CSeq: -123\r\n') && text.includes('X-Version: 6.7.15\r\n')); checks++;
  const warmup = buildRequest('/online/stun', 7, { warmup: true }).toString();
  assert.ok(!warmup.includes('Authorization:') && !warmup.includes('X-Version:')); checks++;
  const body = '<body><Name>测试</Name></body>';
  const post = buildRequest('/example', 8, { body, pcsID: 'fixture' }).toString();
  assert.ok(post.startsWith('DHPOST ') && post.includes('Content-Length: ' + Buffer.byteLength(body) + '\r\n')); checks++;
  assert.ok(post.endsWith('\r\n\r\n' + body) && post.includes('x-pcs-request-id: fixture\r\n')); checks++;
  const parsed = parseResponse(Buffer.from('HTTP/1.1 200 OK\r\nCSeq: -99\r\n\r\n<body><US>127.0.0.1:8800</US><Info>x</Info></body>'));
  assert.deepEqual({ code: parsed.code, sequence: parsed.headers.cseq, server: parsed.body['body/US'] }, { code: 200, sequence: '-99', server: '127.0.0.1:8800' }); checks++;
  assert.equal(parseResponse(Buffer.from('PTCP\x00\x01')), null); checks++;
  const server = dgram.createSocket('udp4'); const client = new DiscoverySocket();
  try {
    await new Promise(done => server.bind(0, '127.0.0.1', done)); await client.bind();
    server.once('message', (data, peer) => {
      const sequence = Number(data.toString().match(/CSeq: (-?\d+)/)[1]);
      const send = (code, seq) => server.send(Buffer.from('HTTP/1.1 ' + code + '\r\nCSeq: ' + seq + '\r\n\r\n<body><Result>fixture</Result></body>'), peer.port, peer.address);
      send('200 WRONG-SEQUENCE', sequence + 1); send('100 Continue', sequence);
      setTimeout(() => send('200 OK', sequence), 20);
    });
    const reply = await client.call({ host: '127.0.0.1', port: server.address().port }, '/fixture');
    assert.equal(reply.status, 'OK'); assert.equal(reply.body['body/Result'], 'fixture'); checks++;
    assert.equal(client.socket.listenerCount('message'), 0); checks++;
  } finally { client.close(); server.close(); }
  console.log(checks + ' protocol checks passed on ' + process.version);
})().catch(error => { console.error(error); process.exitCode = 1; });
