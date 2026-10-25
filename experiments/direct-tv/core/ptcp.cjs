'use strict';
const { PtcpSession } = require('../build/transport-node12.cjs');
const { fault, positive } = require('./errors.cjs');

// Upstream parseBody() accepts exactly one body per datagram, truncates split
// data, and loses all but the first coalesced body. Reassemble the ORDERED byte
// stream after upstream's sequence/retry layer, without changing the bundle.
class BodyFramer {
  constructor(onBody, options) {
    const o = options || {};
    this.onBody = onBody;
    this.maxBodyBytes = positive(o.maxBodyBytes, 256 * 1024, 'maxBodyBytes');
    this.buffer = Buffer.alloc(0);
  }
  push(chunk) {
    let offset = 0;
    // Incrementally consume input: a datagram may contain many small bodies,
    // while an incomplete body's retained bytes never exceed maxBodyBytes.
    while (offset < chunk.length) {
      const need = this.frameSize();
      const target = need || (this.buffer.length < 4 ? 4 : 12);
      const take = Math.min(target - this.buffer.length, chunk.length - offset);
      if (take > 0) {
        const part = chunk.subarray(offset, offset + take);
        this.buffer = this.buffer.length ? Buffer.concat([this.buffer, part]) : Buffer.from(part);
        offset += take;
      }
      const size = this.frameSize();
      if (size && this.buffer.length === size) {
        const raw = this.buffer;
        this.buffer = Buffer.alloc(0);
        const code = raw[0], realm = raw.length >= 12 ? raw.readUInt32BE(4) : 0;
        let body;
        if (code === 0) body = { type: 'sync' };
        else if (code === 0x10) body = { type: 'data', realm, data: raw.subarray(12) };
        else if (code === 0x11) body = { type: 'bind', realm, port: raw.readUInt32BE(12) };
        else if (code === 0x12) body = { type: 'status', realm, status: raw.toString('latin1', 12) };
        else body = { type: 'heartbeat' };
        if (this.onBody(body) === false) { this.clear(); return; }
      }
    }
  }
  frameSize() {
    const b = this.buffer;
    if (b.length < 4) return 0;
    if (b[0] === 0) {
      if (b.readUInt32BE(0) !== 0x00030100) throw fault('ERR_PTCP_FRAME', 'Invalid PTCP sync body');
      return 4;
    }
    if (b.length < 12) return 0;
    const code = b[0], len = b.readUInt32BE(0) & 0xffffff;
    let size;
    if (code === 0x10) size = 12 + len;
    // Bundled bind() writes length=0 despite its fixed eight-byte tail;
    // CamMob writes length=8. Both encodings are accepted.
    else if (code === 0x11 && (len === 0 || len === 8)) size = 20;
    else if (code === 0x12 && len === 4) size = 16;
    else if (code === 0x13 && len === 0) size = 12;
    else throw fault('ERR_PTCP_FRAME', 'Unsupported or unframed PTCP control body');
    if (size > this.maxBodyBytes) throw fault('ERR_PTCP_READ_LIMIT', 'PTCP body exceeds receive limit');
    return size;
  }
  clear() { this.buffer = Buffer.alloc(0); }
}

class FramedPtcpSession extends PtcpSession {
  constructor(options) {
    const o = options || {};
    const limits = {
      maxReorderBytes: positive(o.maxReorderBytes, 1024 * 1024, 'maxReorderBytes'),
      maxReorderPackets: positive(o.maxReorderPackets, 256, 'maxReorderPackets'),
      maxPendingBytes: positive(o.maxPendingBytes, 512 * 1024, 'maxPendingBytes')
    };
    const framer = new BodyFramer(function () {}, o);
    // Never pass a logger into the package transport.
    const safe = Object.assign({}, o);
    delete safe.log;
    super(safe);
    Object.assign(this, limits);
    this.framer = framer;
    framer.onBody = body => { this.emit('body', body); return !this.closed; };
  }
  accept(body) {
    this.rcvNext = (this.rcvNext + body.length) >>> 0;
    this.framer.push(body);
  }
  input(datagram) {
    if (this.closed) return false;
    // Bound the upstream early-datagram map before upstream copies a packet.
    if (datagram.length >= 24 && datagram.toString('ascii', 0, 4) === 'PTCP') {
      const sent = datagram.readUInt32BE(4), delta = (sent - this.rcvNext) >>> 0;
      if (delta && delta < 0x80000000 && !this.early.has(sent)) {
        let bytes = 0;
        for (const data of this.early.values()) bytes += data.length;
        if (this.early.size >= this.maxReorderPackets || bytes + datagram.length - 24 > this.maxReorderBytes) {
          this.close('ERR_PTCP_REORDER_LIMIT'); return false;
        }
      }
    }
    try { return super.input(datagram); }
    catch (error) { this.close(error.code || 'ERR_PTCP_FRAME'); return false; }
    finally { if (this.closed) this.cancelAck(); }
  }
  send(body) {
    if (this.closed) throw fault('ERR_PTCP_CLOSED', 'PTCP session closed');
    if (this.unacked + body.length > this.maxPendingBytes) throw fault('ERR_PTCP_WRITE_LIMIT', 'PTCP send window full');
    super.send(body);
  }
  onPeerAck(ack) {
    const before = this.unacked;
    super.onPeerAck(ack);
    if (this.unacked < before) this.emit('drain');
  }
  tick() {
    try { super.tick(); }
    catch (_) { this.close('ERR_PTCP_WRITE_LIMIT'); }
  }
  close(reason) {
    if (this.closed) return;
    if (this.framer) this.framer.clear();
    this.early.clear();
    this.outstanding.length = 0;
    this.sndUna = this.sndNext;
    super.close(reason);
  }
}
module.exports = { BodyFramer, FramedPtcpSession };
