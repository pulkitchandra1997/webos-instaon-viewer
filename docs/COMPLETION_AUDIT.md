# Roadmap completion audit

This audit records what was implemented and what remains externally gated. It is intentionally conservative: passing offline tests does not prove physical-TV performance or cloud protocol support.

| Area | Current result | Evidence or blocker |
| --- | --- | --- |
| P0-01 diagnostics | Implemented in source | `src/diagnostics.js` measures receipt, replacement, queue depth, decode duration, and presentation latency; offline tests pass. Simulator media sampling is prepared but needs service registration and authorized feeds. |
| P0-02 recovery | Baseline verified | Engine/bridge tests cover disconnects, malformed input, decoder reset, keyframe recovery, stale channels, cancellation, retry backoff, and cleanup. A live soak remains unverified. |
| P0-03 throughput | Fixture baseline ready | `npm run report:fixture` compares synthetic 4/8/10/16 SD walls and single-camera HD using the diagnostics counters. It is not a TV, recorder, cloud, FPS, or end-to-end latency result; live optimization still requires a valid media session. |
| P0-04 timing | Foundation implemented; association gated | `src/timing.js` parses RTCP Sender Reports, extends RTP timestamps across wraparound, maps NTP time, and provides a bounded alignment buffer with explicit unsynchronized fallback. The current raw Annex-B decoder still does not provide decoded-frame timestamp association, so exact capture sync is not claimed. |
| P1-01 configuration | Baseline verified | Schema validation, placeholder rejection, no-overwrite configure, redacted errors, service-side secrets, and public-profile tests pass. |
| P1-02 profiles | Implemented | Version-one non-secret validation, migration, redacted export, UI selection, local profile-ID persistence, labels, ordering, layout, fit, and ratio application are covered by offline tests. Recorder credentials remain outside profiles. |
| P1-03 remote navigation | Baseline verified | Offline tests cover arrows, Enter/OK, Escape/Back, focus, and 4/8/10/16 layouts. Full simulator media evidence remains pending. |
| P1-04 discovery | Not exposed | No stable supported read-only discovery API is established; the app intentionally keeps explicit configuration. |
| P2 controls/media | Blocked | PTZ, talk, audio, playback, and snapshots require supported protocol/capability evidence, explicit permissions, and in some cases codec/licensing review. No fake controls are shipped. |
| P3 distribution | Blocked | Own-code, transport dependency, decoder, and LG-tool redistribution decisions remain unresolved; no public IPK or proprietary payload is attached. |

## Safe next actions

1. Register the freshly staged service in the simulator’s Service List and enable it manually.
2. Run `npm run qa:simulator -- --soak-seconds 60 --timeout-seconds 180` with an authorized media session.
3. Use the resulting sanitized measurements to decide whether a P0-03 optimization is justified.
4. Investigate RTP/RTCP timing only from authorized protocol evidence; otherwise retain the explicit unsynchronized status.
