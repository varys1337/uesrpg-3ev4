# Spells Framework Baseline Audit — T0

**Date:** 2026-02-06  
**Target:** Foundry VTT v13.351 / UESRPG 3ev4  
**Purpose:** Canonical architecture map of the current spell framework prior to T1–T6 overhaul.

---

## 1  Spell Item Schema (`template.json` → `spell`)

| Path | Type | Description |
|---|---|---|
| `system.description` | string | Free-text description |
| `system.damage` | string | Legacy damage field |
| `system.damageFormula` | string | Primary damage roll formula (e.g. `2d8`) |
| `system.damageType` | string | `none|fire|frost|shock|poison|magic|physical|healing|temporaryHealing` |
| `system.healAmount` | string | Legacy heal amount |
| `system.level` | number | Spell level 0–7 |
| `system.cost` | number | Base MP cost |
| `system.spell_str` | string | Free-text strength/attribute string |
| `system.attributes` | string | Legacy free-text attributes (parsed for duration by legacy code) |
| `system.form` | string | Spell form |
| `system.school` | string | School (`alteration|conjuration|destruction|illusion|mysticism|necromancy|restoration`) |
| `system.spellType` | string | `conventional|unconventional` |
| `system.isAttackSpell` | boolean | Spell is an attack spell (requires opposed test) |
| `system.isDamagingSpell` | boolean | Spell deals damage |
| `system.isHealingSpell` | boolean | Spell heals |
| `system.isInstant` | boolean | Spell can be cast as Secondary action |
| `system.hasUpkeep` | boolean | Spell has Upkeep attribute |
| `system.hasOverload` | boolean | Spell has Overload attribute |
| `system.overloadEffect` | string | Descriptive overload effect |
| `system.overloadBonusDamage` | string/number | Overload bonus damage (may be `"WB"`, a flat number, etc.) |
| `system.hasReinforce` | boolean | Spell has Reinforce attribute |
| `system.rangeType` | string | `""|none|ranged|melee|aoe` |
| `system.range` | string | Legacy free-text range |
| `system.aoeShape` | string | `circle|cone|rect|ray` |
| `system.aoeSize` | number | AoE radius/length in meters |
| `system.aoeWidth` | number | AoE width (for `ray`/`rect`) |
| `system.aoePulse` | boolean | AoE centered on caster |
| `system.aoeIncludeCaster` | boolean | Include caster in AoE targets |
| `system.isDirect` | boolean | Spell is Direct (no defense test) |
| `system.mindlockValue` | number | Mindlock value |
| `system.duration.value` | number | Duration value |
| `system.duration.unit` | string | `instant|rounds|minutes|hours|days|permanent` |
| `system.scaling.levels` | Array | Scaling table entries `[{level,cost,damageFormula,duration?,…}]` |

### Scaling Entry Shape
```json
{
  "level": 3,
  "cost": 12,
  "damageFormula": "3d8",
  "duration": { "value": 5, "unit": "rounds" }
}
```
Multiple legacy storage shapes exist (`system.scaling.levels`, `system.scalingLevels`, object-keyed). `magicka-utils.js:getSpellScalingLevels()` normalizes all variants into a sorted array with deduplication.

---

## 2  Casting Entrypoints (Current State)

### 2.1  UI Sheet Entry Points
| Source | Function | Route |
|---|---|---|
| Actor Sheet (`.magic-roll`, `.uesrpg-cast-magic`) | `_onCastMagicAction()` → `onCastMagicAction()` | `shared/listeners/magic-cast.js` |
| NPC Sheet (`.uesrpg-cast-magic`) | `_onCastMagicAction()` → `sharedOnCastMagicAction()` | Same shared listener |
| Spell item click on sheet | `_onSpellRoll()` | Legacy per-sheet handler (both `actor-sheet.js`, `npc-sheet.js`) |

### 2.2  Core Casting Engines (DUAL — consolidation target)
| Engine | File | Description |
|---|---|---|
| **`MagicOpposedWorkflow`** | `src/core/magic/opposed-workflow.js` | Primary. Handles `createPending()` (targeted opposed), `castDirectTargeted()` (direct), `castUnopposed()` (no target). Manages MP, AP, backfire, restraint refund, chat cards. |
| **`SpellCastingService`** | `src/core/magic/casting-service.js` | Unified API facade wrapping `MagicOpposedWorkflow`. Adds: pre-validation, spell options dialog routing, profile resolution. Routes through `_castDirect / _castOpposed / _castUnopposed` which delegate back to `MagicOpposedWorkflow`. |

