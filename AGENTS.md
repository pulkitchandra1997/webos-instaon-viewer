# Agent working rules

## Scope and safety

This is the single public, sanitized **webOS-only** repository. Preserve the v0.4.2 personal-use stable baseline described in [docs/STABLE_BASELINE.md](docs/STABLE_BASELINE.md). Keep other platforms, private research archives, and unrelated gateways outside this repository.

**The physical TV is in use. Do not contact it.** Do not discover, pair, inspect, SSH into, install on, launch on, restart, or change an actual TV during this work. Keep `television.enabled: false`. Use offline tests and the local simulator when separately authorized. Permission to build/package is not permission to deploy.

Never change recorder configuration, firmware, recording settings, stream quality, clock, or accounts. Viewer selection of existing SD/HD streams is distinct from changing recorder settings. A simulator can still open real recorder sessions; do not infer live-media authorization from simulator-only UI work.

## Configuration and public hygiene

- `config.local.json` is the single user-editable local configuration and stays untracked. `config.example.json` contains generic defaults only. Configure must create the local file without overwriting it.
- Public app/service IDs are `org.webos.instaonviewer` and `org.webos.instaonviewer.service`. Do not restore private identifiers.
- Never commit credentials, recorder IDs, account handles, device serials, network addresses, private keys, local absolute paths, footage, private screenshots, runtime logs, or credential-bearing packages. Do not print secrets in diagnostics or responses.
- Keep vendor decoder payloads and LG simulator installers out of source, Git history, and release assets until redistribution rights are established. Public wrappers do not grant rights to their dependencies.
- The own-code license decision is pending. Do not assert a project-wide MIT license. `dahua-p2p@1.0.0` has MIT npm metadata but a personal/research, non-commercial upstream README and no LICENSE file. Preserve this unresolved status and consult the separate LICENSING document. Use the pinned npm dependency; generate transport in ignored `experiments/direct-tv/build/` during `npm ci` preparation, without vendoring compiled upstream code in public Git.
- Treat generated build outputs and IPKs as private because they can embed local config. Run `npm run privacy` and review the publication surface; do not assume ignored files or a clean scan make an archive safe.
- Link upstream skills using [docs/SKILLS.md](docs/SKILLS.md); do not copy whole installed skill directories into this repository.

## Component map

`src/` owns frontend, Worker, rendering, focus, and layout. `services/org.webos.instaonviewer.service/` owns the webOS service. `experiments/direct-tv/core/` owns transport/protocol support, `experiments/direct-tv/build/` holds ignored generated transport output, and `experiments/direct-tv/decoder/` contains decoder wrappers rather than redistributable vendor payloads. `test/` is offline; `tools/` owns configure, build, package, simulator, QA, and privacy workflows.

## Change and verification workflow

1. Read the README, stable baseline, architecture, and relevant roadmap item. Inspect the current tree and preserve unrelated work.
2. Choose a bounded change with a visible acceptance condition. Preserve SD grids, HD single-camera selection, one shared 192 MiB decoder heap, persistent WebGL, explicit Enter activation, and Back 461 behavior unless the task deliberately revises that contract.
3. Keep deployed service code compatible with Node 12. Host/simulator success does not prove compatibility. Use offline fixtures for protocol, queues, timing, cancellation, controls, and rendering regressions.
4. Run the checks appropriate to the change: `npm test` and `npm run privacy`; build/package only with owner-supplied prerequisites. Record unavailable checks and their reason. Never invent a successful run.
5. For authorized simulator checks, use `npm run simulator -- --debug` and `npm run qa:simulator`. Debug access stays on loopback. Do not substitute a physical-TV command or fallback to hardware.
6. Report changed files, actual commands/results, remaining limits, and the next safe action. Distinguish current verification from historical observations.

Roadmap controls must be hidden or clearly unavailable until the protocol, capability, lifecycle, and verification gates exist. Do not add clickable PTZ, audio/talk, playback, or export controls that imply unsupported behavior.

## Handoff

Maintain [docs/LLM_HANDOFF.md](docs/LLM_HANDOFF.md) when architecture, commands, constraints, or priorities change. Never paste private logs or local config into it. Stable documentation does not establish that a GitHub release or tag has actually been published; inspect release state before reporting publication.

For official guidance on repository instructions and iterative workflows, see [OpenAI's Codex development-workflow cookbook](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex). Optional skills are development aids, not runtime dependencies.
