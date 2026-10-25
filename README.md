# webOS InstaOn Viewer

**v0.4.2 stable — personal-use feature baseline.** A webOS TV viewer for CP PLUS InstaOn cameras, with direct transport and decoding on the TV. This single repository contains the webOS app, its service, build tools, tests, and documentation.

The default view is ten SD channels. Choose a 4, 8, 10, or 16-tile grid; enlarge one camera for HD; use Back to restore the SD grid. A 16-tile layout does not imply sixteen supported live decoder channels. Arrow navigation, explicit Enter/OK activation, Back key code 461, pause/resume, and Fit/Fill with aspect overrides are part of the baseline.

Stable means a usable personal baseline with known limits. Physical-TV refresh has been in the low single digits for SD and slower for HD. Exact capture-time synchronization, source-rate playback, correct optical aspect without source metadata, and zero flicker are not guaranteed. See [the stable baseline](docs/STABLE_BASELINE.md).

## Public source and private prerequisites

This is a sanitized source repository. Recovered vendor decoder JavaScript/WASM and LG simulator installers are excluded because redistribution rights have not been established. Obtain authorized decoder assets yourself and install LG development tools separately. **A public clone cannot immediately play media.** Build/playback requires the owner's assets, recorder access, and private configuration.

The license decision for project-owned code is pending; there is no project-wide MIT claim. `dahua-p2p@1.0.0` declares MIT in npm package metadata, but its upstream README also restricts use to personal/research, non-commercial purposes, and no LICENSE file accompanies the inspected package. This ambiguity remains unresolved; see the separate LICENSING document for the provenance assessment. The repository uses a pinned npm dependency and generates transport output in ignored `experiments/direct-tv/build/` during dependency preparation, rather than vendoring compiled upstream code in public Git.

On the TV, the app uses its own Node 12 service for InstaOn UDP/PTCP/RTSP transport, an authenticated local WebSocket, one shared 192 MiB WASM decoder heap, and persistent WebGL surfaces. A laptop is used for development and the simulator; it is not a playback gateway for the TV package. InstaOn connectivity still requires network access.

App ID: `org.webos.instaonviewer`. Service ID: `org.webos.instaonviewer.service`.

## Start with the offline workflow

Use a host Node/npm version supported by the repository's build tooling. Node 12 compatibility is a requirement for the deployed service, not an instruction to use Node 12 for every host tool.

```sh
npm ci
npm test
npm run configure
```

`npm ci` installs the locked dependencies, prepares the ignored generated transport, and may require internet access. `npm test` is the offline suite: no decoder assets, cameras, recorder credentials, or device connections are required. `npm run configure` creates untracked `config.local.json` from tracked `config.example.json` and must refuse to overwrite an existing local file. Edit only `config.local.json` for your environment; never put real values into the example.

| Configuration | Fields and defaults |
| --- | --- |
| `recorder` | `instaOnId`, `username`, `password`: owner-supplied private values |
| `cloud` | `host: "instaonserver.com"`, `port: 8800` |
| `viewer` | `cameraCount: 10`, `defaultView: 10` |
| `development` | `simulatorExecutable`, `simulatorServiceDirectory`, `webosCliDirectory`, `decoderAssetsDirectory`, `webosSdkScript`: initially empty; `simulatorDebugPort: 9224` |
| `television` | `enabled: false`, `deviceName: "test-tv"`, `host: ""`, `sshPort: 9922`, `username: "prisoner"`, `privateKeyPath: ""` |

Keep machine-specific tool and asset locations in the local configuration. `television.enabled: false` is a device-tooling guard; it does not make configured simulator media playback offline. Starting playback can authenticate with the recorder.

## Simulator setup and control from Codex

The development target is the **LG webOS TV Simulator**, sometimes called an emulator in conversation. It does not reproduce physical-TV performance or every service restriction.

1. Install the LG simulator and required webOS CLI/SDK tools from their official distribution. Do not commit their installers or installation folders.
2. Run `npm run configure`, then set the `development` paths in `config.local.json`. Select the simulator executable, this project's writable simulator service directory, CLI directory, authorized decoder asset directory, and the `webOSTV.js` library path if required by the installation. Keep the debug port at `9224` unless it conflicts. Follow the exact steps in [simulator setup](docs/SIMULATOR.md).
3. With authorized assets and private config available, build and launch:

   ```sh
   npm run build
   npm run simulator -- --debug
   npm run qa:simulator
   ```

4. Use the configured loopback debug endpoint for scripted inspection. Codex can run these scripts and inspect the simulator through available browser or bundled computer-use tools. If the simulator requires service registration, register only this project's staged service through the simulator's supported UI. UI-control availability depends on the Codex installation.
5. Check focus, Enter/OK, Back 461, layout changes, enlargement/return, Fit/Fill, pause/resume, and overflow. Report whether a check used fixtures, a simulator media session, or previously collected evidence. Simulator FPS is not a TV benchmark.

Do not use TV discovery, pairing, SSH, installation, launch, or restart commands during simulator work. Keep `television.enabled` false. Do not alter recorder settings, firmware, stream parameters, or recording quality. Live simulator media sessions also require user authorization; default to offline checks when that authorization is absent.

## Build, package, and publication checks

```sh
npm run build
npm run package
npm run privacy
```

Build and packaging need the private prerequisites above. A generated package may contain recorder secrets and must be treated as private. A privacy scan is one check, not proof that an IPK or a whole Git history is safe to publish. Review tracked files, history, release attachments, and staged outputs before publication. Never publish `config.local.json`, private packages, footage, screenshots of feeds, logs, device identifiers, or vendor decoder payloads without established rights.

## Documentation

- [Stable v0.4.2 baseline and limitations](docs/STABLE_BASELINE.md)
- [Architecture and component ownership](docs/ARCHITECTURE.md)
- [Feature and activity roadmap](docs/ROADMAP.md)
- [Next-LLM handoff and copy/paste prompt](docs/LLM_HANDOFF.md)
- [Skills and actual upstream links](docs/SKILLS.md)
- [Local config and private build setup](docs/SETUP.md)
- [Publication and privacy checks](docs/PRIVACY.md)
- [Licensing and excluded dependencies](docs/LICENSING.md)
- [Agent working rules](AGENTS.md)
