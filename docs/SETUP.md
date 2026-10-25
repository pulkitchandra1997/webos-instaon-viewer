# Local setup and private build

Use an active Node.js LTS release (22 or newer for developer tools), npm, Git and Windows PowerShell. The generated TV service targets Node 12; do not replace its transport with browser-only code.

1. Clone the source and run `npm ci`. This generates the ignored transport bundle from pinned dependencies. Installation needs the npm registry; subsequent unit tests are offline.
2. Run `npm test`. It requires no credentials, TV, decoder SDK or simulator.
3. Run `npm run configure`. Edit **only** `config.local.json`; repeated configure commands never overwrite it. Fill `recorder.instaOnId`, `username`, `password`. These are recorder credentials, not an LG developer account. Never paste this file into a prompt, issue or screenshot.
4. Install the [official webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation). Set `development.webosCliDirectory` to the package directory containing `bin/ares-package.js`, and `development.webosSdkScript` to your authorized `webOSTV.js` (or leave that field empty to use the CLI template's 1.2.13 copy). The baseline was tested with CLI 3.2.6; install the matching version if a newer CLI changes its template layout.
5. Supply your own legally authorized decoder assets in an ignored directory, then set `development.decoderAssetsDirectory`. Required filenames and exact SHA-256 pins are in `assets/decoder-manifest.json`. Files are not downloaded/extracted by this repository. A hash verifies compatibility, not redistribution permission. A different SDK needs an explicitly tested adapter and updated pins.
6. Run `npm run build`, then `npm run package` if a private IPK is needed. Both are local-only; neither contacts a TV. The IPK contains your credentials. **Never upload build output or attach the IPK to a public release.**
7. Follow [SIMULATOR.md](SIMULATOR.md) to test locally. Simulator live tests contact your recorder through its provider, not a physical TV.

## Single config fields

| Section | Purpose |
| --- | --- |
| `recorder` | InstaOn device ID and device username/password |
| `cloud` | Provider discovery hostname and UDP port; actually passed into transport |
| `viewer` | Camera count (1–10 decoder ports), default layout (4/8/10/16) |
| `development` | Simulator executable/runtime, loopback debugger port, CLI, SDK and decoder paths |
| `television` | Reserved explicit physical-device settings; disabled/blank by default, not used by simulator tooling |
| `privacy.forbiddenStrings` | Optional private names, old app IDs, emails or other strings the publication audit must reject |

The generated `build/direct/service/credentials.private.json` is derived output, **not** a second manually maintained config. The frontend receives only camera count/layout in `viewer-profile.js`. Cloud transport and recorder login run inside the on-device service. Private config and generated outputs are plaintext on your machine/device; `.gitignore` is not encryption. Use a dedicated read-only recorder account when supported and protect local filesystem access.

No physical-TV installer or automatic network discovery is included. A future physical deployment requires a separate explicit request, a reviewed package, and LG Developer Mode provisioning. Keep `television.enabled` false during simulator-only work.
