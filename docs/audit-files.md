# Audit: File Inventory

> Generated: 2025-02-11 — UESRPG 3ev4 codebase

## Summary

| Metric | Value |
|--------|-------|
| **Total JS files** | **349** |
| **Total size** | **3,504 KB (3.42 MB)** |

---

## JS File Counts by Directory

### Top-Level src/ Breakdown

| Directory | Files |
|-----------|-------|
| `src/core/` | 247 |
| `src/ui/` | 78 |
| `src/utils/` | 20 |
| `src/hooks/` | 2 |
| `src/data/` | 1 |
| `src/system.js` (root) | 1 |
| **Total** | **349** |

### src/core/ Breakdown (247 files)

| Subdirectory | Files | Notes |
|-------------|-------|-------|
| `core/combat/` | 96 | Largest subsystem |
| ↳ `combat/opposed/` | 65 | (32 root + 33 in subdirs) |
| ↳↳ `opposed/actions/` | 9 | |
| ↳↳ `opposed/banking/` | 3 | |
| ↳↳ `opposed/cards/` | 5 | |
| ↳↳ `opposed/damage/` | 5 | |
| ↳↳ `opposed/dialogs/` | 3 | |
| ↳↳ `opposed/helpers/` | 8 | |
| ↳ `combat/damage/` | 13 | |
| ↳ `combat/` (root) | 18 | |
| `core/magic/` | 37 | |
| ↳ `magic/conjuration/` | 4 | |
| ↳ `magic/effects/` | 3 | |
| ↳ `magic/opposed/` | 6 | |
| ↳ `magic/services/` | 6 | |
| ↳ `magic/ticks/` | 3 | |
| ↳ `magic/` (root) | 15 | |
| `core/traits/` | 31 | |
| ↳ `traits/features/` | 11 | |
| ↳ `traits/weapon-expertise/` | 4 | |
| ↳ `traits/` (root) | 16 | |
| `core/skills/` | 14 | |
| `core/characteristics/` | 9 | |
| `core/actors/` | 8 | |
| `core/conditions/` | 8 | |
| `core/wounds/` | 9 | |
| `core/active-effects/` | 5 | |
| `core/aoe/` | 5 | |
| `core/time/` | 5 | |
| `core/rules/` | 6 | |
| `core/migrations/` | 4 | |
| `core/stamina/` | 2 | |
| `core/documents/` | 4 | |
| `core/system/` | 1 | |
| `core/config/` | 1 | |
| `core/effects/` | 1 | |

### src/ui/ Breakdown (78 files)

| Subdirectory | Files |
|-------------|-------|
| `ui/sheets/` | 63 |
| ↳ `sheets/shared/` | 21 |
| ↳ `sheets/actor/` | 11 |
| ↳ `sheets/item/` | 7 |
| ↳ `sheets/npc/` | 4 |
| ↳ `sheets/racemenu/` | 5 |
| ↳ `sheets/` (root) | 15 |
| `ui/apps/` | 6 |
| `ui/canvas/` | 6 |
| `ui/dialogs/` | 2 |
| `ui/utils/` | 1 |

### src/utils/ Breakdown (20 files)

| Subdirectory | Files |
|-------------|-------|
| `utils/dev/` | 7 |
| `utils/maps/` | 1 |
| `utils/` (root) | 12 |

---

## 11 Files Over 40 KB

| # | File | Size |
|---|------|------|
| 1 | `src/core/combat/chat-handlers.js` | 59.3 KB |
| 2 | `src/core/skills/opposed-workflow.js` | 55.0 KB |
| 3 | `src/core/magic/opposed/outcome-resolution.js` | 48.7 KB |
| 4 | `src/core/combat/damage/resolver/resolve.js` | 45.3 KB |
| 5 | `src/core/magic/upkeep-workflow.js` | 44.2 KB |
| 6 | `src/core/traits/features/rule-element-runtime.js` | 44.0 KB |
| 7 | `src/core/system/activation/activation-executor.js` | 43.7 KB |
| 8 | `src/core/combat/opposed/actions/damage.js` | 43.5 KB |
| 9 | `src/core/magic/opposed/actions.js` | 43.5 KB |
| 10 | `src/core/actors/prepare/character.js` | 41.4 KB |
| 11 | `src/core/actors/prepare/npc.js` | 41.1 KB |

