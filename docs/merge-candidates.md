# Audit: Merge Candidates

> Generated: 2025-02-11 — UESRPG 3ev4 codebase

---

## 1. Files Under 2 KB with ≤2 Importers in Same Subsystem

### Immediate Deletion Candidates (Dead Code)

| File | Size | Importers | Action |
|------|------|-----------|--------|
| `src/utils/stringHelpers.js` | 110 B | 0 | **Delete** |
| `src/utils/diceHelper.js` | 730 B | 0 | **Delete** |
| `src/utils/maps/characteristics.js` | 205 B | 0 | **Delete** |
| `src/ui/utils/authority-proxy.js` | 224 B | 0 | **Delete** (dead shim) |
| `src/core/effects/status-effect.js` | 311 B | 0 | **Delete** (dead shim → `active-effects/status-effect.js`) |
| `src/core/documents/items.js` | 313 B | 0 | **Delete** (dead shim → `migrations/items.js`) |

**Total deletable dead code: 6 files, ~1.9 KB**

### Placeholder Files (Empty Bodies)

| File | Size | Importers | Action |
|------|------|-----------|--------|
| `src/ui/sheets/actor/listeners/inventory.js` | 387 B | 1 (`actor/listeners/index.js`) | **Delete** + remove from index barrel |
| `src/ui/sheets/actor/listeners/rolls.js` | 409 B | 1 (`actor/listeners/index.js`) | **Delete** + remove from index barrel |

These are Phase 4 placeholders that were never populated.

### Merge Candidates (Small Files, Same Subsystem, ≤2 Importers)

| File | Size | Importers | Merge Target | Rationale |
|------|------|-----------|-------------|-----------|
| `src/core/combat/damage/types.js` | 387 B | 5 (via `damage-automation.js` barrel) | Keep (stable constants) | Constants are well-isolated. Leave as-is. |
| `src/core/combat/damage/resolver/sources.js` | 1.0 KB | 1 (`resolver/resolve.js`) | `resolver/resolve.js` | Only 1 consumer, both same module. |
| `src/core/combat/damage/resolver/traits.js` | 742 B | 1 (`resolver/resolve.js`) | `resolver/resolve.js` | Only 1 consumer, both same module. |
| `src/core/combat/damage/resolver/armor.js` | 1.3 KB | 1 (`resolver/resolve.js`) | `resolver/resolve.js` | Only 1 consumer. |
| `src/core/combat/damage/resolver/sneak-attack.js` | 2.0 KB | 1 (`resolver/resolve.js`) | `resolver/resolve.js` | Only 1 consumer. |
| `src/core/combat/aim-audit.js` | 1.1 KB | 2 (`npc-sheet.js`, `combat-actions.js`) | Keep | Cross-subsystem usage. |
| `src/core/characteristics/opposed/schema.js` | 1.1 KB | 1 (`opposed-workflow.js`) | Inline into workflow | Very small, 1 consumer. |
| `src/core/characteristics/opposed/util.js` | 1.2 KB | 1 (`opposed-workflow.js`) | Inline into workflow | Very small, 1 consumer. |
| `src/core/skills/opposed/settings.js` | 1.4 KB | — | Check importers before merging | |
| `src/ui/sheets/sheet-inventory.js` | 1.2 KB | 2 (`sheet-prepare-items.js`, `npc-sheet.js`) | Keep | Used by 2 consumers. |
| `src/core/combat/damage-resolver.js` | 1.2 KB | 4 | Keep (façade) | Stable public API surface. |
| `src/core/combat/damage-automation.js` | 2.0 KB | 15 | Keep (façade) | Heavily used public API. |
| `src/ui/sheets/actor-sheet-hp-integration.js` | 843 B | 1 | Merge into `actor-sheet.js` | Very small, single consumer. |
| `src/ui/sheets/actor-sheet-stamina-integration.js` | 880 B | 1 | Merge into `actor-sheet.js` | Very small, single consumer. |
| `src/ui/sheets/actor-sheet-magicka-integration.js` | 955 B | 1 | Merge into `actor-sheet.js` | Very small, single consumer. |

---

## 2. ae-grouping.js — Can It Merge Into ae-helpers.js?

| Property | ae-grouping.js | ae-helpers.js |
|----------|---------------|---------------|
| **Size** | 5,938 B | 3,766 B |
| **Importers** | 1 (`wounds/engine/apply.js`) | 4 (magic, conditions) |
| **Exports** | `applyGroupedEffect`, `getEffectGroup` | `safeGetEffect`, `safeGetEffectByUuidSync`, `isMissingDocError` |
| **Domain** | Effect grouping/stacking with flags | Effect lookup/retrieval safety |

