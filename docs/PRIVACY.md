# Publication boundary

This repository distributes source, generic metadata, original icons, synthetic tests, compatibility hashes and documentation only. It does not distribute private config, keys, camera footage, screenshots, captures, logs, vendor SDK binaries, simulator installers or credential-bearing IPKs.

Before every push:

```powershell
git status --short
git diff --cached --stat
npm test
npm run privacy
npm run privacy:history
```

Read every staged diff yourself. The guard checks staged blobs, tracked working files and (with `--history`) reachable Git history/commit identities. With private config present it also rejects its connection values, local paths and optional forbidden strings, including common URL/Base64/hex encodings. Without private config (CI), only generic forbidden paths and credential/address patterns can be checked. No scanner proves the absence of every secret or semantic personal detail.

The neutral application ID is intentional: do not restore an owner's personal app namespace or local absolute paths. Use a non-personal Git author identity if desired. GitHub account ownership and activity remain publicly associated with the account hosting the repository; this is not anonymous hosting.

Provider-wide published protocol application constants are not a recorder's login details. See the CamMob attribution in `experiments/direct-tv/THIRD_PARTY_NOTICES.md`. Do not replace those constants with private recorder values.

## If something leaks

Stop publishing immediately. Rotate exposed recorder credentials/tokens, remove public artifacts, and arrange history cleanup with the owner. Deleting a later commit does not retract copies, clones, forks or caches. Never post private diagnostics to demonstrate the incident.
