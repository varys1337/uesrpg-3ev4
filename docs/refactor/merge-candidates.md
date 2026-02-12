# Merge Candidates

Generated: 2026-02-11

## Immediate Deletions (Dead Code)

| File | Reason |
|------|--------|
| `src/utils/diceHelper.js` | 0 importers, superseded by `degree-roll-helper.js` |
| `src/utils/stringHelpers.js` | 0 importers |
| `src/ui/utils/authority-proxy.js` | Dead shim, 0 importers |
| `src/core/effects/status-effect.js` | Dead shim, 0 importers |
| `src/core/documents/items.js` | Dead shim, 0 importers |

## Shim Deletions (After De-shimming)

- 22 opposed/ shims (after updating `opposed-workflow.js`)
- 9 shared/ shims (after updating `actor-sheet.js` + `npc-sheet.js`)
- 1 `active-effect-proxy.js` (after updating consumers)

## Primitives Consolidation

After extracting coercion helpers to `src/utils/coerce.js`:
- `src/core/magic/_primitives.js` — becomes re-export + `createDebugLogger` only
- `src/core/traits/_primitives.js` — becomes re-export + trait-specific helpers only

## Utility Merge Candidates

| Candidate | Importers | Target | Decision |
|-----------|-----------|--------|----------|
| `ae-grouping.js` | 1 | Merge into `ae-helpers.js` | Evaluate (combined ~8KB) |
| `maps/characteristics.js` | TBD | Check importers | Evaluate |