### 2.3  Macro / API Entry Points
| Path | Note |
|---|---|
| `game.uesrpg.magic.cast(cfg)` | Bound to `SpellCastingService.cast()` |
| `game.uesrpg.magic.resolveProfile(spell, actor, opts)` | Returns `SpellProfile` (read-only metadata) |
| `game.uesrpg.magic.summarizeProfile(profile)` | Human-readable profile summary |

### 2.4  Consolidation Assessment
**`SpellCastingService`** was built as the single canonical entry point but currently delegates 100 % of logic to `MagicOpposedWorkflow`. The two can be merged during T1: keep `SpellCastingService.cast()` as the public API and inline or re-export `MagicOpposedWorkflow` methods as internal implementation.

The **legacy `_onSpellRoll()`** path on both sheets currently shows a dialog and does its own roll without routing through the modern pipeline. It should be eliminated or redirected through `SpellCastingService.cast()`.

---

## 3  Spell Routing & Classification

**File:** `src/core/magic/spell-routing.js`

| Function | Purpose |
|---|---|
| `classifySpellForRouting(spell)` | Returns `{isAttack, isHealing, isDirect, isTargeted, damageType}` |
| `getUserSpellTargets()` | Current user's canvas targets as stable array |
| `shouldUseTargetedSpellWorkflow(spell, targets)` | True if spell is targeted AND targets exist |
| `shouldUseModernSpellWorkflow(spell)` | Always returns `true` (all spells use modern pipeline) |

**File:** `src/core/magic/spell-profile.js`

| Function | Purpose |
|---|---|
| `resolveSpellProfile(spell, actor, opts)` | Single-source-of-truth metadata profile. Delegates to `magicka-utils`, `spell-range`, `spell-routing`. Returns composite `SpellProfile` object. |
| `summarizeSpellProfile(profile)` | Debug/UI string summary. |

---

## 4  Effect Application & AE Lifecycle

### 4.1  Primary: `applySpellEffectsToTarget()`
**File:** `src/core/magic/spell-effects.js`

- Clones spell's embedded AEs onto target with duration tracking.
- Sets standard system flags: `{ spellEffect, spellUuid, spellName, spellSchool, spellLevel, casterUuid, originalCastWorldTime, noListedDuration, hasUpkeep, upkeepCost, owner: "system", effectGroup, stackRule, source: "spell" }`.
- Implements RAW no-stacking: removes existing effects from same spell before applying.
- Removes opposing spell effects (Frenzy↔Calm, etc.).
- Creates lightweight "tracker" AE when spell has Upkeep or finite duration but no embedded AEs.
- **Duration construction:** `computeSpellDuration()` converts `{value, unit}` to `{rounds, seconds}`. Combat tracking uses `duration.combat`, `startRound`, `startTurn`. World-time tracking uses `duration.startTime` + `duration.seconds`.

### 4.2  Legacy: `applySpellEffect()`
**File:** `src/core/magic/spell-effects.js`

- Legacy function retained for backward compatibility.
- Uses `computeSpellDurationLegacy()` (parses `system.attributes` free-text for duration keywords).
- Uses `extractSpellChanges()` — currently returns `[]` (placeholder).
- **Assessment:** Dead code path — should be removed during T1.

### 4.3  Opposing Effect Pairs
Hardcoded in both `removeOpposingSpellEffects()` and `removeOpposingEffects()` (duplicate):
- Frenzy ↔ Calm
- Fortify ↔ Weakness (new function only)
- Light ↔ Darkness
- Courage ↔ Fear

**Consolidation target:** Merge into single function, deduplicate, make data-driven.

---

## 5  Spell Effect Expiration

**File:** `src/core/magic/spell-effect-expiration.js`

- **GM-only** real-time expiration for system-owned spell AEs.
- Dual-mode expiration:
  - **World-time:** `startTime + seconds ≤ nowTime`
  - **Combat:** `startRound + rounds` reaching/passing current `{round, turn}` with caster turn index matching.
- **Upkeep effects:** Disabled (not deleted) at expiry → sets `upkeepAwaiting` flag → deleted after 1-round grace window if not refreshed.
- Hooks:
  - `MagicTimekeeping.onTimeChange()` — out-of-combat expiration
  - `uesrpg.combatTimeChanged` — in-combat expiration
  - `createCombat` — refreshes combat binding markers on existing spell AEs.
- **Exported helpers:** `isEffectExpiredByWorldTime()`, `isEffectExpiredByCombat()` — reusable by other subsystems.
- **Also:** `purgeExpiredSpellEffects()` in `spell-effects.js` — aggressive out-of-combat cleanup (separate from the expiration system but overlapping in purpose).

