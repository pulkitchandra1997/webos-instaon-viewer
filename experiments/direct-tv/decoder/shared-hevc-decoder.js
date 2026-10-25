(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./annexb.js'));
  else root.SharedHevcDecoder = factory(root.HevcAnnexB);
}(typeof self !== 'undefined' ? self : this, function (annexb) {
  'use strict';
  var owners = new WeakMap();
  function integer(value, min, max, name) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid ' + name);
    return value;
  }
  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
  function SharedHevcDecoder(module, options) {
    options = options || {};
    if (!module || !module._DECODE_InputOneFrame || !module.HEAPU8) throw new Error('Decoder runtime is not ready');
    if (owners.has(module)) throw new Error('Use the existing shared decoder for this WASM instance');
    this.module = module;
    this.maxChannels = integer(options.maxChannels === undefined ? 10 : options.maxChannels, 1, 10, 'maxChannels');
    this.maxWidth = integer(options.maxWidth === undefined ? 1920 : options.maxWidth, 64, 4096, 'maxWidth');
    this.maxHeight = integer(options.maxHeight === undefined ? 1088 : options.maxHeight, 64, 4096, 'maxHeight');
    this.maxAccessUnitBytes = integer(options.maxAccessUnitBytes === undefined ? 1048576 : options.maxAccessUnitBytes, 4096, 5242880, 'maxAccessUnitBytes');
    this.maxPending = integer(options.maxPending === undefined ? 16 : options.maxPending, 2, 64, 'maxPending');
    this.maxHeapBytes = integer(options.maxHeapBytes === undefined ? 201326592 : options.maxHeapBytes, 201326592, 1073741824, 'maxHeapBytes');
    this.outputCapacity = Math.ceil(this.maxWidth * this.maxHeight * 1.5);
    this.channels = new Map(); this.allocations = []; this.busy = false; this.disposed = false;
    this.heapBudgetExceeded = false;
    var self = this;
    function allocate(size) {
      var pointer = module._malloc(size);
      if (!pointer) throw new Error('WASM scratch allocation failed');
      self.allocations.push({ pointer: pointer, bytes: size }); return pointer;
    }
    try {
      this.handlePointer = allocate(4);
      this.inputPointer = allocate(this.maxAccessUnitBytes + 64);
      this.outputPointer = allocate(this.outputCapacity + 64);
      this.lengthPointer = allocate(4);
      this.infoPointer = allocate(40);
    } catch (error) { this.allocations.forEach(function (a) { module._free(a.pointer); }); throw error; }
    owners.set(module, this);
  }
  SharedHevcDecoder.prototype._alive = function () { if (this.disposed) throw new Error('Decoder is disposed'); };
  SharedHevcDecoder.prototype._checkHeap = function () {
    if (this.module.HEAPU8.byteLength > this.maxHeapBytes) this.heapBudgetExceeded = true;
    if (this.heapBudgetExceeded) throw new Error('Decoder heap budget exceeded; dispose and terminate the worker to reclaim memory');
  };
  SharedHevcDecoder.prototype.open = function (channelId) {
    this._alive();
    this._checkHeap();
    if (this.busy) throw new Error('Cannot open during decode');
    if (typeof channelId !== 'string' && typeof channelId !== 'number') throw new Error('channelId must be a string or number');
    if (this.channels.has(channelId)) throw new Error('Channel is already open');
    if (this.channels.size >= this.maxChannels) throw new Error('Decoder channel limit reached');
    var m = this.module; m.HEAPU32[this.handlePointer >>> 2] = 0;
    if (m._DECODE_GetFreePort(this.handlePointer) !== 1) throw new Error('No decoder port available');
    var port = m.HEAPU32[this.handlePointer >>> 2];
    for (var state of this.channels.values()) if (state.port === port) throw new Error('Vendor returned a port still in use');
    if (m._DECODE_Init(port) !== 1) { m._DECODE_Stop(port); throw new Error('Decoder port initialization failed'); }
    this.channels.set(channelId, { port: port, sequence: 0, outputs: 0, sps: null,
      started: false, noOutput: 0, rejected: false });
    this._checkHeap();
    return { channelId: channelId, port: port };
  };
  SharedHevcDecoder.prototype._input = function (state, bytes) {
    var m = this.module;
    m.HEAPU8.set(bytes, this.inputPointer);
    m.HEAPU8.fill(0, this.inputPointer + bytes.length, this.inputPointer + bytes.length + 64);
    m.HEAPU8.fill(0, this.infoPointer, this.infoPointer + 40);
    m.HEAPU32[this.lengthPointer >>> 2] = 0;
    m.HEAPU8.fill(0xa5, this.outputPointer + this.outputCapacity, this.outputPointer + this.outputCapacity + 64);
    var result = m._DECODE_InputOneFrame(state.port, this.inputPointer, bytes.length,
      this.outputPointer, this.lengthPointer, this.infoPointer);
    this._checkHeap();
    if (result !== 1) throw new Error('DECODE_InputOneFrame failed: ' + result);
    for (var guard = 0; guard < 64; guard++) {
      if (m.HEAPU8[this.outputPointer + this.outputCapacity + guard] !== 0xa5) throw new Error('Decoder output exceeded configured capacity');
    }
    return m.HEAPU32[this.lengthPointer >>> 2];
  };
  // Input MUST be one complete HEVC Annex B access unit, after RTP FU/AP assembly.
  // It must include VPS/SPS/PPS at startup/reconnect. This is not an RTP parser.
  SharedHevcDecoder.prototype.decode = function (channelId, bytes, metadata) {
    this._alive();
    this._checkHeap();
    var state = this.channels.get(channelId);
    if (!state) throw new Error('Channel is not open');
    if (state.rejected) throw new Error('Close/reopen this channel after its decoder error');
    if (this.busy) throw new Error('Shared WASM decoder cannot be entered recursively');
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > this.maxAccessUnitBytes) throw new Error('Invalid or oversized Annex B access unit');
    metadata = metadata || {};
    var list = annexb.nals(bytes);
    if (!list.length || list[0].start !== 0) throw new Error('Expected Annex B HEVC, not RTP, AVCC or a vendor frame envelope');
    var vcl = list.filter(function (n) { return n.type <= 31; });
    var randomAccess = vcl.some(function (n) { return n.type >= 16 && n.type <= 23; });
    for (var nal of list) if (nal.type === 33) {
      var sps = annexb.spsDimensions(nal.bytes);
      if (sps.width <= 0 || sps.height <= 0 || sps.codedWidth > this.maxWidth || sps.codedHeight > this.maxHeight ||
          sps.chromaFormat !== 1 || sps.bitDepthLuma !== 8 || sps.bitDepthChroma !== 8 || sps.width % 2 || sps.height % 2) {
        throw new Error('Only bounded 8-bit 4:2:0 HEVC is supported');
      }
      if (sps.maxNumReorderPics !== 0) throw new Error('B-frame reordering is not supported by this low-latency wrapper');
      if (state.sps && JSON.stringify(state.sps) !== JSON.stringify(sps)) throw new Error('SPS changed; close/reopen channel before submitting the new keyframe');
      state.sps = sps;
    }
    if (!vcl.length) throw new Error('Combine parameter sets with a complete VCL access unit');
    if (!state.sps) throw new Error('First access unit must include a valid SPS');
    if (!state.started && !randomAccess) throw new Error('First access unit must be a random access frame');
    if (!state.started && ![32, 34].every(function (type) { return list.some(function (n) { return n.type === type; }); })) {
      throw new Error('First access unit must include VPS and PPS');
    }
    if (state.noOutput >= this.maxPending) { state.rejected = true; throw new Error('Decoder produced no output within its bounded pending window'); }
    this.busy = true;
    try {
      if (!state.started) {
        // Pinned SDK consumes its first raw AU to recognize the format. Replaying
        // ONLY the first keyframe recovers frame 0; all later AUs are sent once.
        if (this._input(state, bytes) !== 0) throw new Error('Unexpected first-call output for pinned decoder');
        state.started = true;
      }
      var number = state.sequence++;
      var length = this._input(state, bytes);
      if (length === 0) { state.noOutput++; return null; } // return=1 is not proof that a frame exists.
      state.noOutput = 0;
      var m = this.module, view = new DataView(m.HEAPU8.buffer, this.infoPointer, 40);
      var width = view.getUint16(16, true), height = view.getUint16(18, true);
      if (width !== state.sps.width || height !== state.sps.height || length !== width * height * 1.5 || length > this.outputCapacity) {
        throw new Error('Unsupported decoder output dimensions or plane layout');
      }
      var sar = state.sps.sampleAspectRatio;
      var numerator = width * sar.numerator, denominator = height * sar.denominator, divisor = gcd(numerator, denominator);
      var data = m.HEAPU8.slice(this.outputPointer, this.outputPointer + length);
      var yLength = width * height, chromaLength = yLength / 4;
      state.outputs++;
      return { channelId: channelId, port: state.port, format: 'I420', bitDepth: 8,
        width: width, height: height, codedWidth: state.sps.codedWidth, codedHeight: state.sps.codedHeight,
        sampleAspectRatio: { numerator: sar.numerator, denominator: sar.denominator, source: sar.source },
        displayAspectRatio: { numerator: numerator / divisor, denominator: denominator / divisor, source: sar.source },
        colour: { fullRange: state.sps.colour.fullRange, primaries: state.sps.colour.primaries,
          transfer: state.sps.colour.transfer, matrix: state.sps.colour.matrix }, pts: null, sequence: state.outputs - 1,
        submittedSequence: number, latestInputPts: Number.isFinite(metadata.pts) ? metadata.pts : null,
        // The SDK can discard startup pictures; do not mislabel pixels with the
        // current input PTS or assume a fixed FIFO delay from synthetic results.
        timestampMapping: 'unavailable-for-raw-annexb', data: data,
        y: data.subarray(0, yLength), u: data.subarray(yLength, yLength + chromaLength), v: data.subarray(yLength + chromaLength),
        planes: [ { offset: 0, stride: width, width: width, height: height },
          { offset: yLength, stride: width / 2, width: width / 2, height: height / 2 },
          { offset: yLength + chromaLength, stride: width / 2, width: width / 2, height: height / 2 } ],
        infoBytes: m.HEAPU8.slice(this.infoPointer, this.infoPointer + 40) };
    } catch (error) { state.rejected = true; throw error; }
    finally { this.busy = false; }
  };
  SharedHevcDecoder.prototype.close = function (channelId) {
    this._alive();
    if (this.busy) throw new Error('Cannot close during decode');
    var state = this.channels.get(channelId);
    if (!state) return false;
    if (this.module._DECODE_Stop(state.port) !== 1) throw new Error('Decoder port stop failed');
    this.channels.delete(channelId); return true;
  };
  SharedHevcDecoder.prototype.stats = function () {
    this._alive();
    return { wasmBytes: this.module.HEAPU8.byteLength,
      maxHeapBytes: this.maxHeapBytes, heapBudgetExceeded: this.heapBudgetExceeded,
      scratchBytes: this.allocations.reduce(function (sum, a) { return sum + a.bytes; }, 0),
      channels: Array.from(this.channels, function (entry) {
        return { channelId: entry[0], port: entry[1].port, submitted: entry[1].sequence,
          decoded: entry[1].outputs, consecutiveNoOutput: entry[1].noOutput };
      }) };
  };
  SharedHevcDecoder.prototype.dispose = function () {
    if (this.disposed) return;
    var self = this;
    Array.from(this.channels.keys()).forEach(function (id) { self.close(id); });
    this.allocations.forEach(function (a) { self.module._free(a.pointer); });
    this.allocations = []; this.disposed = true; owners.delete(this.module);
  };
  return SharedHevcDecoder;
}));
