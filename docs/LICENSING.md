# Rights and third-party components

Public visibility is not a blanket license grant. No new general license is assigned to the original application code in this baseline; the owner must choose one before general redistribution/commercial reuse. Existing third-party terms remain applicable. This project is unofficial and is not endorsed by LG, CP PLUS, or protocol/software vendors.

- Protocol formatting adapted from [CamMob](https://github.com/rajpdus/cammob) retains its MIT notice in `experiments/direct-tv/THIRD_PARTY_NOTICES.md`.
- The pinned npm dependency [dahua-p2p 1.0.0](https://github.com/ludufre/dahua-p2p) declares MIT in its package metadata, while its upstream README also limits use to personal/research and non-commercial purposes. Its published tree has no standalone LICENSE file. These statements need clarification before broader reuse; do not treat this repository as resolving the ambiguity. The upstream compiled code is **not vendored in Git**; `npm ci` obtains the dependency and generates an ignored local compatibility bundle.
- `ws` includes its upstream MIT license in the npm package; private builds copy that notice into the service. `esbuild` is a development dependency with upstream terms in its package.
- LG's simulator, CLI templates and `webOSTV.js` must be installed/provided by the developer under their applicable terms. They are not vendored here.
- The proprietary decoder glue/WASM files are deliberately excluded. Compatibility SHA-256 hashes do not grant rights. Only supply assets you are authorized to use; do not attach them to issues, source commits or releases.
- Icons in `src/` are original geometric app assets, not vendor logos. Camera recordings and reference screenshots are not part of this source distribution.

If a dependency's terms prevent your use, stop that integration and obtain permission or replace it with a compatible implementation. A reproducible, clearly licensed decoder is a priority roadmap item.
