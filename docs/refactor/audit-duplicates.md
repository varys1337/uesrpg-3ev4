# Audit: Duplicate Detection

Generated: 2026-02-11

## `_num()` — 9 copies (2 exported, 7 private)

All use identical core logic: `Number.isFinite(Number(v)) ? Number(v) : fallback`

| File | Signature | Default | Scope |
|------|-----------|---------|-------|
| `src/core/magic/_primitives.js:30` | `_num(v, d = 0)` | `0` | Exported |
| `src/core/traits/_primitives.js:28` | `_num(v, fallback = 0)` | `0` | Exported |
| `src/core/magic/spell-range.js:16` | `_num(v, fallback = null)` | `null` (wraps canonical) | Private |
| `src/core/traits/features/rule-element-runtime.js:38` | `_num(value, fallback = 0)` | `0` | Private |
| `src/core/time/time-service.js:18` | `_num(v, d = 0)` | `0` | Private |
| `src/core/time/effect-duration.js:11` | `_num(v, d = 0)` | `0` | Private |
| `src/core/system/activation/activation-executor.js:39` | `_num(n)` | hardcoded `0` | Private |
| `src/core/combat/activation-state-flags.js:16` | `_num(value, fallback = 0)` | `0` | Private |
| `src/ui/sheets/rest-workflow.js:4` | `_num(value)` | hardcoded `0` | Private |

**Decision:** Canonical `_num(v, d = 0)` in `src/utils/coerce.js`. All copies replaced. `spell-range.js` keeps its wrapper (changes default to `null`).

## `_bool()` — 7 copies (0 exported, 7 private)

4 distinct behavioral variants:

| Variant | Files | Handles `"y"`/`"n"` | `Boolean(v)` fallback |
|---------|-------|---------------------|----------------------|
| Simplest | `trait-resistance-ui.js:10` | No | No |
| Medium | `spellcasting-talents.js:75`, `spell-config.js:30`, `damage-application.js:22` | No (dag-app has "y") | No |
| Full keywords | `spell-runtime.js:25` | Yes | No (returns false) |
| Full + Boolean | `spell-profile.js:81`, `magicka-utils.js:79` | No | Yes |

**Decision:** Canonical version combines all keyword coverage + returns `false` for unknowns (most deterministic).

## `_str()` — 2 copies (1 exported, 1 private)

| File | Trims? | Scope |
|------|--------|-------|
| `src/core/magic/_primitives.js:57` | No | Exported |
| `src/core/traits/spellcasting-talents.js:71` | **Yes** | Private |

**Decision:** Both `_str` (no trim) and `_strTrim` (trims) in `src/utils/coerce.js`.

## `capitalizeFirstLetter()` — 2+1 copies

| Location | Type |
|----------|------|
| `src/utils/stringHelpers.js` | Exported (dead — 0 importers) |
| `src/ui/dialogs/choose-birthsign-penalty.js` | Local copy |
| `src/system.js` | Handlebars helper `capitalize` |

## `_clampNumber()` — 2 copies (incompatible signatures)

| File | Signature |
|------|-----------|
| `src/ui/canvas/reach-visualizer.js` | `(value, min, max, fallback)` |
| `src/ui/canvas/reach-visualizer-config.js` | `(value, { min, max, fallback })` |

**Decision:** Leave as-is (incompatible, both in same narrow subsystem).
