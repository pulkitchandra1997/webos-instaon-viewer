# Next-LLM handoff (v1 baseline)

> The current continuation checklist is [LLM_HANDOFF_V2.md](LLM_HANDOFF_V2.md). This file is retained as the original v0.4.2 handoff record.

Read [AGENTS.md](../AGENTS.md), [README.md](../README.md), [STABLE_BASELINE.md](STABLE_BASELINE.md), [ARCHITECTURE.md](ARCHITECTURE.md), then the relevant [ROADMAP.md](ROADMAP.md) item. This is the single public sanitized webOS repository. v0.4.2 is the stable personal-use feature baseline, with further work planned rather than implicitly implemented.

## State to preserve

- Default ten-camera SD view; 4/8/10/16 grids; HD single-camera enlargement; arrow focus, explicit Enter/OK, and Back 461; pause/resume and display settings.
- Direct on-TV Node 12 InstaOn UDP/PTCP/RTSP service, authenticated loopback delivery, one shared 192 MiB WASM decoder heap, persistent WebGL, and shared rAF presentation. No laptop media gateway in the deployed TV path.
- Public identifiers `org.webos.instaonviewer` and `org.webos.instaonviewer.service`. Source lives in `src/`, the service folder, `experiments/direct-tv/{core,build,decoder}`, `test/`, and `tools/`.
- One user-editable untracked `config.local.json`, created without overwrite from `config.example.json`. No private identifiers or machine paths in tracked examples or docs.
- Vendor decoder JavaScript/WASM and LG simulator installers are intentionally absent. Owner-supplied authorized assets/config are required for build/playback. An unaided public clone cannot immediately play media.
- Own-code licensing is pending. `dahua-p2p@1.0.0` has MIT npm metadata but a personal/research, non-commercial upstream README and no LICENSE file. Consult the separate LICENSING document; do not claim project-wide MIT. The pinned npm dependency generates ignored transport in `experiments/direct-tv/build/` during `npm ci` preparation; compiled upstream transport is not vendored in public Git.

## Current boundaries and unresolved work

Publication checkpoint (2026-10-25): the single repository is public; source-only stable tag/release `v0.4.2` points to `152a4da`; zero binary release assets were uploaded. A fresh source-only checkout passes all 16 offline test files, as does Windows GitHub Actions. See [VALIDATION.md](VALIDATION.md) for evidence boundaries. Verify remote state rather than treating these historical observations as live status.

**No physical-TV contact: the user is using it.** Keep `television.enabled: false`; do not discover, pair, SSH, install, launch, restart, or inspect an actual TV. Never change recorder settings, recording quality, firmware, clock, or accounts. A live simulator can authenticate with a real recorder, so keep offline checks as the default unless a media session is authorized.

TV decode throughput has been low single digits for SD and slower for HD. Exact RTCP/RTP-to-NTP and decoded-frame timing alignment is unimplemented; raw per-camera RTP clocks are not comparable. Missing SAR leaves optical geometry unknown. Shared rAF and persistent buffers do not certify synchronized capture, zero flicker, or smooth source-rate playback. P0 measurements, throughput, timing, interruption recovery, soak, config, and privacy precede optional features.

Prior owner-run TV/simulator observations support the baseline but are not new public-tree verification. Do not copy private logs, footage, screenshots, or packages into public evidence. Version strings and these docs do not establish that a GitHub repository, tag, or release has actually been published; inspect that state before reporting it.

## First safe actions

Inspect the current working tree and available scripts before changing anything. Preserve unrelated work and check for missing prerequisites. These are the repository workflows, not a record of commands already run by this handoff:

```sh
npm ci
npm test
npm run configure
npm run privacy
```

Dependency installation may use the network; tests must remain offline and asset-free. Configure must not overwrite local config. For authorized simulator work, fill the `development` tool/asset locations locally, then use `npm run build`, `npm run simulator -- --debug`, and `npm run qa:simulator`. The default debug port is `9224`, loopback only. `npm run package` creates a potentially secret-bearing private artifact; it does not authorize device installation or public attachment.

Choose a bounded roadmap task, define acceptance, implement it with suitable offline fixtures, and report actual checks and limits. Consult [SKILLS.md](SKILLS.md) for upstream skill sources; do not vendor skill folders. Keep unsupported optional controls unavailable until their dependency gates are met.

## Copy/paste prompt

```text
Continue in this public webOS repository. Read AGENTS.md, README.md, and
docs/{STABLE_BASELINE,ARCHITECTURE,ROADMAP,LLM_HANDOFF,SKILLS}.md first.
Preserve v0.4.2 as the stable personal-use baseline: ten-camera SD default,
4/8/10/16 grids, HD single, focus/Enter/Back 461, persistent WebGL, one shared
192 MiB WASM heap, shared rAF, and direct on-TV Node 12 InstaOn transport.
Inspect the tree and actual scripts; report publication/test state from evidence.
Keep all credentials/tool paths in untracked config.local.json, created without
overwrite from config.example.json. Vendor decoder assets/installers are excluded;
do not claim a public clone can immediately play media. Do not publish private IPKs.
Own-code licensing is pending; see LICENSING for the dahua-p2p@1.0.0 ambiguity.
Do not claim project-wide MIT or vendor compiled upstream transport; keep npm-
prepared transport in ignored experiments/direct-tv/build/. Skills are optional
development aids, not runtime dependencies.
Do not contact the physical TV or change any recorder settings. Keep television
disabled. Use offline tests; use the local simulator only within authorized scope,
with debug access on loopback. A live simulator still contacts the recorder.
Work on the next user-selected task, or propose a bounded P0 roadmap task after
checking available evidence. Do not infer exact capture sync, zero flicker, calibrated
optical aspect, or TV performance from simulator success. Report changed files,
checks actually run, blockers, and the next safe step without exposing private data.
```