**Combined size of top 11:** ~509.7 KB (14.5% of total)

---

## Files Under 1 KB (Consolidation Candidates)

### Pure Re-Export Shims (< 200 B) — 22 files in `combat/opposed/`
See **audit-shims.md** for full details.

### Pure Re-Export Shims (< 200 B) — 9 files in `ui/sheets/shared/`
See **audit-shims.md** for full details.

### Other Files Under 1 KB (non-shim or small real code)

| File | Size | Category |
|------|------|----------|
| `src/utils/stringHelpers.js` | 110 B | Dead (0 importers) |
| `src/core/time/index.js` | 167 B | Barrel (Type B) |
| `src/utils/maps/characteristics.js` | 205 B | Dead (0 importers) |
| `src/ui/utils/authority-proxy.js` | 224 B | Shim (0 importers) |
| `src/ui/dialogs/error-dialog.js` | 273 B | Real code |
| `src/core/effects/status-effect.js` | 311 B | Shim → active-effects/status-effect.js (0 importers) |
| `src/core/documents/items.js` | 313 B | Shim → migrations/items.js (0 importers) |
| `src/core/wounds/index.js` | 327 B | Barrel (Type B, real init logic) |
| `src/core/combat/damage/types.js` | 387 B | Real constants |
| `src/ui/sheets/actor/listeners/inventory.js` | 387 B | Placeholder (empty body) |
| `src/ui/sheets/actor/listeners/rolls.js` | 409 B | Placeholder (empty body) |
| `src/core/aoe/index.js` | 524 B | Barrel (Type B) |
| `src/ui/sheets/npc/listeners/npc-only.js` | 528 B | Real code |
| `src/core/skills/opposed/constants.js` | 569 B | Real constants |
| `src/core/characteristics/opposed/constants.js` | 632 B | Real constants |
| `src/ui/sheets/actor/ui/collapsible-groups.js` | 675 B | Real code |
| `src/utils/diceHelper.js` | 730 B | Dead (0 importers) |
| `src/core/combat/damage/resolver/traits.js` | 742 B | Real code |
| `src/core/combat/opposed/constants.js` | 762 B | Real constants |
| `src/ui/sheets/actor/listeners/magic-cast.js` | 774 B | Thin delegate |
| `src/utils/permissions.js` | 798 B | Real code (6 importers) |
| `src/ui/sheets/actor/ui/filters.js` | 801 B | Real code |
| `src/ui/sheets/actor-sheet-hp-integration.js` | 843 B | Real code |
| `src/utils/active-effect-proxy.js` | 844 B | Wrapper (Type B, 2 importers) |
| `src/core/characteristics/opposed/card-updater.js` | 853 B | Real code |
| `src/core/traits/weapon-expertise/index.js` | 867 B | Barrel (Type B) |
| `src/core/skills/opposed/docs.js` | 868 B | Real code (duplicated) |
| `src/ui/sheets/actor-sheet-stamina-integration.js` | 880 B | Real code |
| `src/ui/sheets/actor/listeners/index.js` | 898 B | Barrel |
| `src/core/characteristics/opposed/docs.js` | 904 B | Real code (duplicated) |
| `src/core/skills/opposed/card-updater.js` | 923 B | Real code |
| `src/core/combat/opposed/helpers/select-equipped-ranged-weapon.js` | 931 B | Real code |
| `src/ui/sheets/actor-sheet-magicka-integration.js` | 955 B | Real code |
| `src/ui/sheets/actor/ui/loadouts.js` | 978 B | Real code |

**Total files < 1 KB: 65** (of which ~31 are pure shims, ~3 are dead, ~2 are placeholders)
