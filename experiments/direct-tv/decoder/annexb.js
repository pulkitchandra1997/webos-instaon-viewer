(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HevcAnnexB = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function nals(bytes) {
    var starts = [];
    for (var i = 0; i + 3 < bytes.length; i++) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) {
        var prefix = bytes[i + 2] === 1 ? 3 : bytes[i + 2] === 0 && bytes[i + 3] === 1 ? 4 : 0;
        if (prefix) { starts.push({ start: i, payload: i + prefix }); i += prefix - 1; }
      }
    }
    return starts.map(function (s, index) {
      var end = index + 1 < starts.length ? starts[index + 1].start : bytes.length;
      if (end - s.payload < 2) throw new Error('Truncated HEVC NAL header');
      if (bytes[s.payload] & 128 || (bytes[s.payload + 1] & 7) === 0) throw new Error('Invalid HEVC NAL header');
      return { type: (bytes[s.payload] >>> 1) & 63, start: s.start, payload: s.payload, end: end,
        bytes: bytes.subarray(s.payload, end) };
    });
  }
  function splitAccessUnits(bytes) {
    var list = nals(bytes), starts = list.filter(function (n) { return n.type === 35; });
    if (!starts.length) throw new Error('Fixture splitter requires AUD NALs; runtime accepts already reassembled access units');
    return starts.map(function (n, index) {
      return bytes.subarray(index === 0 ? 0 : n.start, index + 1 < starts.length ? starts[index + 1].start : bytes.length);
    });
  }
  function rbsp(nal) {
    var out = [], zeros = 0;
    for (var i = 2; i < nal.length; i++) {
      var value = nal[i];
      if (zeros >= 2 && value === 3) { zeros = 0; continue; }
      out.push(value); zeros = value === 0 ? zeros + 1 : 0;
    }
    return new Uint8Array(out);
  }
  function spsDimensions(nal) {
    var data = rbsp(nal), bit = 0;
    function read(count) {
      if (bit + count > data.length * 8) throw new Error('Truncated HEVC SPS');
      var value = 0;
      for (var i = 0; i < count; i++, bit++) value = value * 2 + ((data[bit >>> 3] >>> (7 - (bit & 7))) & 1);
      return value;
    }
    function skip(count) { read(count); }
    function ue() {
      var zeros = 0;
      while (read(1) === 0) if (++zeros > 30) throw new Error('Invalid HEVC Exp-Golomb');
      return Math.pow(2, zeros) - 1 + read(zeros);
    }
    skip(4); var layers = read(3); skip(1); skip(96);
    if (layers > 6) throw new Error('Unsupported HEVC temporal layer count');
    var profile = [], level = [];
    for (var layer = 0; layer < layers; layer++) { profile.push(read(1)); level.push(read(1)); }
    if (layers > 0) skip((8 - layers) * 2);
    for (var j = 0; j < layers; j++) { if (profile[j]) skip(88); if (level[j]) skip(8); }
    ue(); var chromaFormat = ue(), separate = chromaFormat === 3 ? read(1) : 0;
    var codedWidth = ue(), codedHeight = ue(), left = 0, right = 0, top = 0, bottom = 0;
    if (read(1)) { left = ue(); right = ue(); top = ue(); bottom = ue(); }
    var subWidth = chromaFormat === 1 || chromaFormat === 2 ? 2 : 1;
    var subHeight = chromaFormat === 1 ? 2 : 1;
    if (separate) subWidth = subHeight = 1;
    var info = { codedWidth: codedWidth, codedHeight: codedHeight,
      width: codedWidth - subWidth * (left + right), height: codedHeight - subHeight * (top + bottom),
      crop: { left: left * subWidth, right: right * subWidth, top: top * subHeight, bottom: bottom * subHeight },
      chromaFormat: chromaFormat, bitDepthLuma: 8 + ue(), bitDepthChroma: 8 + ue(),
      sampleAspectRatio: { numerator: 1, denominator: 1, source: 'assumed-square' },
      colour: { fullRange: null, primaries: null, transfer: null, matrix: null } };
    var log2MaxPoc = ue() + 4, allOrdering = read(1), maxReorder = 0;
    for (var order = allOrdering ? 0 : layers; order <= layers; order++) { ue(); maxReorder = Math.max(maxReorder, ue()); ue(); }
    info.maxNumReorderPics = maxReorder;
    ue(); ue(); ue(); ue(); ue(); ue();
    if (read(1) && read(1)) {
      for (var size = 0; size < 4; size++) for (var matrix = 0; matrix < 6; matrix += size === 3 ? 3 : 1) {
        if (!read(1)) ue();
        else { if (size > 1) ue(); for (var coefficient = 0; coefficient < Math.min(64, Math.pow(2, 4 + 2 * size)); coefficient++) ue(); }
      }
    }
    skip(1); skip(1);
    if (read(1)) { skip(4); skip(4); ue(); ue(); skip(1); }
    var shortTerms = ue(), deltaCounts = [];
    if (shortTerms > 64) throw new Error('Invalid HEVC short-term set count');
    for (var set = 0; set < shortTerms; set++) {
      var deltaCount = 0;
      if (set > 0 && read(1)) {
        skip(1); ue();
        for (var delta = 0; delta <= deltaCounts[set - 1]; delta++) {
          var used = read(1), useDelta = used || read(1);
          if (used || useDelta) deltaCount++;
        }
      } else {
        var negative = ue(), positive = ue(); deltaCount = negative + positive;
        if (deltaCount > 64) throw new Error('Invalid HEVC reference picture count');
        for (var picture = 0; picture < deltaCount; picture++) { ue(); skip(1); }
      }
      deltaCounts.push(deltaCount);
    }
    if (read(1)) {
      var longTerms = ue();
      if (longTerms > 32 || log2MaxPoc > 32) throw new Error('Invalid HEVC long-term references');
      for (var term = 0; term < longTerms; term++) { skip(log2MaxPoc); skip(1); }
    }
    skip(1); skip(1);
    if (read(1)) {
      if (read(1)) {
        var idc = read(8), sar = null;
        var sarTable = [null, [1,1], [12,11], [10,11], [16,11], [40,33], [24,11], [20,11],
          [32,11], [80,33], [18,11], [15,11], [64,33], [160,99], [4,3], [3,2], [2,1]];
        if (idc === 255) sar = [read(16), read(16)];
        else sar = sarTable[idc];
        if (sar && sar[0] > 0 && sar[1] > 0) info.sampleAspectRatio = { numerator: sar[0], denominator: sar[1], source: 'sps-vui' };
      }
      if (read(1)) skip(1);
      if (read(1)) {
        skip(3); info.colour.fullRange = !!read(1);
        if (read(1)) { info.colour.primaries = read(8); info.colour.transfer = read(8); info.colour.matrix = read(8); }
      }
    }
    return info;
  }
  return { nals: nals, splitAccessUnits: splitAccessUnits, spsDimensions: spsDimensions };
}));