---

## 6  Upkeep Workflow

**File:** `src/core/magic/upkeep-workflow.js` (840 lines)

- Prompts caster to refresh spell effects when they expire by paying original cost.
- **Group key:** `{casterUuid}::{spellUuid}::{originalCastWorldTime}` — prevents duplicate prompts.
- **Prompt deduplication:** Tracked on effect flags + in-memory cache with TTL.
- **Prompt lock:** Set-based lock prevents concurrent prompts for same group key.
- **Range validation:** Checks if targets are still in range for ranged/melee spells.
- **RAW restrictions enforced:**
  - No upkeep if caster cast a different spell since original cast (checked via `lastSpellCastWorldTime` flag).
  - No-duration spells treated as 1-round duration for upkeep purposes.
- **Refresh action:** Re-enables effect, resets duration markers, spends MP.
- **Combat-aware:** Upkeep prompts trigger on caster's turn; combat turn detection via combatant index lookup.
- **Initialization:** `initializeUpkeepSystem()` registers hooks for time changes and combat progression.

---

## 7  Damage / Healing Pipelines

### 7.1  Magic Damage: `applyMagicDamage()`
**File:** `src/core/magic/damage-application.js`

- Delegates to unified `applyDamage()` from `src/core/combat/damage-automation.js`.
- Pre-checks: **Spell Absorption** (trait + AE flag based, 1d10 ≤ threshold).
- RAW layered mitigation: elemental AR first, then magic AR.
- Tracks damage by type for wound side effects (Fire → Burning, Shock → MP loss, etc.).
- Supports Overload bonus, elemental talent bonuses, Master of Magicka (overcharge/double-roll).

### 7.2  Magic Healing: `applyMagicHealing()`
**File:** `src/core/magic/damage-application.js`

- Delegates to `applyHealing()` from `src/core/combat/damage-automation.js`.
- Supports temporary healing (adds to current, does not exceed max).
- Spell Absorption check (absorbed healing is negated).

### 7.3  Spell Damage Rolling: `rollSpellDamage()`, `rollSpellHealing()`
**File:** `src/core/magic/magicka-utils.js`

- `rollSpellDamage()`: evaluates damage formula, applies critical max damage override, overload bonus.
- `rollSpellHealing()`: thin wrapper around same formula lane.
- `getMaxSpellDamage()`: regex-based max-dice-value computation for critical hits.
- `computeSpellOverloadBonusDamage()`: resolves `overloadBonusDamage` from keyword/number.

---

## 8  Backfire System

**File:** `src/core/magic/backfire.js` (256 lines)

- `shouldBackfire()`: Always on critical failure. On normal failure if spell is unconventional OR level > caster's spellcasting level.
- `triggerBackfire()`: Rolls `1d4 + spellLevel` on per-school backfire table.
- **Tables:** 7 school-specific tables (alteration, conjuration, destruction, illusion, mysticism, necromancy, restoration) with 10-11 entries each.
- **Control talent:** Optional Willpower test to negate backfire.

---

## 9  Magic Modifiers (Talent Hooks)

**File:** `src/core/magic/magic-modifiers.js`

| Function | RAW Reference |
|---|---|
| `computeSpellRestraintReduction()` | Restraint WPB reduction + Magicka Cycling (+2), Creative/Methodical (+1), Stunted Magicka (halve), Critical non-damaging (double) |
| `canOverloadWhileRestrained()` | Overcharge talent |
| `computeElementalDamageBonus()` | Pyromancer (+1 fire), Cryomancer (+1 frost), Electromancer (+1 shock) |
| `canUseMasterOfMagicka()` | Master of Magicka: double cost, roll 2× keep highest |

---

## 10  Timekeeping Integration

### 10.1  Time Service
**File:** `src/core/time/time-service.js` (canonical)

- Wraps Foundry's `updateWorldTime`, `combatTurn`, `combatRound`, `combatTurnChange` hooks.
- Emits `uesrpg.timeChanged` and `uesrpg.combatTimeChanged` system hooks.
- Supports calendar adapters (Calendaria).

### 10.2  Magic Timekeeping Helper
**File:** `src/core/magic/timekeeping-helper.js` (compatibility shim)

- `MagicTimekeeping` — legacy API surface delegating to `TimeService`.
- Used by: `spell-effects.js`, `spell-effect-expiration.js`, `upkeep-workflow.js`, `magicka-utils.js`.

---

## 11  Range & AoE

**File:** `src/core/magic/spell-range.js` (643 lines)

