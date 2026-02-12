# Audit: Shim Inventory

Generated: 2026-02-11

## Type A — Pure Re-export Shims (34 total)

### Dead (0 importers) — 3 files

| Shim | Target | Action |
|------|--------|--------|
| `src/ui/utils/authority-proxy.js` | `../../utils/authority-proxy.js` | Delete |
| `src/core/effects/status-effect.js` | `../active-effects/status-effect.js` | Delete |
| `src/core/documents/items.js` | `../migrations/items.js` | Delete |

### Opposed Workflow Shims — 22 files

All in `src/core/combat/opposed/`, all imported **only** by `opposed-workflow.js`.

| Shim | Canonical Target |
|------|-----------------|
| `ammunition-consumption.js` | `./damage/ammunition.js` |
| `attacker-dialogs.js` | `./dialogs/attacker.js` |
| `banking-orchestrator.js` | `./banking/orchestrator.js` |
| `banking-state.js` | `./banking/state.js` |
| `card-hydration.js` | `./cards/hydration.js` |
| `card-recovery.js` | `./cards/recovery.js` |
| `card-renderers.js` | `./cards/renderers.js` |
| `card-template-helpers.js` | `./cards/template-helpers.js` |
| `card-updater.js` | `./cards/updater.js` |
| `combat-helpers.js` | `./helpers/combat.js` |
| `damage-chat-cards.js` | `./damage/chat-cards.js` |
| `damage.js` | `./damage/damage.js` |
| `defender-dialogs.js` | `./dialogs/defender.js` |
| `dialogs.js` | `./dialogs/common.js` |
| `docs.js` | `./helpers/docs.js` |
| `external-roll-banking.js` | `./banking/external-roll.js` |
| `talent-helpers.js` | `./helpers/talents.js` |
| `util.js` | `./helpers/util.js` |
| `utility-helpers.js` | `./helpers/utility.js` |
| `weapon-damage-roller.js` | `./damage/roller.js` |
| `weapon-quality-display.js` | `./helpers/weapon-quality-display.js` |
| `workflow-helpers.js` | `./helpers/workflow.js` |

### Sheet Shared Shims — 9 files

All in `src/ui/sheets/shared/`, imported by `actor-sheet.js` and `npc-sheet.js`.

| Shim | Canonical Target (within shared/) |
|------|----------------------------------|
| `character-menus.js` | `./dialogs/character-menus.js` |
| `characteristics-handlers.js` | `./listeners/characteristics-handlers.js` |
| `combat-actions.js` | `./listeners/combat-actions.js` |
| `economy-handlers.js` | `./listeners/economy-handlers.js` |
| `equipment-dialogs.js` | `./dialogs/equipment-dialogs.js` |
| `inventory-handlers.js` | `./listeners/inventory-handlers.js` |
| `magic-cast.js` | `./listeners/magic-cast.js` |
| `rolls.js` | `./listeners/rolls.js` |
| `ui-state-handlers.js` | `./helpers/ui-state-handlers.js` |

## Type B — Wrapper Shim (1)

| File | Behavior |
|------|----------|
| `src/utils/active-effect-proxy.js` | Maps `requestCreateActiveEffect` → `requestCreateActiveEffectAuthority` from `authority-proxy.js` |

## Type B — Facade/Barrel Files (Preserved)

| File | Purpose | Importers |
|------|---------|-----------|
| `src/core/combat/damage-automation.js` | Barrel + `window.Uesrpg3e.damage` global | 4+ |
| `src/core/combat/damage-resolver.js` | Re-exports `applyDamageResolved` | 4 |
| `src/core/magic/index.js` | Barrel (328 lines, ~20 modules) | Central API |
| `src/core/traits/index.js` | Barrel (153 lines) | Central API |
| `src/core/conditions/index.js` | Functional init + barrel | System init |
| `src/core/time/index.js` | Barrel (7 lines) | Thin |
| `src/core/aoe/index.js` | Barrel (14 lines) | Thin |
| `src/core/wounds/index.js` | Hybrid barrel + init | System init |
