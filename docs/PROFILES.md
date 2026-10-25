# Local display profiles

The repository now accepts optional version-one display profiles in the ignored `config.local.json`. Profiles contain only display metadata: camera count, default layout, labels, order, fit mode, and display ratio. They do not contain InstaOn IDs, usernames, passwords, cloud credentials, IP addresses, or private paths.

Example:

```json
{
  "version": 1,
  "id": "home",
  "name": "Home",
  "cameraCount": 10,
  "defaultView": 10,
  "labels": { "1": "Front" },
  "order": [1,2,3,4,5,6,7,8,9,10],
  "fit": "fit",
  "ratio": "auto"
}
```

Profile validation, migration from the original single-profile config, and redacted export are implemented in `tools/profiles.cjs` and tested offline. The schema rejects unknown fields, including credentials and network fields; export uses a display-only whitelist. `loadConfig` now materializes a deterministic `default` profile when `config.local.json` has no profiles. The runtime exposes configured non-secret profiles in the TV UI and applies the selected profile's camera count, ordering, labels, preferred layout, fit mode, and display ratio. Selection is persisted locally by profile ID. The runtime still uses the existing single-recorder connection contract; profile selection does not switch recorder credentials.
