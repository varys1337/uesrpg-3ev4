## Traits

Canonical entrypoints:
- `index.js` is the public barrel.
- `talents-api.js` owns talent lookup and normalization.
- `trait-registry.js` owns trait-state queries and resistance/immunity helpers.
- `features/` owns passive FeatureMod collection plus Rule Element authoring/runtime.

Ownership boundaries:
- Pure rule evaluation stays in the talent/feature helpers.
- Chat and document mutation should stay at explicit workflow edges.
- `combat-talents.js`, `spellcasting-talents.js`, and `talent-learning.js` are public facades; extracted sibling helpers are internal-only.

Implementation rules:
- Reuse `src/utils/uuid-cache.js` for UUID-backed lookups.
- Reuse `src/utils/chat-roll-mode.js` for core roll mode reads.
- Gate debug output through `src/utils/debug.js`.
