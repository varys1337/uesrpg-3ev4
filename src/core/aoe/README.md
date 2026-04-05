# AoE

This folder provides the system AoE pipeline for Foundry v13.351.

Boundaries:
- `aoe-template-data.js` is the pure normalization layer.
- `aoe-placement-controller.js` owns interactive placement sessions.
- `aoe-service.js` is the public API surface used by callers.
- `containment.js`, `measurement.js`, `template-object.js`, and `placement-helpers.js` hold internal geometry, target collection, preview, and range helpers.

Rules:
- Keep template source normalization pure.
- Keep canvas event lifecycle logic in the placement controller.
- Keep target collection and geometry helpers additive and shared rather than duplicating them in callers.
- Preserve existing source flags and placement result shape.
