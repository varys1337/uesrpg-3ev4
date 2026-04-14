# AoE

This folder provides the system AoE pipeline for Foundry v14.359+.

Boundaries:
- `aoe-region-data.js` is the Region shape normalization layer.
- `aoe-region-placement-controller.js` owns interactive Region placement sessions.
- `aoe-service.js` is the public API surface used by callers.
- `containment.js`, `measurement.js`, `template-object.js`, `region-object.js`, and `placement-helpers.js` hold internal geometry, target collection, preview, and range helpers.

Rules:
- Keep Region source normalization centralized.
- Keep canvas placement lifecycle logic in the Region placement controller or the native Region layer wrapper.
- Keep target collection and geometry helpers additive and shared rather than duplicating them in callers.
- Preserve existing source flags and placement result shape.
