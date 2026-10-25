# Sanitized source export validation

Date: 2026-10-25. Scope: local source/config/build/publication preparation only. **No physical TV was discovered, contacted, installed on, launched or changed. No recorder settings changed.** The owner's previously installed application is untouched.

Fresh checks performed on Windows:

| Check | Result |
| --- | --- |
| `npm test` | 16 offline test files pass; no credentials, media SDK, cameras, cloud or TV access required |
| Independent source-only Git checkout: `npm ci`, `npm test` | Pass; private config/build/decoder assets absent |
| `npm run privacy` and `npm run privacy:history` | Pass for staged/tracked source, reachable blobs and commit identities; owner-value audit uses the ignored local config |
| Clone privacy/history check without private config | Pass for generic file/pattern rules; this cannot check owner-specific values by itself |
| `npm run build` with local prerequisites | Pass; neutral namespace, safe viewer profile, generated private service config |
| `npm run package` | Pass; parsed IPK confirms metadata/icon dimensions, service/config equality, decoder hashes and no frontend recorder credentials |
| Node 12.22.2 `--check` on staged service | Pass; syntax compatibility only, not hardware runtime certification |
| `npm run simulator -- --check` | Pass; local paths/staging/executable validated without launching or network probes |
| Simulator helper JS syntax and PowerShell parsing | Pass; unit tests also reject external debug targets and mismatched sessions |
| Local Markdown links / staged whitespace checks | Pass |
| Production dependency audit at validation time | No known vulnerabilities reported by `npm audit --omit=dev --audit-level=high`; not a permanent security guarantee |

The source-only clone may contact the npm registry during dependency installation. Offline tests use synthetic data and loopback protocol fixtures; they do not reproduce a live recorder session.

Not performed in this export session: launching the new simulator profile, registering its service, live simulator soak/GPU recovery, physical remote-button use, actual-TV playback/performance, capture synchronization, or glass-to-glass latency measurement. The simulator QA script is supplied but its live path has not been re-run for this neutral namespace. Historical media observations are separated in [STABLE_BASELINE.md](STABLE_BASELINE.md).

Private config and IPK remain local, ignored and unsuitable for public release attachments. Vendor decoder files are prerequisites, not public assets. Review and scans reduce disclosure risk; they do not prove the absence of every conceivable secret or grant dependency redistribution rights.

Independent review identified and regression tests now cover JSON-escaped known secrets, consistent BOM handling, and obsolete files surviving a rebuild. Builds use fresh staging, retain the last completed output on failure, and remove only their own validated generated staging/previous directories after success.

Publication checkpoint: the final reviewed source commit `152a4da` passed Windows GitHub Actions. An independent source-only checkout of that commit passed `npm ci`, all 16 offline test files and the history privacy guard. The public remote tree was verified at 79 source/documentation/asset files with no forbidden private/config/package/vendor payload paths. Stable source tag/release `v0.4.2` was published with zero uploaded binary assets. Later documentation-only updates do not change the feature baseline or authorize hardware deployment.
