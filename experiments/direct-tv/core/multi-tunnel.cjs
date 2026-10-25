'use strict';
const { EventEmitter } = require('events');
const { Duplex } = require('stream');
const crypto = require('crypto');
const { bodies } = require('../build/transport-node12.cjs');
const { fault, onAbort, positive } = require('./errors.cjs');

class Realm extends Duplex {
  constructor(id, port, tunnel) {
    super({ allowHalfOpen: false, autoDestroy: true,
      readableHighWaterMark: Math.min(16384, tunnel.maxReadBufferBytes),
      writableHighWaterMark: Math.min(16384, tunnel.maxWriteBufferBytes) });
    this.id = id;
    this.port = port;
    this.tunnel = tunnel;
    this.connected = false;
    this.remoteEnded = false;
    this.abortCleanup = function () {};
    this.pendingWrite = null;
    // A peer can close between CONN and the caller attaching stream handlers.
    // Errors remain observable, but this race cannot crash the process.
    this.on('error', function () {});
  }
  _read() {} // PTCP is push-driven; overflow closes only the slow realm.
  write(chunk, encoding, callback) {
    const cb = typeof encoding === 'function' ? encoding : callback;
    const length = typeof chunk === 'string' ? Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : undefined) : chunk.length;
    if (!this.destroyed && this.writableLength + length > this.tunnel.maxWriteBufferBytes) {
      const error = fault('ERR_REALM_WRITE_LIMIT', 'Realm write queue limit exceeded');
      this.destroy(error);
      if (cb) process.nextTick(cb, error);
      return false;
    }
    return super.write(chunk, encoding, callback);
  }
  _write(chunk, encoding, callback) {
    if (this.tunnel.closed || !this.connected) return callback(fault('ERR_REALM_CLOSED', 'Realm closed'));
    this.pendingWrite = { chunk, offset: 0, callback };
    this.tunnel.flushWrites();
  }
  _final(callback) { this.destroy(); callback(); }
  _destroy(error, callback) {
    this.abortCleanup();
    this.abortCleanup = function () {};
    this.tunnel.disconnect(this);
    const pending = this.pendingWrite;
    this.pendingWrite = null;
    // Drain retained receive bytes without keeping video data alive in a closed
    // stream. No extra application-level queue is maintained.
    while (this.read() !== null) {}
    if (pending) pending.callback(error || fault('ERR_REALM_CLOSED', 'Realm closed'));
    callback(error);
  }
  receive(data) {
    if (this.destroyed || this.remoteEnded || !data.length) return;
    if (this.readableLength + data.length > this.tunnel.maxReadBufferBytes) {
      this.destroy(fault('ERR_REALM_READ_LIMIT', 'Realm read queue limit exceeded'));
      return;
    }
    this.push(Buffer.from(data));
  }
}

