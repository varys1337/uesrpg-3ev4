# Refactor Baseline

| Field              | Value                                      |
|--------------------|--------------------------------------------|
| **Date**           | 2026-02-11                                 |
| **Commit**         | `3843128cf8e83e3e31ddb3d69d379d7ce83a07af` |
| **Foundry Target** | v13.351                                    |
| **System Version** | v1.0.0-RC.84                               |

## Scope

Production-safe refactor focused on:
- Dead code removal (0-importer files)
- Deduplication of `_num`/`_bool`/`_str` primitives (8-9 copies → 1)
- De-shimming: rewriting 31 internal shim imports to canonical paths, then deleting shims
- Public API surface (`src/api/index.js`)
- Moderate file consolidation (small utils ≤2 importers)

## Non-Goals
- No schema changes
- No feature work
- No ApplicationV2 adoption
- No dev tooling (ESLint/Prettier/tsconfig)
