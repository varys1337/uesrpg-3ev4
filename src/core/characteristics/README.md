# Characteristics

This folder owns characteristic tests and characteristic-driven workflows.

Boundaries:
- `opposed-workflow.js` remains the public facade.
- `opposed/` owns card schema, rendering, persistence, dialog helpers, resolver caching, and roll-off support.
- `card-updater.js` is the only characteristic opposed chat-card persistence writer.

Rules:
- Workflow handlers should produce next state; card persistence stays centralized.
- Reuse the resolver cache for repeated UUID lookups inside one action instead of re-resolving the same documents.
- Keep chat flag shape stable and backward compatible with existing cards.
