# Audit: File Inventory

Generated: 2026-02-11

## Size Hotspots (>40 KB)

| File | Size |
|------|------|
| `src/core/combat/chat-handlers.js` | 59.3 KB |
| `src/core/skills/opposed-workflow.js` | 55.0 KB |
| `src/core/magic/opposed/outcome-resolution.js` | 48.7 KB |
| `src/core/combat/damage/resolver/resolve.js` | 45.3 KB |
| `src/core/magic/upkeep-workflow.js` | 44.2 KB |
| `src/core/traits/features/rule-element-runtime.js` | 44.0 KB |
| `src/core/system/activation/activation-executor.js` | 43.7 KB |
| `src/core/magic/opposed/actions.js` | 43.5 KB |
| `src/core/combat/opposed/actions/damage.js` | 43.5 KB |
| `src/core/actors/prepare/character.js` | 41.4 KB |
| `src/core/actors/prepare/npc.js` | 41.1 KB |

## Subsystem Breakdown

| Subsystem | Files | Notes |
|-----------|-------|-------|
| `src/core/combat/` | ~60+ | Includes 33 opposed/ files (22 shims + 11 real) |
| `src/core/magic/` | ~50+ | Large opposed/ and effects/ subtrees |
| `src/core/traits/` | ~30+ | features/ and weapon-expertise/ |
| `src/core/skills/` | ~15+ | opposed/ subdirectory |
| `src/core/actors/` | ~15+ | prepare/, ae/, rules/ |
| `src/ui/sheets/` | ~50+ | shared/ (9 shims + 4 real + 3 subdirs) |
| `src/utils/` | ~20 | 13 primary + 7 dev/ |

## Dead Code Candidates

| File | Importers | Status |
|------|-----------|--------|
| `src/utils/diceHelper.js` | 0 | Superseded by `degree-roll-helper.js` |
| `src/utils/stringHelpers.js` | 0 | `capitalizeFirstLetter` reimplemented locally |
| `src/ui/utils/authority-proxy.js` | 0 | Dead shim → `utils/authority-proxy.js` |
| `src/core/effects/status-effect.js` | 0 | Dead shim → `active-effects/status-effect.js` |
| `src/core/documents/items.js` | 0 | Dead shim → `migrations/items.js` |
