# Audit: Shim Inventory

> Generated: 2025-02-11 — UESRPG 3ev4 codebase

## Type A: Pure Re-Export Shims

A file is a **Type A shim** if its entire logic is a single `export * from "..."` statement (plus a JSDoc comment).

---

### Opposed Workflow Shims (`src/core/combat/opposed/`)

22 shims, all following the pattern: `export * from "./subdirectory/target.js";`

| # | Shim File | Re-Export Statement | Canonical Target | Importers |
|---|-----------|-------------------|-------------------|-----------|
| 1 | `opposed/damage.js` (122 B) | `export * from "./damage/damage.js"` | `opposed/damage/damage.js` | 1: `opposed-workflow.js` |
| 2 | `opposed/util.js` (123 B) | `export * from "./helpers/util.js"` | `opposed/helpers/util.js` | 1: `opposed-workflow.js` |
| 3 | `opposed/docs.js` (123 B) | `export * from "./helpers/docs.js"` | `opposed/helpers/docs.js` | 1: `opposed-workflow.js` |
| 4 | `opposed/dialogs.js` (130 B) | `export * from "./dialogs/common.js"` | `opposed/dialogs/common.js` | 1: `opposed-workflow.js` |
| 5 | `opposed/card-updater.js` (133 B) | `export * from "./cards/updater.js"` | `opposed/cards/updater.js` | 1: `opposed-workflow.js` |
| 6 | `opposed/banking-state.js` (134 B) | `export * from "./banking/state.js"` | `opposed/banking/state.js` | 1: `opposed-workflow.js` |
| 7 | `opposed/card-recovery.js` (136 B) | `export * from "./cards/recovery.js"` | `opposed/cards/recovery.js` | 1: `opposed-workflow.js` |
| 8 | `opposed/combat-helpers.js` (137 B) | `export * from "./helpers/combat.js"` | `opposed/helpers/combat.js` | 1: `opposed-workflow.js` |
| 9 | `opposed/card-hydration.js` (139 B) | `export * from "./cards/hydration.js"` | `opposed/cards/hydration.js` | 1: `opposed-workflow.js` |
| 10 | `opposed/card-renderers.js` (139 B) | `export * from "./cards/renderers.js"` | `opposed/cards/renderers.js` | 1: `opposed-workflow.js` |
| 11 | `opposed/talent-helpers.js` (139 B) | `export * from "./helpers/talents.js"` | `opposed/helpers/talents.js` | 1: `opposed-workflow.js` |
| 12 | `opposed/utility-helpers.js` (140 B) | `export * from "./helpers/utility.js"` | `opposed/helpers/utility.js` | 1: `opposed-workflow.js` |
| 13 | `opposed/weapon-damage-roller.js` (141 B) | `export * from "./damage/roller.js"` | `opposed/damage/roller.js` | 1: `opposed-workflow.js` |
| 14 | `opposed/workflow-helpers.js` (143 B) | `export * from "./helpers/workflow.js"` | `opposed/helpers/workflow.js` | 1: `opposed-workflow.js` (4 import lines) |
| 15 | `opposed/attacker-dialogs.js` (143 B) | `export * from "./dialogs/attacker.js"` | `opposed/dialogs/attacker.js` | 1: `opposed-workflow.js` |
| 16 | `opposed/defender-dialogs.js` (143 B) | `export * from "./dialogs/defender.js"` | `opposed/dialogs/defender.js` | 1: `opposed-workflow.js` |
| 17 | `opposed/damage-chat-cards.js` (146 B) | `export * from "./damage/chat-cards.js"` | `opposed/damage/chat-cards.js` | 1: `opposed-workflow.js` |
| 18 | `opposed/ammunition-consumption.js` (151 B) | `export * from "./damage/ammunition.js"` | `opposed/damage/ammunition.js` | 1: `opposed-workflow.js` (2 import lines) |
| 19 | `opposed/banking-orchestrator.js` (155 B) | `export * from "./banking/orchestrator.js"` | `opposed/banking/orchestrator.js` | 1: `opposed-workflow.js` |
| 20 | `opposed/external-roll-banking.js` (158 B) | `export * from "./banking/external-roll.js"` | `opposed/banking/external-roll.js` | 1: `opposed-workflow.js` |
| 21 | `opposed/card-template-helpers.js` (160 B) | `export * from "./cards/template-helpers.js"` | `opposed/cards/template-helpers.js` | 1: `opposed-workflow.js` |
| 22 | `opposed/weapon-quality-display.js` (177 B) | `export * from "./helpers/weapon-quality-display.js"` | `opposed/helpers/weapon-quality-display.js` | 1: `opposed-workflow.js` |

**All 22 have exactly 1 importer**: `src/core/combat/opposed-workflow.js`.
The façade (`opposed-workflow.js`) could import directly from the canonical subdirectory targets, allowing deletion of all 22 shims.

---

### Sheet Shared Shims (`src/ui/sheets/shared/`)

