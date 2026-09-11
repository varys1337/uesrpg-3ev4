# Alchemy

This folder owns alchemy authoring, brewing, application, and runtime resolution.

Boundaries:
- `workflow.js` owns brew validation and workflow orchestration.
- `runtime.js` owns ready-time runtime entrypoints and delegates chat/resource/hook helpers.
- `operations.js` is the narrow document/chat mutation edge.
- `utils.js` is the canonical home for shared item iteration, name normalization, UUID resolution, and result-shape helpers.
- `workflow-state.js` owns pure recipe hashing and trial-and-error persistence payload shaping.

Rules:
- Keep pure rule computation separate from document writes whenever possible.
- Reuse the canonical alchemy helpers instead of re-declaring actor item scans or UUID utilities in local files.
- Preserve existing flags, chat payloads, and embedded item semantics for world safety.