| Function | Purpose |
|---|---|
| `getSpellRangeType(spell)` | Returns `none|ranged|melee|aoe` |
| `getSpellMaxRangeMeters(spell)` | Max range in meters (new + legacy fallbacks) |
| `getSpellAoEConfig(spell)` | `{shape, sizeMeters, widthMeters, pulse, includeCaster}` |
| `filterTargetsBySpellRange()` | Filters targets by range, emits warnings for out-of-range |
| `placeAoETemplateAndCollectTargets()` | Interactive template placement, collects tokens in area |

---

## 12  Opposed Magic Workflow (Modular Architecture)

### 12.1  Main Facade
**File:** `src/core/magic/opposed-workflow.js` (617 lines)

`MagicOpposedWorkflow` — singleton object with:
- `createPending(cfg)` — Creates chat card for targeted opposed test.
- `castDirectTargeted(cfg)` — Direct spell (no defense, casting test only).
- `castUnopposed(cfg)` — Spell with no target selected.
- `handleAction(message, action, opts)` — Dispatches to action modules.
- `_resolveOutcome(...)` — Delegates to `outcome-resolution.js`.

### 12.2  Action Modules (`src/core/magic/opposed/actions/`)
| File | Purpose |
|---|---|
| `dispatch.js` | Routes action strings to handler modules |
| `attacker.js` | Attacker roll action handler |
| `defender-commit.js` | Defender defense type commit |
| `defender-roll.js` | Defender roll action handler |
| `resolve.js` | Post-roll outcome resolution |
| `banked-roll.js` | Auto-roll when both sides committed (bank mode) |

### 12.3  Support Modules (`src/core/magic/opposed/`)
| File | Purpose |
|---|---|
| `schema.js` | State access/mutation helpers for chat message flags |
| `util.js` | UUID resolution, permission checks |
| `render.js` | Chat card HTML rendering |
| `defense-tn.js` | Evade/Block TN computation |
| `outcome-resolution.js` | Outcome determination + effect/damage application |
| `spell-helpers.js` | Spell-specific helpers (duration checks, damage sharing, blocking upkeep) |

---

## 13  Magic-Specific Casting TN

**File:** `src/core/magic/magicka-utils.js` → `computeMagicCastingTN()`

- PCs: Base TN from embedded `magicSkill` item value.
- NPCs: Base TN from `system.professions.magic`.
- Spell level penalty: `-10 × max(0, spellLevel − spellcastingLevel)`.
- Standard penalties: fatigue, carry rating, wounds.
- AE modifier keys: `system.modifiers.tests.all`, `system.modifiers.skills._all`, `system.modifiers.skills.<school>`, `system.modifiers.magic.castingTN._all`, `system.modifiers.magic.castingTN.<school>`.
- Difficulty modifier from `getDifficultyByKey()`.
- Manual modifier from options.

---

## 14  Per-School / Per-Family Logic

### 14.1  Current State
- **Backfire tables:** Per-school tables in `backfire.js` (7 schools).
- **Opposing effect pairs:** Hardcoded by spell name in `spell-effects.js`.
- **No per-school casting logic.** All schools use the same TN, cost, damage, and effect pipelines.
- **No conventional spell family implementations** (e.g., "Ward" variants, "Cloak" variants).

### 14.2  Attack-Tag Spells → Attack Tracker
- `classifySpellForRouting(spell).isAttack` gates attack tracking.
- `AttackTracker.incrementAttacks(actor)` called in `castUnopposed()` and (via action handlers) in the opposed workflow.
- **Gap:** Not consistently called across all three casting paths — only `castUnopposed()` explicitly calls it. `createPending()` and `castDirectTargeted()` rely on action modules to handle this.

---

## 15  Identified Gaps & Consolidation Targets

### 15.1  Duplicate Casting Engines
- `SpellCastingService.cast()` wraps `MagicOpposedWorkflow` methods but adds validation and dialog logic.
- **Target:** Merge into single engine. `SpellCastingService` becomes the single public API; `MagicOpposedWorkflow` becomes internal implementation.

### 15.2  Legacy `_onSpellRoll()` Path
- Actor + NPC sheets both have `_onSpellRoll()` which does NOT route through the modern pipeline.
- **Target:** Redirect to `SpellCastingService.cast()` or eliminate.

### 15.3  Duplicate AE Application Functions
- `applySpellEffectsToTarget()` (primary, modern) vs `applySpellEffect()` (legacy, returns `[]` changes).
- `removeOpposingSpellEffects()` vs `removeOpposingEffects()` — duplicate logic.
- **Target:** Remove legacy functions.

