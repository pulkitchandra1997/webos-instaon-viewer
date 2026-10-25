'use strict';
// CP PLUS app dialect and DeviceCrypto, extracted from instaon-media-probe.cjs
// and instaon-discovery.cjs. CamMob (MIT); see ../THIRD_PARTY_NOTICES.md.
// These are public application protocol constants, not recorder credentials.
const crypto = require('crypto');
const { promisify } = require('util');
const CLOUD = Object.freeze({ host: 'instaonserver.com', port: 8800,
  username: '89d61b61dc9a69fdcc03e4ff3a3be2f5', userKey: '993c7d7c95542c684c30ff9a9b831249' });

const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
function created(date) {
  const offset = -date.getTimezoneOffset(), n = Math.abs(offset);
  return new Date(date.getTime() + offset * 60000).toISOString().slice(0, 19) +
    (offset >= 0 ? '+' : '-') + String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}
function buildRequest(target, sequence, options) {
  const o = options || {}, date = o.created || created(new Date());
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
  const raw = data.toString('utf8').replace(/\r\n/g, '\n'), split = raw.indexOf('\n\n');
  const lines = (split < 0 ? raw : raw.slice(0, split)).split('\n');
  const first = lines.shift().match(/^HTTP\/\S+\s+(\d{3})\s*(.*)$/);
  if (!first) return null;
  const headers = Object.create(null), body = Object.create(null), stack = [];
  lines.forEach(line => { const p = line.indexOf(':'); if (p > 0) headers[line.slice(0, p).trim().toLowerCase()] = line.slice(p + 1).trim(); });
  const text = split < 0 ? '' : raw.slice(split + 2);
  const re = /<(\/?)([A-Za-z0-9_:.-]+)[^>]*?(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[4] !== undefined) { if (m[4].trim() && stack.length) body[stack.join('/')] = m[4].trim(); }
    else if (m[1]) stack.pop();
    else if (!m[3]) stack.push(m[2]);
  }
  return { code: Number(first[1]), headers, body };
}
function decryptInfo(value) {
  if (!value) return null;
  const decipher = crypto.createDecipheriv('aes-256-ofb', Buffer.from('kRjmsUB&ezmdGLL67H#$ojw@XflcaIaf'), Buffer.from('MydvJw*Iw1w&i^kk'));
  const text = Buffer.concat([decipher.update(Buffer.from(value, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(text.slice(0, text.lastIndexOf('}') + 1));
}
function deviceKey(user, password, salt) {
  return Buffer.from(crypto.createHash('md5').update(user + ':Login to ' + salt + ':' + password).digest('hex').toUpperCase());
}
async function encryptAddress(key, nonce, address) {
  const derived = await promisify(crypto.pbkdf2)(key, Buffer.from(String(nonce)), 20000, 32, 'sha256');
  try {
    const cipher = crypto.createCipheriv('aes-256-ofb', derived, Buffer.from('2z52*lk9o6HRyJrf'));
    return Buffer.concat([cipher.update(address, 'utf8'), cipher.final()]).toString('base64');
  } finally { derived.fill(0); }
}
function deviceAuth(user, key, nonce, salt, payload, now) {
  const date = Math.floor((now === undefined ? Date.now() : now) / 1000);
  const auth = crypto.createHmac('sha256', key).update(String(nonce) + date + payload).digest('base64');
  return '<CreateDate>' + date + '</CreateDate><DevAuth>' + auth + '</DevAuth><Nonce>' + nonce + '</Nonce><RandSalt>' + xml(salt) + '</RandSalt><UserName>' + xml(user) + '</UserName>';
}
module.exports = { CLOUD, xml, created, buildRequest, parseResponse, decryptInfo, deviceKey, encryptAddress, deviceAuth };
