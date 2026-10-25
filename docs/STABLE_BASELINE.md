# v0.4.2 stable baseline

Status: **stable for personal use**, with the limitations below. This label preserves the existing webOS feature baseline; it does not certify production readiness, all recorder models, all webOS versions, or public redistribution of decoder assets.

## Included behavior

| Area | Baseline |
| --- | --- |
| Startup and grids | Ten configured cameras and the 10-tile layout by default; 4/8/10/16-tile layouts use SD extra streams. Unconfigured slots stay empty. Sixteen tiles do not establish sixteen simultaneous decoders. |
| Enlargement | One selected camera switches to HD; hidden channels stop decoding. Back returns to the SD grid. Quality tagging rejects packets from the previous SD/HD selection. |
| Controls | Arrow focus, explicit Enter/OK activation without duplicate activation, and Back key code 461. Back dismisses settings, then enlargement, before platform navigation. Pause/resume and Fit/Fill/aspect overrides are available. |
| Transport | The on-TV Node 12 service talks directly to CP PLUS InstaOn using UDP/PTCP and RTSP sessions. The TV package needs no laptop media gateway. |
| Decoder | One shared Worker/module with a 192 MiB WASM heap, rather than a heap per channel. At most one unpainted output per channel bounds presentation pressure. |
| Rendering | Persistent WebGL surfaces retain the last image between updates; available frames share one `requestAnimationFrame` callback. Stale state is labelled without intentionally clearing the last frame. |
| Recovery | Bounded queues, keyframe-aware recovery, per-channel retries, reconnect backoff, and session cancellation on closing/backgrounding. A proven HEVC IDR can retain a healthy decoder; unknown random-access types/errors use the conservative reset path. |

Fit/Fill and aspect overrides affect display only. They must not write recorder settings. A bounded, session-local cloud time adjustment supports authentication without changing the TV or recorder clock.

## Evidence boundary

The baseline summarizes existing implementation and prior owner-run checks: ten independently advancing SD channels on a physical TV, simulator layout/input checks and short media soaks, persistent rendering, and a shared heap of 201326592 bytes. Private logs, device details, and camera images are deliberately absent from this repository. This document does not represent a new hardware test or an independently reproducible public media benchmark.

The simulator runs on a development computer and can use a different service runtime. Its throughput and successful execution do not establish physical-TV speed or Node 12 compatibility. A short soak does not establish leak freedom. Fresh public-tree offline checks should be recorded with each change, separately from these historical observations.

## Known limits

- Physical-TV software decode throughput has been in the low single digits for SD grids and slower for HD. Ten simultaneous smooth HD streams are not a supported promise.
- Shared presentation batches coordinate drawing, not camera capture time. RTP clocks are independent; exact RTCP/RTP-to-NTP mapping and reliable decoded output timestamps are unimplemented. Do not compare raw RTP timestamps across cameras or label the result synchronized.
- The source can omit sample-aspect-ratio (SAR) metadata. Coded width/height alone cannot establish optical geometry. Aspect overrides are user choices, not calibrated corrections. Colour-matrix handling also remains limited.
- Persistent buffers reduce some visible interruptions but do not guarantee zero flicker, seamless quality changes, or uninterrupted recovery. Decode duration is not end-to-end latency.
- Profiles, discovery, multiple recorders, PTZ, audio, talk, recorded playback, and snapshot export are roadmap work rather than stable capabilities. Existing display settings are not a full connection/settings editor.

## Reproduction and release boundary

`npm ci` followed by `npm test` supports source checks without cameras or decoder assets. Actual build/playback needs private `config.local.json`, authorized vendor decoder assets, and the relevant webOS development tools. The public repository intentionally excludes recovered vendor decoder JavaScript/WASM and LG simulator installers.

The own-code license decision is pending. The pinned `dahua-p2p@1.0.0` dependency has conflicting license signals: MIT npm metadata, a personal/research, non-commercial upstream README, and no LICENSE file. See the separate LICENSING document; do not describe the entire project as MIT. Dependency preparation generates transport into ignored `experiments/direct-tv/build/`; compiled upstream transport is not vendored in public Git. This arrangement does not resolve the license ambiguity or authorize redistribution of generated packages.

Packages may embed secrets. Do not attach private IPKs, config, runtime logs, or footage to public releases. The public source tag/release **v0.4.2** was verified on 2026-10-25 at commit `152a4da`, with zero uploaded binary assets. Later documentation-only commits can follow on main without changing that accepted feature baseline. Recheck actual remote state before making future release claims. Use the [roadmap](ROADMAP.md) for work beyond this baseline and the [handoff](LLM_HANDOFF.md) for simulator-only continuation.
