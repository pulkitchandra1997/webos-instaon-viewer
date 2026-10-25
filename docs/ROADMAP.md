# Feature and activity roadmap

v0.4.2 is the stable personal-use baseline. Everything below is planned work, not a claim of an implemented feature. Finish P0 before broadening the control surface. Select one bounded item per change, document dependencies, and attach reproducible acceptance evidence without private data. There are no promised delivery dates.

All current investigation is offline or uses an explicitly authorized local simulator. Do not contact the physical TV or change recorder settings. Hardware performance remains an unresolved validation gate until a later user-authorized session.

## P0 — performance, timing, rendering, reliability, and hygiene

| Activity | Implementation breakdown | Acceptance and dependencies |
| --- | --- | --- |
| Measure performance | Add bounded, redacted counters for transport arrival, queue age/drops, decode, copies, upload, and presentation. Build deterministic synthetic fixtures; compare 4/8/10 grids and HD single. Separate startup, steady-state, and recovery. | Report stage costs, frame age, heap and queue bounds. Never call decode time end-to-end latency. Simulator results cannot establish TV FPS; defer that claim until authorized hardware measurement. |
| Improve throughput | Use the measurements to reduce avoidable copies and allocations, retain safe decoder state, and schedule fair channel work. Explore a supported decoder/hardware path only behind a capability and licensing gate. | Preserve ten-channel default, bounded backpressure, Node 12 transport behavior, and correct SD/HD transitions. Compare the same fixtures and workload before/after; do not promise a frame-rate gain without evidence. |
| Establish timing foundations | Carry stream clock rate, sequence, RTP timestamp, generation, and trustworthy output timing where available. Implement RTCP sender-report parsing, RTP wraparound and NTP mapping; handle missing reports, clock jumps, and restarts. Then design a bounded alignment buffer and explicit unsynchronized fallback. | Offline timing fixtures must cover independent clocks and discontinuities. Exact capture alignment stays unavailable until both clock mapping and decoded-frame timestamp association are demonstrated. Shared rAF alone does not satisfy this gate. |
| Reduce visible interruptions | Preserve last valid pixels during gaps; audit clears, canvas replacement, context loss, reconnects, and quality transitions. Test generation and acknowledgement ownership plus keyframe recovery. | Synthetic frame patterns expose unintended blanking and stale-quality frames. Keep stale status visible. Any zero-flicker claim requires appropriate visual evidence and a defined test scope. |
| Soak and recovery | Add repeatable offline failure injection and authorized simulator soak scenarios for pause/resume, background/foreground, repeated selection, missing channels, transport failure, and context loss. Track heap, queues, timers, sockets, and session cleanup over time. | Define duration and thresholds in each run; report actual trends and failures. Short runs do not establish leak freedom. Keep camera images and private logs out of public artifacts. |
| Config and privacy | Validate the public schema, refuse configure overwrite, fail clearly on missing assets, redact errors, and keep credentials service-side. Audit build staging, tracked history, release attachments, and private package handling. Keep generated upstream transport ignored and decoder payloads excluded. | A clean clone can install dependencies and run offline tests without credentials/assets. Missing prerequisites fail clearly. Privacy checks and manual publication review must find no private values, vendored compiled upstream transport, or unauthorized vendor payloads. |

## P1 — connection and viewing workflows

| Feature | Implementation breakdown | Gate before exposure |
| --- | --- | --- |
| Profiles | Add versioned recorder/view profile models and migration from the current single-recorder config. Support camera labels, ordering, preferred layout, and local display choices. Separate secrets from shareable profile data. | Config validation, migration fixtures, deterministic defaults, and redacted import/export. Preserve the v0.4.2 startup path. |
| Discovery | Define capability queries and distinguish cloud recorder lookup from optional local discovery. Require an explicit user action and scope; apply timeouts/cancellation and redact identifiers. | A supported read-only protocol path and offline fixtures. No ambient scanning or physical-TV discovery as a side effect. |
| Multiple recorders | Add recorder-scoped session/channel identities, credentials, reconnect ownership, and fair decoder/queue budgets. Isolate partial failures and selection across recorders. | Profiles plus established session isolation. Enforce a measured global decoder limit; multiple recorders do not imply more simultaneous decoded channels. |
| Settings | Extend existing display settings with validated profile editing, connection status, capability explanation, and safe save/restart behavior. Keep the local config contract explicit. | Focus/Enter/Back tests, validation and cancellation paths, no secret echo, and no recorder-setting writes. A settings form must call a supported implementation. |

## P2 — optional camera and media controls

Each item is opt-in, capability-gated, and dependent on a supported protocol. Do not ship fake working buttons. Hide unavailable controls or explain their unavailable state without suggesting a command succeeded.

| Feature | Implementation breakdown | Gate before exposure |
| --- | --- | --- |
| PTZ | Investigate authorized control messages; add capability detection, bounded movement, explicit stop, focus-loss cleanup, and a command audit that excludes private values. | Explicit user authorization for actuator control and an appropriate test target. No motion during the current task. Stop semantics and error handling must be verified before enabling controls. |
| Audio listening | Identify audio codecs/transport and build decode, mute/volume, focus lifecycle, and A/V timing support. Release resources on pause and close. | Authorized source support, codec rights, and verified audio lifecycle. Do not imply A/V sync before timing foundations exist. |
| Talk | Investigate duplex transport, microphone permission, push-to-talk state, transmit indication, and guaranteed stop on release/disconnect/background. | Explicit microphone/transmission consent, supported recorder capability, codec rights, and fail-closed cleanup. No automatic microphone capture. |
| Recorded playback | Implement authorized recording search, a real timeline, session selection, seeking, cancellation, and return to live. Define recorder time-zone and timestamp semantics. | Read-only recorder APIs and timing foundations. Search/seek fixtures plus an authorized validation session; never change the recording schedule or retention. |
| Snapshots | Add a deliberate single-frame export action, supported format, ownership/privacy guidance, and platform storage handling. Avoid automatic uploads or capture. | Explicit user action and tested export support. Keep snapshots untracked and out of public QA/release attachments. |

## P3 — distribution and maintenance

Settle the license for project-owned code and the `dahua-p2p@1.0.0` ambiguity documented in the separate LICENSING document: its npm metadata says MIT, but the upstream README says personal/research, non-commercial use, and no LICENSE file accompanies the inspected package. The current pinned npm dependency generates ignored transport during `npm ci` preparation; do not vendor compiled upstream output or claim the project is MIT.

Resolve decoder provenance and redistribution permission, or replace it with a compatible licensed implementation. Inventory licenses and notices for dependencies; keep LG tools separately installed unless permission is established. Source licensing does not settle dependency, decoder, or installer rights.

Then make clean-clone build/package checks reproducible, document supported recorder/webOS combinations from evidence, and define private provisioning and update behavior. Choose sideloading, signing, store distribution, and release attachments only after their technical and policy requirements are met. Keep public source separate from credential-bearing installation artifacts.

Maintain the stable tag/release, changelog or release notes, dependency updates, offline CI, privacy checks, and concise handoff documentation in this one webOS repository. Publication must be verified from actual GitHub state; a roadmap or version string is not publication evidence.
