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

Profile validation and redacted export are implemented in `tools/profiles.cjs` and tested offline. The runtime still uses the existing single-recorder connection contract; selecting a profile in the UI and switching recorder credentials are separate future work.
