# Public webOS Baseline Implementation Plan

**Goal:** Preserve version 0.4.2 as the user-designated stable baseline and publish one sanitized webOS-only repository, without changing or contacting a physical TV.

**Architecture:** Export only the standalone frontend, pure-JavaScript service, relevant protocol/decoder wrappers, offline tests, and development tools into this new repository. A gitignored `config.local.json` is the sole editable connection configuration; `config.example.json` contains placeholders. Build output derives its private service configuration from that file and never belongs in Git.

**Constraints:** No actual-TV commands, discovery, network probes, installs or launches. No user/device credentials, identity strings, local absolute paths, captures, logs, IPKs, installer archives, private keys, or unlicensed recovered decoder assets in any commit. The existing private stable build remains untouched.

## Tasks

- [x] Export an explicit allowlist; replace private application/vendor identifiers with neutral project identifiers and retain dependency attribution.
- [x] Test a single-file configuration loader: placeholders/malformed values fail safely, profile bounds are validated, and configuration values are not logged.
- [x] Wire builds, cloud endpoint, camera count, simulator launch and QA to that configuration. Generated private configuration and packages stay ignored.
- [x] Provide repeatable offline tests and a publication scanner, with regression tests rejecting known private config/build/media/identity patterns (not a claim of perfect detection).
- [x] Document the stable baseline and caveats, architecture, Windows simulator setup, LLM/Codex control, skill sources, troubleshooting and an implementation-oriented roadmap.
- [x] Verify clean-clone offline tests, private local build/package and simulator prerequisite checks without touching the physical TV. Live neutral-namespace simulator operation remains explicitly unrun; see validation notes.
- [ ] Independently review the export, scan staged files and complete Git history, create one GitHub repository, push only audited source, tag v0.4.2, and verify public contents.

## Review focus

Secrets in generated packages; identifiers hidden in metadata/history; bundled decoder redistribution; machine-specific paths; implicit TV access; misleading synchronization/performance claims; an offline clone requiring private assets just to run unit tests.

## Release interpretation

Stable means the accepted personal-use feature baseline, not a new assertion that frame-perfect synchronization, full-rate HD, zero flicker, or store redistribution have been achieved. Publication tooling/configuration changes do not authorize redeployment to the TV.
