## System

Canonical entrypoints:
- `activation/index.js` owns public activation entrypoints.
- `namespace.js` owns system identity constants.
- `flags.js` owns canonical flag helpers.

Ownership:
- `activation/activation-executor.js` is orchestration only.
- `activation/helpers.js`, `costs-and-usage.js`, `rendering.js`, `attack-workflow.js`, and `talent-automation.js` own staged activation internals.
- Compatibility shims such as `system-id.js` and `homebrew.js` should remain thin.

Rules:
- Keep settings, flag access, and UUID resolution on canonical helpers.
- Keep activation mutation edges explicit and isolated.
