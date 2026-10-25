# Skills and upstream sources

Skills are optional development aids, not app/runtime dependencies. The webOS repository should remain understandable and testable without an installed agent skill collection. Use these actual upstream projects rather than copying a local installation into the public tree.

For official AGENTS.md and repository-workflow guidance, see [OpenAI's Codex development-workflow cookbook](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex).

| Skill or workflow | Source | Appropriate use |
| --- | --- | --- |
| Reverse Engineer Anything (REA) | [morluto/rea](https://github.com/morluto/rea) | Investigate shipped artifacts or decoder/protocol behavior when source and existing evidence cannot answer the question. Ordinary source editing does not require REA. Investigation does not establish redistribution rights. |
| Superpowers | [obra/superpowers](https://github.com/obra/superpowers) | Structure implementation plans, meaningful regression testing, review, and evidence-backed completion. Apply the focused workflow appropriate to the task and respect the user's scope. |
| Codex computer-use | Official bundled skill supplied with the Codex installation | Operate the local simulator UI when a supported automation/debug tool is insufficient and UI control is available. There is no assumed standalone public GitHub source for this bundled skill; do not invent one. |

The upstream links identify projects, not a claim that every installed skill matches the latest upstream revision. Read the installed instructions for the current session and consult upstream license/install guidance before reuse. Keep at most concise repository-specific notes and upstream links here. **Never redistribute copied whole skill directories**, cached plugin trees, private session transcripts, or machine configuration.

The public project uses generic app/service identifiers and untracked local configuration. Skills must not restore private values, acquire unlicensed assets, publish camera images, or bypass the simulator-only boundary. Computer-use permission is not permission to contact a physical TV or operate recorder controls. Skill licenses do not license this app or its dependencies; the own-code license decision and transport dependency ambiguity are recorded separately in the LICENSING document.
