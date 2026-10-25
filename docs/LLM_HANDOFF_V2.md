# LLM Handoff v2 — Pending Tasks

**Date:** 2026-10-25  
**Repository:** this public webOS source repository
**Stable baseline:** `v0.4.2`  
**Scope:** public, sanitized LG webOS application source only

This is the current continuation file for the next LLM. The older [LLM_HANDOFF.md](LLM_HANDOFF.md) remains as the original baseline record; use this v2 file for pending work.

## Read first

Read these files before changing code:

1. [AGENTS.md](../AGENTS.md)
2. [README.md](../README.md)
3. [STABLE_BASELINE.md](STABLE_BASELINE.md)
4. [ARCHITECTURE.md](ARCHITECTURE.md)
5. [ROADMAP.md](ROADMAP.md)
6. [PRIVACY.md](PRIVACY.md) and [LICENSING.md](LICENSING.md)

## Non-negotiable boundaries

- Do not discover, pair, SSH into, install on, launch, restart, or inspect the physical TV. It is intentionally out of scope for this handoff.
- Keep `television.enabled: false` and keep all credentials, device IDs, IPs, logs, footage, packages, and machine paths out of Git.
- Do not change recorder settings, firmware, recording quality, stream parameters, or accounts.
- Do not add vendor decoder JavaScript/WASM, LG simulator installers, or compiled proprietary transport to the public repository.
- Treat the public clone as source-only: authorized local assets and `config.local.json` are required for playback.
- Do not claim exact capture synchronization, zero flicker, calibrated optical aspect ratio, or physical-TV performance without new evidence.

## Preserved baseline

- Ten-camera SD default; 4, 8, 10, and 16 layouts.
- HD for single-camera enlargement; SD for the wall.
- Arrow focus, explicit Enter/OK, Back key code 461, pause/resume, Fit/Fill, aspect overrides.
- Direct on-TV Node 12 InstaOn UDP/PTCP/RTSP service, authenticated loopback WebSocket delivery, shared 192 MiB decoder heap, persistent WebGL surfaces, and shared animation-frame presentation.
- Generic public IDs: `org.webos.instaonviewer` and `org.webos.instaonviewer.service`.
- One untracked local config: `config.local.json`, created without overwrite from `config.example.json`.

## Pending task board

All items below are **PENDING** unless a future handoff records evidence and acceptance results.

| ID | Priority | Status | Task | Acceptance evidence |
| --- | --- | --- | --- |
| P0-01 | High | In progress | Add repeatable per-camera latency, dropped-frame, decode-time, and queue-depth measurements using offline fixtures and authorized simulator sessions. | Focused/offline tests pass; simulator media report remains pending service registration and authorized feeds. |
| P0-02 | High | Improve interruption recovery for cloud disconnects, malformed packets, decoder reset, and stalled cameras. | Deterministic fault-injection tests and a simulator soak result. |
| P0-03 | High | Measure and reduce wall-view decode load without changing recorder settings. | Before/after metrics for 10-camera SD wall and single-camera HD; no unsupported performance claim. |
| P0-04 | High | Specify timestamp alignment and presentation policy. | Documented clock assumptions, fallback behavior, and a test proving the UI does not falsely claim synchronized capture. |
| P1-01 | Medium | Finish config validation and user-facing error states. | Invalid/missing fields fail safely; secrets never appear in UI, logs, tests, or artifacts. |
| P1-02 | Medium | Add optional saved profiles without storing credentials in tracked files. | Profile tests, migration behavior, and privacy scan. |
| P1-03 | Medium | Improve remote navigation and focus visibility across every grid. | Simulator key-matrix evidence for arrows, OK, Back, color keys, and overflow. |
| P1-04 | Medium | Add recorder/channel discovery only if the authorized transport exposes a stable supported API. | Protocol evidence, mock tests, and explicit fallback when discovery is unavailable. |
| P2-01 | Low | Evaluate PTZ, audio, talk, playback, snapshots, and camera health indicators as separate feature slices. | Each slice has a protocol/licensing gate and offline tests before implementation. |
| P2-02 | Low | Add packaging/release guidance for authorized decoder assets and private IPKs. | No secret-bearing artifact is attached; licensing review is complete. |
| P3-01 | Low | Resolve own-code and dependency licensing before any redistribution or public store submission. | Written provenance decision and updated LICENSE/NOTICE policy. |

## Safe first action

Start with **P0-01**. Inspect the current tests and scripts, add measurement hooks behind testable interfaces, and keep the first implementation offline. Do not start with physical-TV installation or recorder-side changes.

## Required report format for the next LLM

At the end of each task, report:

- files changed;
- tests and commands actually run;
- simulator-only or fixture-only evidence;
- privacy/licensing checks and their limits;
- unresolved blockers and the next bounded task.

Never include private credentials, recorder identifiers, camera footage, raw packet captures, or machine-specific paths in the handoff.

## Copy/paste continuation prompt

```text
Continue in this public LG webOS repository. Read AGENTS.md, README.md, and
docs/{STABLE_BASELINE,ARCHITECTURE,ROADMAP,LLM_HANDOFF_V2,PRIVACY,LICENSING}.md.
Preserve v0.4.2: ten-camera SD default, 4/8/10/16 grids, HD single-camera
enlargement, focus/Enter/Back 461, Fit/Fill, persistent WebGL, one shared 192 MiB
WASM heap, shared rAF, and direct on-TV Node 12 InstaOn transport. Keep the
physical TV untouched and television.enabled=false. Keep credentials and paths in
untracked config.local.json; never publish private IPKs, footage, logs, packet
captures, or vendor decoder assets. Begin with the next bounded pending task,
preferably P0-01 measurement instrumentation, using offline fixtures first.
Report actual evidence, limits, changed files, and checks without exposing secrets.
```
