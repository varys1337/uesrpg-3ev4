# New-World-Only Release

## What "new-world-only" means

Starting with this build, the UESRPG 3ev4 system **no longer ships automatic document migrations or data normalization routines**. Worlds created under earlier system versions are not automatically upgraded and may not function correctly.

When a world is first opened with this build, the system stamps the current version into a hidden setting (`worldDataVersion`). On subsequent launches, the system compares the stamped version against the running version:

- **Match →** Normal startup proceeds.
- **Mismatch →** The GM receives a permanent notification and a dialog warning that the world is unsupported. Further system initialization (subsystem startup, spell engines, combat hooks, etc.) is skipped to prevent data corruption.
- **No stamp (first launch) →** The version is recorded automatically and startup proceeds normally.

## Upgrade path

If you have an existing world from an older system build:

1. **Create a new Foundry VTT world** using this system version.
2. **Import compendia** shipped with this build (skills, spells, talents, traits, items, etc.) into the new world.
3. **Manually transfer** player characters:
   - Export each Actor as JSON from the old world (`Right-click → Export Data`).
   - Import into the new world (`Actors → Import Data`).
   - Verify derived values, Active Effects, and inventory after import.
4. **Re-create any homebrew content** (custom items, spells, talents) in the new world using the shipped compendia as templates.

> **Tip:** You can run both worlds side-by-side (different system versions) during the transition period by keeping a backup of the old system folder.

## How the compatibility gate works

The gate lives in `src/system.js` inside the `Hooks.once("ready")` callback:

1. Reads `game.settings.get("uesrpg-3ev4", "worldDataVersion")`.
2. If empty → stamps `game.system.version` and continues.
3. If non-empty and matches current version → continues.
4. If non-empty and **does not match** → shows error notification + dialog, then `return`s early from the ready hook, preventing all downstream initialization.

The setting is registered as `scope: "world", config: false` in `src/hooks/init.js`, so it is invisible to users and persists per-world.

## What was removed

| Component | Files | Purpose |
|-----------|-------|---------|
| Actor migrations | `src/core/migrations/actors.js` | Auto-repair resistance defaults, invalid system payloads |
| Item migrations | `src/core/migrations/items.js` | Normalize weapon/armor/spell fields, apply template defaults |
| Migration helpers | `src/core/migrations/apply-defaults.js`, `item-defaults.generated.js` | Recursive default application utility |
| Migration settings | `migrationState`, `disableMigrations` | Bookkeeping and toggle for the above |
| RE settings migrations | `migrateRuleElementRuntimeSettingsV2/V3` | One-shot Rule Element runtime workflow activation |
| RE migration markers | `ruleElementsRuntimeWorkflowMigrated`, `ruleElementsRuntimeV3Migrated` | Gate settings for the above |
| Frenzied legacy repair | `_registerFrenziedRepairHook`, `_repairLegacyFrenziedEffectsOnReady` | Scan/repair old Frenzied effects with missing changes |
| Effect icon normalization | `normalizeInvalidEffectIcons` | Fix `arrow-up.svg` → `up.svg` on all effects |

## What was preserved

- **Frenzied SP toggle behavior** — Disabling/re-enabling the Frenzied effect still correctly removes/grants Stamina Points (extracted into `_registerFrenziedToggleHook`).
- **Frenzied defensive validation** — `_needsFrenziedChangesRepair()` is still used by preCreate/create/apply paths to ensure newly-created Frenzied effects have correct AE changes.
- **All runtime systems** — Spell engines, combat workflows, stamina, time service, opposed workflows, etc. function identically for new worlds.
- **RE runtime settings** — Per-workflow toggles (`enableRuleElementsRuntimeSkill`, etc.) are kept at their current defaults (`true`). Only the one-shot migration that populated them is removed.
