## Conditions

Canonical runtime:
- `engine/index.js` owns deterministic condition state, effect upsert/dedupe, numeric condition behavior, and public helpers.
- `condition-engine.js` is a compatibility shim only.
- `index.js` owns one-time registration and global exposure through `game.uesrpg.conditions`.

Supporting modules:
- `status-hud.js` exposes Token HUD interop and routes toggles into the canonical engine.
- `turn-ticker.js` owns round/turn ticking orchestration.
- `round-start-candidate-registry.js` owns cached combat candidate discovery for round-start automation.
- `frenzied.js` and `in-close.js` are focused condition-side helpers that must not duplicate engine ownership.

Rules:
- Additive refactors only. Do not create parallel condition automation layers.
- Resolve documents through shared UUID cache helpers, not ad hoc `fromUuidSync` calls.
- Keep stored condition keys, flags, and ActiveEffect shapes stable unless a migration task explicitly requires otherwise.
