# Audit: Import Graph

> Generated: 2025-02-11 — UESRPG 3ev4 codebase

---

## 1. Cross-Subsystem Import Matrix

Rows = importing subsystem, Columns = imported subsystem.
Count = number of `import` lines crossing from source into target subsystem.

| **From \ To** | combat | magic | traits | skills | active-effects | conditions | time | wounds | aoe | actors | characteristics | stamina | utils |
|---------------|--------|-------|--------|--------|----------------|------------|------|--------|-----|--------|-----------------|---------|-------|
| **core/combat** | self | ~12 | ~25 | ~5 | ~2 | ~5 | ~4 | ~1 | 0 | 0 | ~2 | ~1 | ~20 |
| **core/magic** | ~12 | self | ~8 | ~2 | ~4 | ~1 | ~2 | 0 | 0 | 0 | 0 | 0 | ~15 |
| **core/traits** | ~6 | ~1 | self | ~1 | ~2 | ~3 | ~2 | ~1 | 0 | 0 | 0 | 0 | ~8 |
| **core/skills** | 0 | 0 | 0 | self | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ~5 |
| **core/conditions** | ~2 | 0 | ~1 | 0 | 0 | self | ~1 | 0 | 0 | 0 | 0 | 0 | ~5 |
| **core/wounds** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | self | 0 | 0 | 0 | 0 | ~4 |
| **core/time** | 0 | 0 | 0 | 0 | 0 | 0 | self | 0 | 0 | 0 | 0 | 0 | 0 |
| **core/characteristics** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | self | 0 | ~3 |
| **ui/sheets** | ~20 | ~8 | ~12 | ~8 | ~2 | ~1 | ~2 | 0 | ~1 | 0 | 0 | ~1 | ~15 |
| **ui/canvas** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **hooks** | ~3 | 0 | 0 | 0 | 0 | ~1 | ~1 | ~1 | 0 | 0 | 0 | 0 | ~3 |

### Key Observations

1. **combat ↔ magic** is the heaviest cross-subsystem coupling (~12 imports each direction)
2. **combat ← traits** is the second heaviest (~25 imports from combat into traits)
3. **traits → combat** creates a mutual dependency (6 imports back)
4. **ui/sheets → core/***: 70+ imports into core subsystems — this is expected (sheets are consumers)
5. **core/skills** and **core/time** are remarkably self-contained (zero or near-zero outbound cross-subsystem imports to other core subsystems)
6. **core/characteristics** imports only from utils — fully isolated from other core subsystems

---

## 2. Circular Dependency Risks

### Risk 1: combat ↔ magic (MODERATE)

| Direction | Example |
|-----------|---------|
| combat → magic | `chat-handlers.js` → `magic/opposed/schema.js`, `magic/damage-application.js` |
| magic → combat | `upkeep-workflow.js` → `combat/attack-tracker.js`; `opposed/actions.js` → `combat/action-economy.js`, `combat/ward-defense.js`, `combat/mitigation.js` |

The coupling is spread across many modules. No direct A↔B cycle detected — imports are to different files within each subsystem. But the **subsystem-level graph contains a cycle**: `combat → magic → combat`.

**Mitigation:** These imports hit different files (no single-file circular import). ES module static imports resolve this at the file level, not the subsystem level. Risk is **architecture smell**, not a runtime error.

### Risk 2: combat ↔ traits (MODERATE)

| Direction | Example |
|-----------|---------|
| combat → traits | `opposed/helpers/talents.js` → `traits/combat-talents.js`, `traits/talents-api.js`, `traits/combat-proximity.js` |
| traits → combat | `combat-talents.js` → `combat/damage-automation.js`, `combat/combat-utils.js` |

Same pattern: subsystem-level cycle, but file-level graph is a DAG.

### Risk 3: magic ↔ traits (LOW)

| Direction | Example |
|-----------|---------|
| magic → traits | `spell-profile.js` → `traits/spellcasting-talents.js`, `traits/features/rule-element-runtime.js` |
| traits → magic | `spellcasting-talents.js` → `magic/magic-modifiers.js` |

### Risk 4: Opposed workflow cross-references (LOW)

- `combat/opposed/retarget.js` imports from `skills/opposed/` and `magic/opposed/` — this is a deliberate "hub" pattern for retargeting across workflow types.

**Overall Circular Risk Assessment: MODERATE** — No runtime circular import errors, but `combat`, `magic`, and `traits` form a tightly coupled triangle. Refactoring would require explicit API boundaries.

---

## 3. src/utils/ Module Import Frequency

| Module | Importers | Key Consumers |
|--------|-----------|---------------|
| `utils/authority-proxy.js` | **~22** | combat, magic, conditions, wounds, stamina, ui/sheets |
| `utils/degree-roll-helper.js` | **~16** | combat, magic, skills, characteristics, traits, ui/sheets |
| `utils/debug.js` | **~14** | combat, magic, traits, skills, conditions, wounds, ui/sheets |
| `utils/chat-message-socket.js` | **~10** | combat, magic, skills, characteristics |
| `utils/permissions.js` | **~6** | combat, magic, skills, characteristics, ui/sheets |
| `utils/ae-helpers.js` | **~4** | magic, conditions |
| `utils/ae-grouping.js` | **1** | wounds/engine/apply.js |
| `utils/skillCalcHelper.js` | **~3** | ui/sheets, core/documents, core/combat |
| `utils/aoe-utils.js` | **~4** | combat, magic |
| `utils/active-effect-proxy.js` | **2** | hooks/init.js, combat/opposed-workflow.js |
| `utils/stringHelpers.js` | **0** | Dead — no importers |
| `utils/diceHelper.js` | **0** | Dead — no importers |
| `utils/maps/characteristics.js` | **0** | Dead — no importers |

### Dead Utils (0 importers)

1. **`utils/stringHelpers.js`** (110 B) — Exports `capitalizeFirstLetter` but nothing imports it
2. **`utils/diceHelper.js`** (730 B) — Exports `calculateDegrees` but nothing imports it
3. **`utils/maps/characteristics.js`** (205 B) — Exports `characteristicAbbreviations` but nothing imports it

### Low-Usage Utils (≤2 importers)

4. **`utils/ae-grouping.js`** (5.9 KB) — **1 importer** (`wounds/engine/apply.js`)
5. **`utils/active-effect-proxy.js`** (844 B) — **2 importers** (wrapper around `authority-proxy.js`)
