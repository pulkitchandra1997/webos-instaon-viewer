'use strict';
// Upstream dependency stays in node_modules, not vendored into Git.
const {DhSocket}=require('dahua-p2p/dist/dhhttp.js');
const {PtcpSession,bodies}=require('dahua-p2p/dist/ptcp.js');
const {Tunnel}=require('dahua-p2p/dist/tunnel.js');
const {RtspClient}=require('dahua-p2p/dist/rtsp.js');
module.exports={DhSocket,PtcpSession,bodies,Tunnel,RtspClient};
