# Audit: Duplicate Detection

> Generated: 2025-02-11 — UESRPG 3ev4 codebase

---

## 1. `_num()` — 10 Copies

### Variant A: `_num(v, d = 0)` — Standard 2-param with default 0

```js
function _num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
```

| # | File | Line | Exported? | Signature | Semantics Match |
|---|------|------|-----------|-----------|-----------------|
| 1 | `src/core/magic/_primitives.js` | L30 | **Yes** | `_num(v, d = 0)` | **Canonical** |
| 2 | `src/core/traits/_primitives.js` | L28 | **Yes** | `_num(v, fallback = 0)` | **Identical** (param name differs) |
| 3 | `src/core/time/effect-duration.js` | L11 | No | `_num(v, d = 0)` | **Identical** |
| 4 | `src/core/time/time-service.js` | L18 | No | `_num(v, d = 0)` | **Identical** |
| 5 | `src/core/traits/features/rule-element-runtime.js` | L38 | No | `_num(value, fallback = 0)` | **Identical** |
| 6 | `src/core/combat/activation-state-flags.js` | L16 | No | `_num(value, fallback = 0)` | **Identical** |

### Variant B: `_num(value)` — 1-param, hardcoded default 0

```js
function _num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
```

| # | File | Line | Exported? | Signature | Semantics |
|---|------|------|-----------|-----------|-----------|
| 7 | `src/ui/sheets/rest-workflow.js` | L4 | No | `_num(value)` | **Subset** of Variant A with `d=0` |
| 8 | `src/core/system/activation/activation-executor.js` | L39 | No | `_num(n)` | **Subset** of Variant A with `d=0` |

### Variant C: `_num(v, fallback = null)` — null default

```js
function _num(v, fallback = null) {
  return _numBase(v, fallback);
}
```

| # | File | Line | Exported? | Semantics |
|---|------|------|-----------|-----------|
| 9 | `src/core/magic/spell-range.js` | L16 | No | Wraps `_primitives._num` with null default — unique behavior |

### Variant D: Separate function for null default

| # | File | Line | Exported? | Function | Semantics |
|---|------|------|-----------|----------|-----------|
| 10 | `src/core/magic/_primitives.js` | L43 | **Yes** | `_numOrNull(v, d = null)` | Adds null/undefined short-circuit |

### Dedup Verdict

- **6 copies are semantically identical** to Variant A (items 1–6). Could be consolidated to a single shared import.
- **2 copies** (items 7–8) are strictly a subset of Variant A behavior.
- `spell-range.js` variant (item 9) is a thin wrapper that already imports from `_primitives.js`.
- **Recommended canonical location:** `src/core/magic/_primitives.js` (already exported, most widely imported)

---

## 2. `_bool()` — 7 Copies

### Variant A: Minimal boolean coercion

```js
function _bool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  return false;
}
```

| # | File | Line | Signature | Truthy Set | Falsy Handling | Match |
|---|------|------|-----------|------------|----------------|-------|
| 1 | `src/core/magic/spell-config.js` | L30 | `_bool(v)` | `"true","1","yes","on"` | `return false` | **Baseline** |
| 2 | `src/core/traits/spellcasting-talents.js` | L75 | `_bool(v)` | `"true","1","yes","on"` | `return false` | **Identical** to #1 (uses local `_str`) |

### Variant B: Extended with `"y"` + explicit falsy check

```js
function _bool(v) {
  if (v === true || v === false) return v;
  const s = _str(v).trim().toLowerCase();
  if (!s) return false;
  if (s === "true" || s === "1" || s === "yes" || s === "y" || s === "on") return true;
  return false;
}
```

| # | File | Line | Truthy Set | Semantics |
|---|------|------|------------|-----------|
| 3 | `src/core/magic/damage-application.js` | L22 | `+ "y"` | Slightly broader |
| 4 | `src/core/magic/spell-runtime.js` | L25 | `+ "y"` and explicit `"n"/"off"/"no"` falsy | **Identical to #3** in outcome |

### Variant C: Extended with `Boolean(v)` fallback

```js
function _bool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off" || s === "") return false;
  return Boolean(v);  // ← differs: falls back to JS truthiness
}
```

| # | File | Line | Semantics |
|---|------|------|-----------|
| 5 | `src/core/magic/spell-profile.js` | L81 | `Boolean(v)` fallback for unknown strings |
| 6 | `src/core/magic/magicka-utils.js` | L79 | **Identical** to #5 |

### Variant D: Minimal (no string parsing)

```js
function _bool(val) {
  return val === true || val === "true" || val === "1";
}
```

