# Optimization & De-shim — Final Report

**Date**: 2025-06-18
**Baseline commit**: `3843128cf8e83e3e31ddb3d69d379d7ce83a07af`
**System version**: `v1.0.0-RC.84`
**Foundry target**: `v13.351`

## Summary

All 7 phases of the optimization and de-shim plan completed successfully.
Import verification passes: **313 JS files, 0 broken imports**.

---

## Phase 0 — Safety Baseline ✅
- Recorded commit hash, system version, Foundry target in `docs/refactor/00-baseline.md`

## Phase 1 — Audit Docs ✅
- Created 5 audit documents in `docs/refactor/`:
  - `audit-files.md` — full file inventory
  - `audit-shims.md` — shim file catalog
  - `audit-duplicates.md` — duplicated helper analysis
  - `audit-import-graph.md` — import dependency graph
  - `merge-candidates.md` — consolidation candidates

## Phase 2 — Dead Code Removal ✅ (5 files deleted)
| File | Reason |
|------|--------|
| `src/utils/diceHelper.js` | 0 importers |
| `src/utils/stringHelpers.js` | 0 importers |
| `src/ui/utils/authority-proxy.js` | Dead shim (1 consumer fixed) |
| `src/core/effects/status-effect.js` | Dead shim, 0 importers |
| `src/core/documents/items.js` | Dead shim, 0 importers |

## Phase 3 — Centralize Duplicated Helpers ✅
- Created `src/utils/coerce.js` — canonical `_num`, `_numOrNull`, `_bool`, `_str`, `_strTrim`, `_lower`
- Updated `magic/_primitives.js` and `traits/_primitives.js` to re-export from `coerce.js`
- Replaced private copies of `_num` (6 files) and `_bool` (7 files) with imports from `coerce.js`

## Phase 4 — Shim Elimination ✅ (32 shim files deleted)

### 4.1 — Opposed Combat Shims (22 files)
- Updated `opposed-workflow.js` facade (28 path replacements)
- Updated 21 internal consumer files (59 path replacements)
- Deleted 22 shim files from `src/core/combat/opposed/`

### 4.2 — Shared Sheet Shims (9 files)
- Updated `actor-sheet.js` (9 import paths)
- Updated `npc-sheet.js` (8 import paths)
- Deleted 9 shim files from `src/ui/sheets/shared/`

### 4.3 — Active Effect Proxy Shim (1 file)
- Updated `src/hooks/init.js` (import + call site: `registerActiveEffectProxy` → `registerAuthorityProxy`)
- Updated `src/core/combat/opposed-workflow.js` (import path)
- Deleted `src/utils/active-effect-proxy.js`

## Phase 5 — Public API Surface ✅
- Created `src/api/index.js` — barrel file re-exporting:
  - Authority proxy helpers (permission-safe mutations)
  - Document classes (SimpleActor, SimpleItem)
  - Combat (AttackTracker, DAMAGE_TYPES)
  - Stamina (dialog, integration hooks)
  - Magic (spell profile, casting service)
  - Active Effects (modifier evaluator)
  - Skills (TN computation)
  - Coercion helpers
  - Rules engine (predicate)

## Phase 6 — File Consolidation ✅
- Merged `ae-grouping.js` into `ae-helpers.js` (1 consumer updated)
- Moved `createDebugLogger()` from `magic/_primitives.js` to `utils/debug.js`
- Deduplicated `_canPromptForActor` in `rest-workflow.js` (imports from `_primitives.js`)
- Deleted `src/utils/ae-grouping.js`

## Phase 7 — Final Validation ✅
- `node scripts/verify-imports.mjs` → **313 files, 0 broken imports**
- No ghost files remaining
- All new files present (`coerce.js`, `api/index.js`)

---

## Totals

| Metric | Count |
|--------|-------|
| Files deleted | **38** |
| Files created | **2** |
| Net file reduction | **36** |
| Files modified | ~30 |
| Import path fixes | ~100 |
| Broken imports at end | **0** |
