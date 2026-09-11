## Combat

Canonical entrypoints:
- `opposed-workflow.js` is the public facade for opposed combat workflows.
- `damage-resolver.js` and `damage-automation.js` are stable public facades for resolved damage and direct damage/healing application.

Subsystem ownership:
- `opposed/` owns workflow stages, card rendering, persistence adapters, banking, and post-roll actions.
- `opposed/cards/updater.js` is the single source of truth for persisted opposed-card updates.
- `damage/resolver/resolve.js` owns typed damage orchestration and pre-resolution modifiers.
- `damage/post-application.js` owns the shared post-mitigation document update path, unconscious/NPC sync, and damage hook dispatch.
- `damage/apply.js` owns direct damage/healing application while reusing the shared post-application helpers.

Rules:
- Preserve chat flag shapes, damage return shapes, and stored document schema.
- Prefer shared UUID/document helpers over local sync resolution.
- Keep multi-step combat mutations batched per document where possible, with side effects at the edges.