### 15.4  Missing Origin AE Pattern
- Current system clones spell AEs directly onto targets with flags linking back to caster/spell.
- **No Origin AE** on the caster that tracks all linked target AEs / templates / summons.
- **Impact:** Teardown is not deterministic — removing a spell from the caster does not clean target AEs.
- **Target (T1):** Implement Origin AE lifecycle.

### 15.5  No System Hooks for Spell Lifecycle
- No `uesrpg.spell.preCast`, `.castResolved`, `.effectApplied`, `.ended` hooks.
- **Target (T1):** Add extensibility hooks at key pipeline stages.

### 15.6  Missing Upkeep Contract Formalization
- Upkeep is implemented but lacks a formal "contract" object linking caster ↔ target ↔ cost ↔ scaling choices.
- **Target (T2):** Formalize upkeep contract.

### 15.7  No Spell Zones / Summons Lifecycle
- AoE template placement exists (`placeAoETemplateAndCollectTargets`) but templates are not linked to spell AEs.
- No summon lifecycle management.
- **Target (T2).**

### 15.8  No OverTime Effects Engine
- No DAE/Midi-style tick engine for periodic effects (DoT, HoT).
- **Target (T4).**

### 15.9  Attack Tracker Inconsistency
- Not consistently called across all casting paths.
- **Target (T1):** Centralize in `SpellCastingService.cast()`.

### 15.10  `purgeExpiredSpellEffects()` Overlap
- In `spell-effects.js`, overlaps with `spell-effect-expiration.js`.
- **Target:** Consolidate into single expiration system.

---

## 16  Canonical Service Paths (T1+ Implementation Targets)

| Service | Current Location | T1+ Role |
|---|---|---|
| `SpellCastingService.cast()` | `casting-service.js` | **Single public cast API** — preflight, dialog, routing, hooks |
| `MagicOpposedWorkflow` | `opposed-workflow.js` | **Internal** — opposed/direct/unopposed implementation |
| `resolveSpellProfile()` | `spell-profile.js` | **Single metadata reader** — no changes needed |
| `applySpellEffectsToTarget()` | `spell-effects.js` | **Primary effect applicator** — extend with Origin AE |
| `computeMagicCastingTN()` | `magicka-utils.js` | **TN computation** — no changes needed |
| `initializeSpellEffectExpirationSystem()` | `spell-effect-expiration.js` | **Expiration engine** — integrate `purgeExpiredSpellEffects` |
| `initializeUpkeepSystem()` | `upkeep-workflow.js` | **Upkeep prompts** — formalize contract in T2 |
| `MagicTimekeeping` / `TimeService` | `timekeeping-helper.js` / `time-service.js` | **Time integration** — no changes needed |
| `applyMagicDamage()` / `applyMagicHealing()` | `damage-application.js` | **Damage/heal pipeline** — no changes needed |
| `shouldBackfire()` / `triggerBackfire()` | `backfire.js` | **Backfire engine** — no changes needed |

---

## 17  Dependency Map (Simplified)

```
UI Sheets ──►  shared/listeners/magic-cast.js  ──►  spell-routing.js
                                                 │   spell-range.js
                                                 │   spell-profile.js
                                                 └──►  MagicOpposedWorkflow
                                                       ├── magicka-utils.js
                                                       ├── backfire.js
                                                       ├── spell-effects.js
                                                       ├── opposed/actions/*
                                                       ├── opposed/schema.js
                                                       ├── opposed/render.js
                                                       ├── opposed/defense-tn.js
                                                       └── opposed/outcome-resolution.js

SpellCastingService ──► spell-profile.js
                        magicka-utils.js
                        MagicOpposedWorkflow
                        shared/listeners/magic-cast.js (dialog)

spell-effect-expiration.js ──► timekeeping-helper.js ──► time-service.js
upkeep-workflow.js ──► timekeeping-helper.js
                       spell-range.js
                       attack-tracker.js

damage-application.js ──► combat/damage-automation.js
                          traits/trait-registry.js
```

---

## 18  Conclusion

The spell framework is **functionally mature** with well-separated concerns but has:
1. **Two casting engines** (`SpellCastingService` + `MagicOpposedWorkflow`) that should be unified.
2. **Dead legacy code** (`applySpellEffect`, `_onSpellRoll` bypass) that should be removed.
3. **No Origin AE lifecycle** — the critical missing piece for deterministic teardown.
4. **No system hooks** — needed for extensibility.
5. **No OverTime tick engine** — needed for DoT/HoT spell families.

T1 should consolidate the casting engine, add Origin AE lifecycle, and emit system hooks. Subsequent tasks (T2–T6) build on this foundation.