| # | File | Line | Semantics |
|---|------|------|-----------|
| 7 | `src/core/traits/trait-resistance-ui.js` | L10 | **Narrowest** — no lowercase, no "yes"/"on" |

### Dedup Verdict

- **3 semantically distinct variants** exist (A, B/C, D). The differences are intentional form-value parsing.
- A unified `_bool` matching Variant B (the superset) would cover all callers.
- `trait-resistance-ui.js` (Variant D) is intentionally narrow for checkbox-only values.
- **Not in `_primitives.js` today** — neither magic nor traits `_primitives.js` exports `_bool`.

---

## 3. `_str()` — 3 Copies

| # | File | Line | Exported? | Body | Semantics |
|---|------|------|-----------|------|-----------|
| 1 | `src/core/magic/_primitives.js` | L57 | **Yes** | `return v === undefined \|\| v === null ? "" : String(v)` | **No trim** |
| 2 | `src/core/traits/spellcasting-talents.js` | L71 | No | `return String(v ?? "").trim()` | **With trim** |
| 3 | `src/core/magic/_primitives.js` | L67 | **Yes** (`_strTrim`) | `return String(v ?? "").trim()` | **With trim** |

### Dedup Verdict

- `_primitives.js` already exports both `_str` (no-trim) and `_strTrim` (trim).
- `spellcasting-talents.js` copy (#2) is **identical** to `_strTrim` — should import from `_primitives.js`.
- Some callers import `_strTrim as _str` from `_primitives.js`, which is the intended aliasing pattern.

---

## 4. `capitalizeFirstLetter()` — 2 Copies

| # | File | Line | Body | Identical? |
|---|------|------|------|------------|
| 1 | `src/utils/stringHelpers.js` | L1 | `return string.charAt(0).toUpperCase() + string.slice(1)` | **Canonical** |
| 2 | `src/ui/dialogs/choose-birthsign-penalty.js` | L8 | `return string.charAt(0).toUpperCase() + string.slice(1)` | **Identical** |

### Dedup Verdict

- **Semantically identical.** #2 should import from `stringHelpers.js`.
- However, `stringHelpers.js` itself has **0 importers** — it's dead code.  #2 is the only live copy.
- To deduplicate: either #2 imports from `stringHelpers.js`, or the function is inlined and `stringHelpers.js` is deleted.

---

## 5. `_clampNumber()` — 3 Implementations (Different Signatures)

### Implementation A: Positional params

```js
function _clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
```

| File | Line |
|------|------|
| `src/ui/canvas/reach-visualizer.js` | L155 |

### Implementation B: Options object

```js
function _clampNumber(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
```

| File | Line |
|------|------|
| `src/ui/canvas/reach-visualizer-config.js` | L85 |

### Implementation C: Different name + no fallback

```js
export function clampNumber(v, { min = -200, max = 200 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
}
```

| File | Line |
|------|------|
| `src/core/skills/roll-request.js` | L27 |

### Dedup Verdict

- **All 3 differ in signature** (positional vs options object vs export defaults).
- A and B are **semantically identical** despite signature differences (same algorithm, `Math.min`/`Math.max` argument order differs but result is the same).
- C is separate (domain-specific defaults, exported, different subsystem).
- A and B could share a single private helper in `src/ui/canvas/`.

---

## Summary Table

| Helper | Copies | Identical? | Recommended Canonical |
|--------|--------|------------|----------------------|
| `_num()` | 10 | 8 identical (2 are subsets) | `src/core/magic/_primitives.js` |
| `_bool()` | 7 | 3 distinct variants | New export in `_primitives.js` |
| `_str()` | 3 | 2 identical (one already canonical) | `src/core/magic/_primitives.js` |
| `capitalizeFirstLetter()` | 2 | **Yes** | `src/utils/stringHelpers.js` |
| `_clampNumber()` | 3 | 2 identical, 1 different domain | Keep domain-local |

### Additional Duplicates Found

**`_resolveDoc` / `_resolveActor` / `_resolveToken`** — 3 copies with near-identical bodies:

| File | Line Range | Notes |
|------|------------|-------|
| `src/core/combat/opposed/helpers/docs.js` | L9-L37 | Most complete (adds `_isIsolatedDuelByTokens`, re-exports `_measureTokenDistance`) |
| `src/core/skills/opposed/docs.js` | L6-L33 | **Identical** core logic to combat version (simpler) |
| `src/core/characteristics/opposed/docs.js` | L6-L34 | **Identical** to skills version |

All 3 share the same `fromUuidSync`-based pattern. Skills and characteristics versions are perfect clones. Could be unified.
