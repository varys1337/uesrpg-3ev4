# UESRPG 3ev4 System - Architecture Roadmap

This document tracks architectural improvements, refactoring progress, and planned work for the UESRPG 3ev4 Foundry VTT system.

## Completed Work

### Phase A — Layout Cleanup (2026-02)

1. **Empty folders removed:**
   - `src/core/skills/opposed/actions/` — empty placeholder, removed
   - `src/ui/sheets/shared/listeners/` — empty placeholder, removed
   - `src/ui/sheets/item/ui/` — empty placeholder, removed

2. **Node-only dev scripts relocated:**
   - `src/utils/generate-item-defaults.js` → `tools/generate-item-defaults.js`
   - Keeps Node builtins (`node:fs`, `node:path`) out of Foundry runtime tree

### Phase B — Combat Opposed Tree Refactor (2026-02)

Restructured `src/core/combat/opposed/` into a navigable folder tree:

| Subfolder | Contents | Files |
|-----------|----------|-------|
| `actions/` | Button action handlers (already existed) | eligibility.js, dispatch.js, banked-roll.js, talents.js, attacker.js, defender-commit.js, defender-roll.js, damage.js, resolve.js |
| `banking/` | Banked roll state, orchestration, external roll banking | state.js, orchestrator.js, external-roll.js |
| `cards/` | Chat card rendering, updating, template helpers, hydration, recovery | template-helpers.js, updater.js, renderers.js, recovery.js, hydration.js |
| `dialogs/` | Attacker/defender dialog modules | common.js, attacker.js, defender.js |
| `damage/` | Damage rolling, damage chat cards, ammunition consumption | damage.js, roller.js, chat-cards.js, ammunition.js |
| `helpers/` | Utility functions, combat helpers, talent helpers, workflow helpers | util.js, docs.js, workflow.js, combat.js, talents.js, utility.js, weapon-quality-display.js |

**Shims created at old paths** (22 total):
- `banking-state.js`, `banking-orchestrator.js`, `external-roll-banking.js`
- `card-template-helpers.js`, `card-updater.js`, `card-renderers.js`, `card-recovery.js`, `card-hydration.js`
- `dialogs.js`, `attacker-dialogs.js`, `defender-dialogs.js`
- `damage.js`, `weapon-damage-roller.js`, `damage-chat-cards.js`, `ammunition-consumption.js`
- `util.js`, `docs.js`, `workflow-helpers.js`, `combat-helpers.js`, `talent-helpers.js`, `utility-helpers.js`, `weapon-quality-display.js`

All shims re-export from new locations, maintaining backward compatibility for the `opposed-workflow.js` facade and any other internal imports.

### Phase C — Shared Sheet Handlers Refactor (2026-02)

Restructured `src/ui/sheets/shared/` into a navigable folder tree:

| Subfolder | Contents | Files |
|-----------|----------|-------|
| `ui/` | Resource display components (already existed) | resources.js |
| `listeners/` | Sheet button click/action handlers | rolls.js, combat-actions.js, magic-cast.js, inventory-handlers.js, economy-handlers.js, characteristics-handlers.js |
| `dialogs/` | Dialog-based UIs for character creation and equipment | character-menus.js, equipment-dialogs.js |
| `helpers/` | UI state and loadout management helpers | ui-state-handlers.js |

**Shims created at old paths** (9 total):
- `rolls.js`, `combat-actions.js`, `magic-cast.js`
- `inventory-handlers.js`, `economy-handlers.js`, `characteristics-handlers.js`
- `character-menus.js`, `equipment-dialogs.js`
- `ui-state-handlers.js`

All shims re-export from new locations, maintaining backward compatibility for `actor-sheet.js` and `npc-sheet.js` imports.

---

## In Progress

_None currently_

---

## Planned / Future Work

### Skills Opposed Workflow

The skills opposed workflow (`src/core/skills/opposed/`) follows a similar modular pattern but with fewer files. Consider:
- Verifying the `actions/` subfolder structure matches combat pattern
- Adding barrel exports if internal import noise increases

### Magic Opposed Workflow

`src/core/magic/opposed/` already has:
- `actions/` subfolder with dispatch pattern
- Core modules (schema, util, render, outcome-resolution, spell-helpers, defense-tn)

Consider:
- Adding barrel exports for internal convenience
- Documenting the facade pattern in `magic/opposed-workflow.js`

### Traits Folder Refactor

`src/core/traits/` contains 7 files at the top level. Consider grouping:
- `registries/` — trait-registry.js, talents-api.js
- `talents/` — combat-talents.js, awareness-talents.js
- `helpers/` — combat-proximity.js, trait-automation.js, trait-resistance-ui.js

---

## Notes

- **Barrel exports**: Use sparingly for internal convenience only. Don't create "mega barrels" that change public API surface.
- **Shims**: When moving externally-imported modules, keep a shim at the old path with re-exports.
- **Delegation pattern**: Main facades (`opposed-workflow.js`) re-export from specialized modules for backward compatibility.
