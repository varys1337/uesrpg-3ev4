# Changelog

## New-World-Only Release

### Breaking Changes
- **World compatibility gate** — Worlds created under older system builds are no longer supported. A version-stamped gate blocks initialization if the world's recorded version doesn't match the running system version. GMs receive a warning dialog with upgrade guidance.

### Removed
- **Document migrations** — Deleted `src/core/migrations/` (actors.js, items.js, apply-defaults.js, item-defaults.generated.js). No automatic actor/item normalization or migration runs on startup.
- **Migration settings** — Removed `migrationState`, `disableMigrations` settings registrations.
- **Rule Element runtime migrations** — Removed `migrateRuleElementRuntimeSettingsV2()`, `migrateRuleElementRuntimeSettingsV3()` and their marker settings (`ruleElementsRuntimeWorkflowMigrated`, `ruleElementsRuntimeV3Migrated`).
- **Frenzied legacy repair** — Removed `_registerFrenziedRepairHook()` (changes-repair on `updateActiveEffect`) and `_repairLegacyFrenziedEffectsOnReady()` (full actor scan).
- **Effect icon normalization** — Removed `normalizeInvalidEffectIcons()` (SVG path repair for older builds).

### Changed
- **Frenzied SP toggle** — Extracted toggle-on/off SP behavior from the removed repair hook into a new standalone `_registerFrenziedToggleHook()`. Behavior is unchanged for current worlds.

### Added
- **`worldDataVersion` setting** — Hidden per-world setting stamped on first launch, used by the compatibility gate.
- **`docs/release/new-world-only.md`** — Documentation for the new-world-only policy and upgrade path.
