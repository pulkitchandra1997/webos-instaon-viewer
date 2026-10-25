'use strict';
const { DhSocket } = require('../build/transport-node12.cjs');
const crypto = require('crypto');
const { buildRequest, parseResponse, created } = require('./protocol.cjs');
const { fault } = require('./errors.cjs');

// Retains the bundled datagram transport; replaces its DH request dialect and
// waiter lifecycle. The original close() leaves read promises/timers pending.
class InstaSocket extends DhSocket {
  constructor() {
    super(); // No logger: upstream logging contains credentials and raw XML.
    this.onFailure = null;
    this.bindCancel = null;
    this.clockOffsetMs = 0;
    this.sock.removeAllListeners('message');
    this.sock.on('message', (data, from) => this.receive(data, from));
    this.socketError = () => this.fail(fault('ERR_INSTAON_UDP', 'InstaOn datagram transport failed'));
    this.sock.on('error', this.socketError);
  }
  bind() {
    if (this.closed) return Promise.reject(fault('ERR_INSTAON_CLOSED', 'InstaOn socket closed'));
    return new Promise((resolve, reject) => {
      const finish = error => {
        this.bindCancel = null;
        this.sock.removeListener('listening', ready);
        error ? reject(error) : resolve(this.localPort);
      };
      const ready = () => finish();
      this.bindCancel = finish;
      this.sock.once('listening', ready);
      try { this.sock.bind(0); } catch (_) { finish(fault('ERR_INSTAON_UDP', 'InstaOn socket bind failed')); }
    });
  }
  send(to, data) {
    if (this.closed) throw fault('ERR_INSTAON_CLOSED', 'InstaOn socket closed');
    this.bytesOut += data.length + 28;
    try {
      this.sock.send(data, to.port, to.host, error => { if (error && !this.closed) this.socketError(); });
    } catch (_) { this.socketError(); }
  }
  request(to, target, body, extra) {
    const sequence = crypto.randomBytes(4).readInt32BE(0);
    this.send(to, buildRequest(target, sequence, Object.assign({created:created(new Date(Date.now()+this.clockOffsetMs))}, extra, body === undefined ? {} : { body })));
    return sequence;
  }
  receive(data, from) {
    if (this.closed) return;
    this.bytesIn += data.length + 28;
    if (data.length >= 5 && data.toString('ascii', 0, 5) === 'HTTP/') {
      if (data.length > 16384) return;
      const response = parseResponse(data);
      if (!response) return;
      const i = this.waiters.findIndex(w => this.matches(w.from, w.cseqs, from, response));
      if (i >= 0) this.waiters[i].resolve(response);
      else {
        if (this.early.length >= 32) this.early.shift();
        this.early.push({ from: { host: from.address, port: from.port }, res: response });
      }
    } else if (this.onOther) this.onOther(data, from);
  }
  matches(peer, sequences, from, response) {
    return peer.host === (from.address || from.host) && peer.port === from.port &&
      (!sequences || response.headers.cseq === undefined || sequences.indexOf(Number(response.headers.cseq)) >= 0);
  }
  read(from, timeoutMs, cseqs) {
    if (this.closed) return Promise.reject(fault('ERR_INSTAON_CLOSED', 'InstaOn socket closed'));
    const i = this.early.findIndex(e => this.matches(from, cseqs, e.from, e.res));
    if (i >= 0) return Promise.resolve(this.early.splice(i, 1)[0].res);
    return new Promise((resolve, reject) => {
      const waiter = { from, cseqs };
      const finish = (error, response) => {
        clearTimeout(waiter.timer);
        const index = this.waiters.indexOf(waiter);
        if (index < 0) return;
        this.waiters.splice(index, 1);
        error ? reject(error) : resolve(response);
      };
      waiter.resolve = res => finish(null, res);
      waiter.reject = err => finish(err);
      waiter.timer = setTimeout(() => finish(fault('ERR_INSTAON_TIMEOUT', 'InstaOn response timeout')), timeoutMs);
      this.waiters.push(waiter);
    });
  }
  async call(to, target, body, options) {
    const o = options || {}, sequence = this.request(to, target, body, o);
    const response = await this.readFinal(to, o.timeoutMs || 3000, [sequence]);
    if (response.code !== 200) {
      const error = fault('ERR_INSTAON_REJECTED', 'InstaOn request rejected');
      error.statusCode = response.code;
      throw error;
    }
    return response;
  }
  fail(error) {
    if (this.closed) return;
    const notify = this.onFailure;
    this.close(error);
    if (notify) notify(error);
  }
  close(error) {
    if (this.closed) return;
    const reason = error || fault('ERR_INSTAON_CLOSED', 'InstaOn socket closed');
    if (this.bindCancel) this.bindCancel(reason);
    this.waiters.slice().forEach(w => w.reject(reason));
    this.early.length = 0;
    this.onOther = null;
    this.onFailure = null;
    super.close();
    this.sock.removeAllListeners('message');
    this.sock.removeListener('error', this.socketError);
  }
}
module.exports = { InstaSocket };