class MultiTunnel extends EventEmitter {
  constructor(socket, session, handshake, options) {
    super();
    const o = options || {};
    this.maxRealms = positive(o.maxRealms, 32, 'maxRealms');
    this.bindTimeoutMs = positive(o.bindTimeoutMs, 8000, 'bindTimeoutMs');
    this.maxReadBufferBytes = positive(o.maxReadBufferBytes, 256 * 1024, 'maxReadBufferBytes');
    this.maxWriteBufferBytes = positive(o.maxWriteBufferBytes, 64 * 1024, 'maxWriteBufferBytes');
    this.socket = socket;
    this.session = session;
    this.handshake = handshake || {};
    this.realms = new Map();
    this.pendingBinds = new Map();
    this.closeReason = null;
    this.nextId = crypto.randomBytes(4).readUInt32BE(0) & 0x3fffffff;
    this.flushing = false;
    this.abortCleanup = function () {};
    this.bodyHandler = body => this.onBody(body);
    this.closedHandler = () => this.close('ERR_PTCP_CLOSED');
    this.drainHandler = () => this.flushWrites();
    session.on('body', this.bodyHandler);
    session.on('closed', this.closedHandler);
    session.on('drain', this.drainHandler);
    if (socket) socket.onFailure = () => this.close('ERR_INSTAON_UDP');
  }
  get closed() { return this.closeReason !== null; }
  get stats() {
    let readBytes = 0, writeBytes = 0;
    for (const realm of this.realms.values()) { readBytes += realm.readableLength; writeBytes += realm.writableLength; }
    return { realms: this.realms.size, pendingBinds: this.pendingBinds.size,
      bufferedReadBytes: readBytes, bufferedWriteBytes: writeBytes,
      udpBytesIn: this.socket ? this.socket.bytesIn : 0,
      udpBytesOut: this.socket ? this.socket.bytesOut : 0,
      unackedBytes: this.session.unacked, ptcp: Object.assign({}, this.session.stats) };
  }
  connect(port, options) {
    const o = options || {};
    if (this.closed) return Promise.reject(fault('ERR_TUNNEL_CLOSED', 'InstaOn tunnel closed'));
    if (port === undefined) port = 554;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.reject(fault('ERR_REALM_PORT', 'Invalid remote port'));
    if (o.signal && o.signal.aborted) return Promise.reject(fault('ABORT_ERR', 'Realm connection cancelled'));
    if (this.realms.size >= this.maxRealms) return Promise.reject(fault('ERR_REALM_LIMIT', 'Realm connection limit reached'));
    let timeout;
    try { timeout = positive(o.timeoutMs, this.bindTimeoutMs, 'timeoutMs'); }
    catch (error) { return Promise.reject(error); }
    // Monotonic IDs are not reused during this tunnel's lifetime, so delayed
    // DATA/CONN/DISC cannot become traffic for a newly opened realm.
    this.nextId = (this.nextId + 1) >>> 0;
    if (!this.nextId) { this.close('ERR_REALM_IDS'); return Promise.reject(fault('ERR_REALM_IDS', 'Realm identifiers exhausted')); }
    const realm = new Realm(this.nextId, port, this);
    this.realms.set(realm.id, realm);
    return new Promise((resolve, reject) => {
      const entry = { realm };
      entry.finish = error => {
        if (!this.pendingBinds.has(realm.id)) return;
        this.pendingBinds.delete(realm.id);
        clearTimeout(entry.timer);
        if (error) {
          realm.destroy();
          reject(error);
        } else { realm.connected = true; resolve(realm); }
      };
      entry.timer = setTimeout(() => entry.finish(fault('ERR_REALM_BIND_TIMEOUT', 'Realm bind timeout')), timeout);
      this.pendingBinds.set(realm.id, entry);
      realm.abortCleanup = onAbort(o.signal, () => {
        const error = fault('ABORT_ERR', 'Realm connection cancelled');
        if (this.pendingBinds.has(realm.id)) entry.finish(error);
        else realm.destroy(error);
      });
      try { if (!realm.destroyed) this.session.send(bodies.bind(realm.id, port)); }
      catch (_) { entry.finish(fault('ERR_REALM_BIND', 'Realm bind transport failed')); }
    });
  }
  flushWrites() {
    if (this.flushing || this.closed) return;
    this.flushing = true;
    try {
      let progressed;
      do {
        progressed = false;
        for (const realm of this.realms.values()) {
          const write = realm.pendingWrite;
          if (!write || realm.destroyed) continue;
          const count = Math.min(1280, write.chunk.length - write.offset);
          const window = this.session.maxPendingBytes;
          if (window && this.session.unacked + 12 + count > window - 256) continue;
          try { this.session.sendData(realm.id, write.chunk.subarray(write.offset, write.offset + count)); }
          catch (_) { realm.destroy(fault('ERR_REALM_WRITE', 'Realm write transport failed')); continue; }
          write.offset += count;
          progressed = true;
          if (write.offset === write.chunk.length) { realm.pendingWrite = null; write.callback(); }
        }
      } while (progressed && !this.closed);
    } finally { this.flushing = false; }
  }
  onBody(body) {
    if (this.closed) return;
    const realm = this.realms.get(body.realm);
    if (body.type === 'data') {
      if (realm) realm.receive(body.data);
      return;
    }
    if (body.type !== 'status') return;
    const status = body.status.replace(/\0+$/, '');
    const pending = this.pendingBinds.get(body.realm);
    if (status === 'CONN') {
      if (pending) pending.finish();
      else if (!realm) this.sendDisconnect(body.realm);
    } else if (status === 'DISC') {
      if (realm) realm.remoteEnded = true;
      if (pending) pending.finish(fault('ERR_REALM_REFUSED', 'Remote peer refused realm'));
      else if (realm) { realm.push(null); realm.destroy(); }
    }
  }
  sendDisconnect(id) {
    if (this.closed || this.session.closed) return;
    try { this.session.send(bodies.status(id, 'DISC')); } catch (_) {}
  }
  disconnect(realm) {
    if (!this.realms.has(realm.id)) return;
    this.realms.delete(realm.id);
    const pending = this.pendingBinds.get(realm.id);
    if (pending) pending.finish(fault('ERR_REALM_CLOSED', 'Realm closed before binding'));
    if (!realm.remoteEnded) this.sendDisconnect(realm.id);
  }
  close(reason) {
    if (this.closed) return;
    // Reasons may originate from a caller. Never retain arbitrary error text.
    this.closeReason = typeof reason === 'string' && /^ERR_[A-Z0-9_]+$/.test(reason) ? reason : 'closed';
    this.abortCleanup();
    this.abortCleanup = function () {};
    this.session.removeListener('body', this.bodyHandler);
    this.session.removeListener('closed', this.closedHandler);
    this.session.removeListener('drain', this.drainHandler);
    for (const entry of Array.from(this.pendingBinds.values())) entry.finish(fault('ERR_TUNNEL_CLOSED', 'InstaOn tunnel closed'));
    for (const realm of Array.from(this.realms.values())) realm.destroy();
    this.realms.clear();
    this.session.close(this.closeReason);
    if (this.socket) this.socket.close();
    this.emit('closed', this.closeReason);
  }
}
module.exports = { MultiTunnel, Realm };
