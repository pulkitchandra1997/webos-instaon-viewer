# Roadmap completion audit

This audit records what was implemented and what remains externally gated. It is intentionally conservative: passing offline tests does not prove physical-TV performance or cloud protocol support.

| Area | Current result | Evidence or blocker |
| --- | --- | --- |
| P0-01 diagnostics | Implemented in source | `src/diagnostics.js` measures receipt, replacement, queue depth, decode duration, and presentation latency; offline tests pass. Simulator media sampling is prepared but needs service registration and authorized feeds. |
| P0-02 recovery | Baseline verified | Engine/bridge tests cover disconnects, malformed input, decoder reset, keyframe recovery, stale channels, cancellation, retry backoff, and cleanup. A live soak remains unverified. |
| P0-03 throughput | Measurement-ready | Shared decoder, bounded backpressure, persistent surfaces, and diagnostics exist. Before/after optimization requires a valid 10-camera media session and must not change recorder settings. |
| P0-04 timing | Not complete | The decoder explicitly reports raw-Annex-B timestamp mapping unavailable. RTP/RTCP sender-report mapping requires protocol evidence and decoded-frame association. |
| P1-01 configuration | Baseline verified | Schema validation, placeholder rejection, no-overwrite configure, redacted errors, service-side secrets, and public-profile tests pass. |
| P1-02 profiles | Foundation implemented | Version-one non-secret profile validation, migration, and redacted export are implemented. UI profile selection and profile persistence remain. |
| P1-03 remote navigation | Baseline verified | Offline tests cover arrows, Enter/OK, Escape/Back, focus, and 4/8/10/16 layouts. Full simulator media evidence remains pending. |
| P1-04 discovery | Not exposed | No stable supported read-only discovery API is established; the app intentionally keeps explicit configuration. |
| P2 controls/media | Blocked | PTZ, talk, audio, playback, and snapshots require supported protocol/capability evidence, explicit permissions, and in some cases codec/licensing review. No fake controls are shipped. |
| P3 distribution | Blocked | Own-code, transport dependency, decoder, and LG-tool redistribution decisions remain unresolved; no public IPK or proprietary payload is attached. |

## Safe next actions

1. Register the freshly staged service in the simulator’s Service List and enable it manually.
2. Run `npm run qa:simulator -- --soak-seconds 60 --timeout-seconds 180` with an authorized media session.
3. Use the resulting sanitized measurements to decide whether a P0-03 optimization is justified.
4. Investigate RTP/RTCP timing only from authorized protocol evidence; otherwise retain the explicit unsynchronized status.