### Verdict: **YES — Good candidate for merge**

- Only 1 importer for `ae-grouping.js`.
- Both files deal with Active Effect utilities.
- Combined size would be ~9.7 KB — still manageable.
- The single importer (`wounds/engine/apply.js`) already imports from other utils modules.
- After merge, `ae-grouping.js` becomes deletable and `wounds/engine/apply.js` updates its import path.
- **Alternative:** If merge is undesirable, at minimum the 1-importer relationship suggests this could be moved to `core/wounds/` as a private helper.

---

## 3. maps/characteristics.js — Who Imports It?

**Nobody.** Zero importers found via grep search for `characteristicAbbreviations` across the codebase.

The `CHARACTERISTICS` constant in `src/core/characteristics/opposed/constants.js` (L12) serves a similar purpose with exactly the same key mapping. The `maps/characteristics.js` file appears to be **dead code**, potentially superseded by the opposed constants file.

**Action: Delete** `src/utils/maps/characteristics.js`.

---

## 4. _primitives.js Files After Dedup

### Current State

| File | Size | Importers | Exports |
|------|------|-----------|---------|
| `src/core/magic/_primitives.js` | ~3.8 KB (99 lines) | **30+** (across magic subsystem) | `_num`, `_numOrNull`, `_str`, `_strTrim`, `createDebugLogger`, `isDebugEnabled` (re-export) |
| `src/core/traits/_primitives.js` | ~4.4 KB (114 lines) | **10** (across traits subsystem) | `_num`, `_lower`, `_buildSituationalMod`, `_canPromptForActor`, `_applyDoSOverride` |

### After Dedup: Would They Become Pure Re-Exports?

**No. Both would retain unique exports after `_num` dedup:**

| File | Would Remain After Centralizing `_num` |
|------|---------------------------------------|
| `magic/_primitives.js` | `_numOrNull`, `_str`, `_strTrim`, `createDebugLogger`, `isDebugEnabled` — **still a real module** |
| `traits/_primitives.js` | `_lower`, `_buildSituationalMod`, `_canPromptForActor`, `_applyDoSOverride` — **still a real module** |

**Conclusion:** `_primitives.js` files are not deletable after dedup. They serve as domain-scoped utility bundles. The dedup action is to:
1. Create a shared `_num()` in one canonical location (e.g., new `src/utils/coerce.js`)
2. Have both `_primitives.js` files re-export `_num` from the canonical source
3. Inline copies in `rest-workflow.js`, `activation-executor.js`, `activation-state-flags.js`, `effect-duration.js`, `time-service.js`, `rule-element-runtime.js` would import from the canonical source or their nearest `_primitives.js`

---

## 5. Opposed Workflow Shim Consolidation

### 22 Shims in `src/core/combat/opposed/` → All Deletable

Every shim has **exactly 1 importer**: `src/core/combat/opposed-workflow.js`.

**Action:** Update `opposed-workflow.js` to import from canonical subdirectory targets directly. Delete all 22 shims.

| Savings | |
|---------|-----|
| Files removed | 22 |
| Bytes saved | ~3.1 KB |
| Import indirection eliminated | 22 hops |

### 9 Shims in `src/ui/sheets/shared/` → All Deletable

Each shim has 1–2 importers (`actor-sheet.js` and/or `npc-sheet.js`).

**Action:** Update the 2 sheet files to import from canonical subdirectory targets. Delete all 9 shims.

| Savings | |
|---------|-----|
| Files removed | 9 |
| Bytes saved | ~1.4 KB |
| Import indirection eliminated | 9 hops |

---

## 6. Summary: All Actionable Merge/Delete Candidates

| Category | Files | Savings |
|----------|-------|---------|
| Dead code (0 importers) | 6 | ~1.9 KB |
| Placeholder files | 2 | ~0.8 KB |
| Opposed shims | 22 | ~3.1 KB |
| Sheet shared shims | 9 | ~1.4 KB |
| Resolver internal merges to `resolve.js` | 4 | 4 files eliminated |
| Actor-sheet integration merges | 3 | 3 files eliminated |
| ae-grouping → ae-helpers merge | 1 | 1 file eliminated |
| **Total deletable** | **47 files** | ~7.2 KB + reduced indirection |

### Not Recommended for Merge

| File | Reason |
|------|--------|
| `damage-automation.js` | 15 importers, stable façade |
| `damage-resolver.js` | 4 importers, stable façade |
| `active-effect-proxy.js` | 2 importers, but thin wrapper serves backward compat |
| `_primitives.js` (both) | Real utility bundles with unique exports |
| `damage/types.js` | Stable constants, well-isolated |
| `aim-audit.js` | Cross-subsystem importers |
