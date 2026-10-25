# Architecture

The TV hosts both the web frontend and its Node 12 service. The service authenticates with InstaOn, opens a UDP/PTCP tunnel to the recorder, and carries camera RTSP sessions in separate realms. Startup negotiation is serial for compatibility; established streams run together. A development computer is not part of the deployed media path.

## Components

| Location | Responsibility |
| --- | --- |
| `src/` | Frontend, focus/navigation, SD-grid/HD-single selection, Worker coordination, aspect/layout, WebGL presentation |
| `services/org.webos.instaonviewer.service/` | Luna lifecycle, session ownership, authenticated loopback media delivery, transport orchestration |
| `src/timing.js` | Standards-based RTCP/RTP clock mapping and bounded multi-channel alignment policy; only usable when transport and decoder provide trustworthy timestamps |
| `experiments/direct-tv/core/` | InstaOn/PTCP/RTSP protocol and channel/session support |
| `experiments/direct-tv/build/` | Ignored generated transport from the pinned npm dependency, prepared during `npm ci`; not vendored compiled upstream code |
| `experiments/direct-tv/decoder/` | Decoder integration wrappers; vendor JavaScript/WASM must be supplied separately |
| `test/` | Offline protocol, lifecycle, controls, decoder-contract, and rendering fixtures |
| `tools/` | Config creation, build/package, simulator launch/QA, and privacy checks |
| `docs/` | Stable contract, roadmap, architecture, skills provenance, and handoff |

The public app ID is `org.webos.instaonviewer`; its Luna service is `org.webos.instaonviewer.service`. Keep these identifiers aligned across metadata, service requests, packaging, and simulator registration.

## Media and control flow

The frontend requests an owned session through Luna. The service negotiates recorder access and returns an authenticated WebSocket endpoint on the same device. Encoded camera frames travel from the recorder through the service to one shared HEVC decoder Worker. The Worker transfers decoded frame data to the frontend; WebGL surfaces present the available channel frames in a shared animation callback. The local endpoint is on the TV in deployment and on the development computer in the simulator.

Selection travels back through the frontend and service. A grid requests existing SD streams. Enlargement selects a single HD stream and stops decoding hidden channels; returning restores the SD selection. Packets carry quality information so delayed SD data cannot feed the replacement HD decoder, or vice versa.

The decoder uses one WASM module with a 192 MiB heap budget for the supported channels. This is shared module ownership, not a claim that `SharedArrayBuffer` or multiple decoder heaps are required. Each channel can have one unpainted output. Presentation acknowledges the originating media link so a late acknowledgement cannot release credit on a replacement connection.

## Backpressure and recovery

The baseline service bounds encoded buffering to eight burst frames per channel, 2 MiB in aggregate, and 750 ms retained age. Overflow invalidates the reference chain and waits for a suitable keyframe. The Worker keeps channel state isolated; reconnect generations reject obsolete callbacks. Preserve these bounds unless a measured change supplies replacement limits.

A proven HEVC IDR can reuse a healthy decoder after a transport discontinuity. Unknown random-access types and decoder errors still reset conservatively. Persistent WebGL buffers retain the last image while a channel is stale; a shared presentation callback batches ready images. Neither mechanism creates camera synchronization or guarantees an interruption-free picture.

Pause, close, and backgrounding cancel active sessions and pending presentation work. Resume/reconnect must not resurrect callbacks from an earlier session. Recovery tests should cover both a stale channel and a failed shared transport.

## Timing and geometry

Authentication can apply a bounded cloud-derived offset within the session; it must not alter a system or recorder clock. Video timestamps are a separate problem. RTP clocks are independent and not yet mapped through RTCP sender reports to NTP. Decoder output PTS is not reliable enough for exact alignment. A future synchronization layer needs clock-domain mapping, wraparound handling, discontinuity detection, and a bounded presentation policy.

Source aspect metadata is preferred when present. Missing SAR leaves optical aspect unknown; Fit/Fill and explicit aspect overrides are display choices. Decoder processing time measures one stage and must not be called glass-to-glass latency.

## Configuration and trust boundaries

`config.example.json` defines the public schema. Untracked `config.local.json` is the single user-editable input for recorder credentials, tool/asset locations, viewer defaults, cloud endpoint, and optional device tooling. Configure must create it without overwriting existing values. Credentials belong to the service build/runtime boundary, not frontend UI, public test fixtures, diagnostics, or Git.

Generated service configuration and packages can contain private values and require private handling. Vendor decoder assets and simulator installers have separate rights from the public integration code. The own-code license decision is pending. `dahua-p2p@1.0.0` declares MIT in npm metadata but has a personal/research, non-commercial upstream README and no LICENSE file. Consult the separate LICENSING document; do not infer a project-wide license or permission to redistribute compiled packages. Installing a pinned dependency and ignoring generated transport avoids vendoring that compiled code in public Git but does not settle its license.

Simulator debugging uses the configured loopback port, default `9224`. Treat the debug endpoint as a local development capability. `television.enabled: false` prevents authorized tooling from opting into physical-device work; it does not prevent an explicitly configured simulator from contacting the recorder for media. Current work must remain offline or simulator-only as authorized, with no physical-TV contact and no recorder changes.