9 shims, all redirecting to `./listeners/` , `./dialogs/`, or `./helpers/` subdirectories.

| # | Shim File | Re-Export Statement | Canonical Target | Importers |
|---|-----------|-------------------|-------------------|-----------|
| 1 | `shared/rolls.js` (130 B) | `export * from "./listeners/rolls.js"` | `shared/listeners/rolls.js` | 2: `actor-sheet.js`, `npc-sheet.js` |
| 2 | `shared/magic-cast.js` (145 B) | `export * from "./listeners/magic-cast.js"` | `shared/listeners/magic-cast.js` | 2: `actor-sheet.js`, `npc-sheet.js` |
| 3 | `shared/character-menus.js` (156 B) | `export * from "./dialogs/character-menus.js"` | `shared/dialogs/character-menus.js` | 1: `actor-sheet.js` |
| 4 | `shared/combat-actions.js` (157 B) | `export * from "./listeners/combat-actions.js"` | `shared/listeners/combat-actions.js` | 2: `actor-sheet.js`, `npc-sheet.js` |
| 5 | `shared/ui-state-handlers.js` (162 B) | `export * from "./helpers/ui-state-handlers.js"` | `shared/helpers/ui-state-handlers.js` | 2: `actor-sheet.js`, `npc-sheet.js` |
| 6 | `shared/equipment-dialogs.js` (162 B) | `export * from "./dialogs/equipment-dialogs.js"` | `shared/dialogs/equipment-dialogs.js` | 2: `actor-sheet.js`, `npc-sheet.js` |
| 7 | `shared/economy-handlers.js` (163 B) | `export * from "./listeners/economy-handlers.js"` | `shared/listeners/economy-handlers.js` | 2: `actor-sheet.js`, `npc-sheet.js` |
| 8 | `shared/inventory-handlers.js` (169 B) | `export * from "./listeners/inventory-handlers.js"` | `shared/listeners/inventory-handlers.js` | 2: `actor-sheet.js`, `npc-sheet.js` |
| 9 | `shared/characteristics-handlers.js` (187 B) | `export * from "./listeners/characteristics-handlers.js"` | `shared/listeners/characteristics-handlers.js` | 2: `actor-sheet.js`, `npc-sheet.js` |

---

### Dead Shims (0 importers)

| # | Shim File | Re-Export Statement | Canonical Target |
|---|-----------|-------------------|-------------------|
| 1 | `src/ui/utils/authority-proxy.js` (224 B) | `export * from "../../utils/authority-proxy.js"` | `src/utils/authority-proxy.js` |
| 2 | `src/core/effects/status-effect.js` (311 B) | `export * from "../active-effects/status-effect.js"` | `src/core/active-effects/status-effect.js` |
| 3 | `src/core/documents/items.js` (313 B) | `export { migrateItemsIfNeeded } from "../migrations/items.js"` | `src/core/migrations/items.js` |

**All 3 can be deleted** — no files import from them.

---

### Other Re-Export Shim

| Shim File | Statement | Target | Importers |
|-----------|-----------|--------|-----------|
| `src/ui/sheets/actor/listeners/magic-cast.js` (774 B) | Delegates to `shared/listeners/magic-cast.js` import + registers listeners | `shared/listeners/magic-cast.js` | 1: `actor/listeners/index.js` |

Not a pure shim (it adds event binding), but very thin.

---

## Type B: Barrel / Façade Files

These files barrel-export multiple internal modules and/or add behavior. They are **not candidates for deletion** but are catalogued for architecture awareness.

| File | Size | Purpose | Importers |
|------|------|---------|-----------|
| `src/core/combat/damage-automation.js` | 2.0 KB | Barrel re-export of `damage/types`, `damage/tokens`, `damage/reduction`, `damage/calc`, `damage/apply` + window global. | 15 |
| `src/core/combat/damage-resolver.js` | 1.2 KB | Barrel re-export of `damage/resolver/resolve.js` | 4 |
| `src/utils/active-effect-proxy.js` | 844 B | Wrapper around `authority-proxy.js` with thin API. | 2 (`hooks/init.js`, `opposed-workflow.js`) |
| `src/core/time/index.js` | 167 B | Barrel: `TimeService`, `initializeTimeService`, `buildEffectDuration` | 4 |
| `src/core/conditions/index.js` | 2.0 KB | Barrel + init guard: `registerConditions()` with `_conditionsRegistered` flag, exports `CONDITION_KEYS` | 2 |
| `src/core/wounds/index.js` | 327 B | Barrel + init guard: `registerWounds()` with `_woundsRegistered` flag | 1 (`hooks/init.js`) |
| `src/core/aoe/index.js` | 524 B | Barrel: `AoEService`, constants, template data, placement | 2 |
| `src/core/traits/weapon-expertise/index.js` | 867 B | Barrel: all weapon expertise data + helpers + handlers | (not searched, assumed internal) |
| `src/core/traits/features/index.js` | 1.5 KB | Barrel for feature subsystem | (not searched) |
