# Rule Elements System — Comprehensive GM/User Guide

> **System**: UESRPG 3ev4 for Foundry VTT v13  
> **Source Files**: `src/core/traits/features/rule-element-runtime.js`, `src/core/traits/features/rule-elements.js`, `src/core/rules/predicate.js`, `src/core/rules/roll-options.js`, `src/core/rules/phases.js`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Rule Element Object Structure](#2-rule-element-object-structure)
3. [The 13 Rule Element Handler Types](#3-the-13-rule-element-handler-types)
4. [Runtime Phases](#4-runtime-phases)
5. [Runtime Support Matrix](#5-runtime-support-matrix)
6. [Roll Options](#6-roll-options)
7. [Predicate System](#7-predicate-system)
8. [Condition System](#8-condition-system)
9. [Feature Config & Global Settings](#9-feature-config--global-settings)
10. [Workflow Runtime Settings](#10-workflow-runtime-settings)
11. [UI: Creating & Managing Rule Elements](#11-ui-creating--managing-rule-elements)
12. [Interceptor vs Rule Element Deduplication](#12-interceptor-vs-rule-element-deduplication)
13. [Debug & Self-Test Utilities](#13-debug--self-test-utilities)
14. [Cross-References](#14-cross-references)

---

## 1. Overview

Rule Elements (REs) are PF2e-inspired configurable automation building blocks. Each RE describes a single automation effect — a modifier, a flag, a DoS adjustment, a reroll grant, etc. — with optional condition gates and predicates.

REs are stored as a flat array in item flags at:
```
flags.uesrpg-3ev4.ruleElements
```

**Only these item types support Rule Elements:** `trait`, `talent`, `power`

REs are evaluated at runtime during staged roll workflows (skill opposed, characteristic opposed, combat opposed, magic opposed) by `evaluateRuleElementsRuntime()`.

---

## 2. Rule Element Object Structure

Every Rule Element has these core properties:

| Property | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | Random 16-char ID | Unique identifier (auto-generated via `foundry.utils.randomID(16)`) |
| `type` | `string` | `"note"` | Handler type key (one of 13 types) |
| `label` | `string` | Type label | Human-readable label |
| `enabled` | `boolean` | `true` | Master enable toggle |
| `conditions` | `Array<object>` | `[]` | Array of condition objects (AND logic — all must pass) |
| `workflows` | `Array<string>` | `["all"]` | Workflow scope filter. Values: `"all"`, `"skill"`, `"characteristic"`, `"combat"`, `"magic"` |
| `predicate` | `string\|Array\|object\|null` | `null` | Roll-option predicate (JSON). `null` = always true |

Plus type-specific fields (see Section 3).

### Full JSON Example
```json
{
  "id": "abc123def456ghij",
  "type": "tnModifier",
  "label": "Precise: No Precision Strike Penalty",
  "enabled": true,
  "conditions": [
    { "type": "attackVariant", "variant": "precision" }
  ],
  "workflows": ["combat"],
  "predicate": null,
  "value": 20,
  "appliesTo": "attacker",
  "skillName": ""
}
```

---

## 3. The 13 Rule Element Handler Types

### 3.1 Passive / Always-On (Phase: `actorPrep`)

These run during actor data preparation. They modify persistent actor stats.

---

#### `flatModifier`
**Family:** Passive  
**Icon:** `fa-plus-minus`  
**Description:** Adds a numeric bonus or penalty to a target stat, resistance, or characteristic.

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `target` | select | `"system.hpBonus"` | Target path on the actor |
| `value` | number | `0` | Numeric bonus/penalty |
| `stacking` | select | `"add"` | Stacking rule: `add`, `highest`, `none`, `any` |

**Target Options:**
| Value | Label |
|---|---|
| `system.hpBonus` | Hit Points (HP+) |
| `system.spBonus` | Stamina (SP+) |
| `system.mpBonus` | Magicka (MP+) |
| `system.lpBonus` | Luck Points (LP+) |
| `system.wtBonus` | Wound Threshold (WT+) |
| `system.iniBonus` | Initiative (INI+) |
| `system.speedBonus` | Speed+ |
| `system.swimBonus` | Swim Speed+ |
| `system.flyBonus` | Fly Speed+ |
| `system.diseaseR` | Disease Resistance |
| `system.fireR` | Fire Resistance |
| `system.frostR` | Frost Resistance |
| `system.shockR` | Shock Resistance |
| `system.poisonR` | Poison Resistance |
| `system.magicR` | Magic Resistance |
| `system.natToughnessR` | Natural Toughness |
| `system.silverR` | Silver Resistance |
| `system.sunlightR` | Sunlight Resistance |
| `system.characteristicBonus.strChaBonus` | Characteristic: STR |
| `system.characteristicBonus.endChaBonus` | Characteristic: END |
| `system.characteristicBonus.agiChaBonus` | Characteristic: AGI |
| `system.characteristicBonus.intChaBonus` | Characteristic: INT |
| `system.characteristicBonus.wpChaBonus` | Characteristic: WP |
| `system.characteristicBonus.prcChaBonus` | Characteristic: PRC |
| `system.characteristicBonus.prsChaBonus` | Characteristic: PRS |
| `system.characteristicBonus.lckChaBonus` | Characteristic: LCK |

**Runtime Behavior:** Pushes `{ type: "flatModifier", target, value, stacking }` into `output.passiveMods[]`. Returns `false` (skips) if `value` is 0.

---

#### `booleanFlag`
**Family:** Passive  
**Icon:** `fa-toggle-on`  
**Description:** Sets a boolean flag on the actor (e.g., ½ Fatigue Penalty, Double Swim Speed).

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `target` | select | `"system.halfFatiguePenalty"` | Flag path on the actor |
| `value` | checkbox | `true` | Active state |

**Flag Target Options:**
| Value | Label |
|---|---|
| `system.halfFatiguePenalty` | ½ Fatigue Penalty |
| `system.halfWoundPenalty` | ½ Wound Penalty |
| `system.addHalfSpeed` | Add ½ Speed |
| `system.doubleSwimSpeed` | Double Swim Speed |
| `system.untrainedException` | No Untrained Combat Penalty |
| `system.halfSpeed` | ½ Speed |
| `system.mechanical` | Define as Mechanical |
| `system.painIntolerant` | Wound Penalty to -30 (Pain Intolerant) |
| `system.addIBToMP` | Add IB to Magicka |

**Runtime Behavior:** Pushes `{ type: "booleanFlag", target, value: true/false }` into `output.passiveMods[]`. Always applies (returns `true`).

---

#### `overrideValue`
**Family:** Passive  
**Icon:** `fa-arrows-rotate`  
**Description:** Overrides a derived value — e.g., replace Initiative characteristic or WT calculation.

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `target` | select | `"system.replace.ini.characteristic"` | Override target path |
| `characteristic` | select | `""` | Set to this characteristic |

**Override Target Options:**
| Value | Label |
|---|---|
| `system.replace.ini.characteristic` | Replace Initiative Characteristic |
| `system.replace.wt.characteristic` | Replace Wound Threshold Characteristic |

**Characteristic Options:** `str`, `end`, `agi`, `int`, `wp`, `prc`, `prs`, `lck`

**Runtime Behavior:** Pushes `{ type: "overrideValue", target, characteristic }` into `output.passiveMods[]`. Returns `false` if no characteristic is specified.

---

#### `senseLossReduction`
**Family:** Passive  
**Icon:** `fa-ear-listen`  
**Description:** Reduces or negates penalties from sense loss conditions like Blinded or Deafened (e.g., Honed Senses halves, One with All negates).

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `mode` | select | `"halve"` | Reduction mode |

**Mode Options:**
| Value | Label |
|---|---|
| `halve` | Halve Penalty |
| `negate` | Negate Penalty |

**Runtime Behavior:** Pushes `{ type: "senseLossReduction", mode }` into `output.passiveMods[]`. Always applies.

---

### 3.2 Combat / Workflow Types

---

#### `tnModifier`
**Family:** Combat  
**Phase:** `preRoll`  
**Icon:** `fa-bullseye`  
**Description:** Applies a bonus or penalty to Test Target Numbers (e.g., Precise +20 attacker TN, Lightning Reflexes -20 defender TN).

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `value` | number | `0` | TN modifier amount |
| `appliesTo` | select | `"attacker"` | Who this applies to |
| `skillName` | text | `""` | Skill name (required when `appliesTo` = `"skill"`) |

**Applies-To Options:**
| Value | Label |
|---|---|
| `attacker` | Attacker (Self) |
| `defender` | Defender (Enemy) |
| `skill` | Skill Test |

**Runtime Behavior:** 
- Gates by side context: if `appliesTo` is `"attacker"` or `"defender"`, checks `context.side === appliesTo`. If `"skill"`, checks test type is `"skill"` AND skill name matches.
- Adds `value` to `output.tnDelta`.
- Returns `false` if `value` is 0 or gate fails.

---

#### `dosBonus`
**Family:** Combat  
**Phase:** `postRoll`  
**Icon:** `fa-arrow-up-1-9`  
**Description:** Adds bonus Degrees of Success on a successful combat or skill test (e.g., Brawler +1 DoS with 2+ opponents).

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `bonus` | number | `1` | DoS bonus amount |
| `testType` | select | `"combatStyle"` | Which test types qualify |
| `skillName` | text | `""` | Skill name (required when `testType` = `"skill"`) |

**Test Type Options:**
| Value | Label |
|---|---|
| `combatStyle` | Combat Style |
| `skill` | Specific Skill |
| `any` | Any Test |

**Runtime Behavior:**
- **Only fires on successful rolls** (`result.isSuccess === true`).
- Gates by test type: `"any"` passes all; `"combatStyle"` requires attack or combat workflow; `"skill"` requires skill test + skill name match.
- Adds `bonus` to `output.dosDelta`.
- Returns `false` if gate fails, bonus is 0, or roll was not successful.

---

#### `dosReplacement`
**Family:** Combat  
**Phase:** `postRoll`  
**Icon:** `fa-scale-balanced`  
**Description:** After a successful test, offers a choice: keep rolled DoS or use a skill rank instead (e.g., Champion, Tricky Fighter).

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `useRankOf` | select | `"combatStyle"` | Source for replacement DoS |
| `skillName` | text | `""` | Skill name (required when `useRankOf` = `"skill"`) |

**Rank Source Options:**
| Value | Label |
|---|---|
| `combatStyle` | Combat Style Rank |
| `skill` | Specific Skill Rank |

**Runtime Behavior:**
- **Only fires on successful rolls** (`result.isSuccess === true`).
- Resolves rank from either Combat Style (`_resolveRankFromCombatStyle`) or a named skill (`_resolveRankFromSkill`).
- Compares current DoS to resolved rank. If rank > current, pushes a **pending replacement** to `output.pendingDosReplacements[]`.
- Does NOT auto-apply — `applyRuntimePostRollToResult()` presents a player prompt (respecting player agency per RAW) asking to choose between rolled DoS or rank DoS.
- The prompt dialog offers "Use Rolled (X)" or "Use [Source] Rank (Y)".

---

#### `damageBonus`
**Family:** Combat  
**Phase:** `preDamage`  
**Icon:** `fa-burst`  
**Description:** Adds bonus damage to attacks. Can specify type and whether it ignores AR (e.g., Sneak Attack, Cryomancer +1 frost).

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `formula` | text | `""` | Roll formula (e.g., `@stealth.rank`) |
| `flatValue` | number | `0` | Flat bonus (used if formula is empty) |
| `damageType` | select | `"physical"` | Damage type |
| `ignoresAR` | checkbox | `false` | Whether this damage ignores Armor Rating |

**Damage Type Options:** `physical`, `fire`, `frost`, `shock`, `poison`, `magic`, `silver`, `sunlight`, `untyped`

**Runtime Behavior:**
- **Only evaluates in `combat` or `magic` workflows.**
- Resolves value from formula first (using `Roll.replaceFormulaData` + `Roll.safeEval` with actor roll data), falls back to `flatValue`.
- Pushes `{ value, damageType, ignoresAR }` to `output.damageBonus[]`.
- Returns `false` if resolved value is 0 or wrong workflow.

---

#### `wtDelta`
**Family:** Combat  
**Phase:** `preDamage`  
**Icon:** `fa-heart-crack`  
**Description:** Modifies the effective Wound Threshold of attacked enemies (e.g., Crippling Strikes WT−1).

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `delta` | number | `-1` | WT change amount |

**Runtime Behavior:**
- **Only evaluates in `combat` or `magic` workflows.**
- Adds `delta` to `output.wtDelta`.
- Returns `false` if delta is 0 or wrong workflow.

---

#### `defenseOverride`
**Family:** Combat  
**Phase:** `preRoll`  
**Icon:** `fa-shield-halved`  
**Description:** Unlocks or modifies defense options normally unavailable (e.g., Lightning Reflexes: Parry vs Ranged at −20).

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `allow` | select | `"parry"` | Defense type to allow |
| `against` | select | `"ranged"` | Attack mode this applies against |
| `tnMod` | number | `0` | TN modifier for the allowed defense |

**Defense Type Options:** `parry`, `evade`, `block`, `counter`  
**Attack Mode Options:** `melee`, `ranged`, `aoe`, `any`

**Runtime Behavior:**
- If `against` is not `"any"` and doesn't match the current attack mode, returns `false`.
- Pushes `{ allow, against, tnMod }` to `output.defenseOverrides[]`.

---

#### `rerollEligibility`
**Family:** Combat  
**Phase:** `postRoll`  
**Icon:** `fa-dice`  
**Description:** Allows a single reroll of a failed test (e.g., Grandmaster for a specific skill, Die-Hard for Endurance).

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `scope` | select | `"specific"` | Reroll scope |
| `skillName` | text | `""` | Skill name (required when scope = `"specific"`) |
| `maxUses` | number | `1` | Max rerolls per test |

**Scope Options:**
| Value | Label |
|---|---|
| `specific` | Specific Skill |
| `any` | Any Skill |
| `endurance` | Endurance Only |
| `willpower` | Willpower Only |

**Runtime Behavior:**
- Gates by scope: `"any"` passes all; `"specific"` matches skill name; `"endurance"` checks `characteristicKey === "end"`; `"willpower"` checks `characteristicKey === "wp"`.
- Pushes `{ scope, skillName, maxUses }` to `output.rerollGrants[]`.

---

### 3.3 Magic Types

---

#### `spellModifier`
**Family:** Magic  
**Phase:** `preRoll`  
**Workflows:** `magic` only  
**Icon:** `fa-hat-wizard`  
**Description:** Modifies spell casting parameters — restraint WB, cost, effect values (e.g., Creative +1 WB, Mage Guard +1 Reinforce).

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `restraintWbDelta` | number | `0` | Restraint Willpower Bonus delta |
| `effectDelta` | number | `0` | Spell effect value delta |
| `costDelta` | number | `0` | MP cost delta |
| `spellSchool` | select | `"any"` | Spell school filter |
| `spellCategory` | select | `"any"` | Spell category filter |

**Spell School Options:** `any`, `alteration`, `conjuration`, `destruction`, `illusion`, `mysticism`, `necromancy`, `restoration`  
**Spell Category Options:** `any`, `conventional`, `unconventional`

**Runtime Behavior:**
- **Only evaluates in `magic` workflow.**
- Accumulates deltas into `output.spellModifiers.restraintWbDelta`, `.effectDelta`, `.costDelta`.
- Returns `false` if all three deltas are 0.

---

### 3.4 General / Informational

---

#### `note`
**Family:** General  
**Phase:** None (informational — does not participate in phased evaluation)  
**Icon:** `fa-note-sticky`  
**Description:** Attach a descriptive note to document non-automated effects or homebrew behavior.

**Fields:**
| Field | Type | Default | Description |
|---|---|---|---|
| `text` | text | `""` | Note text content |

**Runtime Behavior:**
- Pushes `{ text }` to `output.informational[]`.
- Returns `false` if text is empty.
- Status is `"informational"` — it's never gated by phase or workflow.

---

## 4. Runtime Phases

Phases are defined in `src/core/rules/phases.js`:

| Phase Constant | String Value | Description |
|---|---|---|
| `RULE_PHASES.ACTOR_PREP` | `"actorPrep"` | Actor data preparation (passive effects) |
| `RULE_PHASES.PRE_ROLL` | `"preRoll"` | Before the roll is made (TN modifiers, defense overrides) |
| `RULE_PHASES.POST_ROLL` | `"postRoll"` | After the roll result is known (DoS bonuses, replacements, rerolls) |
| `RULE_PHASES.PRE_DAMAGE` | `"preDamage"` | Before damage is applied (damage bonuses, WT deltas) |
| `RULE_PHASES.POST_DAMAGE` | `"postDamage"` | After damage is applied (currently no handlers use this) |

**Phase Aliases** — these are all normalized to canonical values:

| Input | Normalizes To |
|---|---|
| `"actorprep"`, `"actor-prep"` | `"actorPrep"` |
| `"pre_roll"`, `"preroll"`, `"pre-roll"` | `"preRoll"` |
| `"post_roll"`, `"postroll"`, `"post-roll"` | `"postRoll"` |
| `"pre_damage"`, `"predamage"`, `"pre-damage"` | `"preDamage"` |
| `"post_damage"`, `"postdamage"`, `"post-damage"` | `"postDamage"` |

---

## 5. Runtime Support Matrix

Each handler type has a support entry defining its status, valid phases, and valid workflows:

| Type | Status | Phase(s) | Workflows |
|---|---|---|---|
| `flatModifier` | `active` | `actorPrep` | `all` |
| `booleanFlag` | `active` | `actorPrep` | `all` |
| `overrideValue` | `active` | `actorPrep` | `all` |
| `senseLossReduction` | `active` | `actorPrep` | `all` |
| `tnModifier` | `active` | `preRoll` | `all` |
| `dosBonus` | `active` | `postRoll` | `all` |
| `dosReplacement` | `active` | `postRoll` | `all` |
| `damageBonus` | `active` | `preDamage` | `combat`, `magic` |
| `wtDelta` | `active` | `preDamage` | `combat`, `magic` |
| `defenseOverride` | `active` | `preRoll` | `combat`, `magic` |
| `rerollEligibility` | `active` | `postRoll` | `all` |
| `spellModifier` | `active` | `preRoll` | `magic` |
| `note` | `informational` | *(none)* | `all` |

**Status values:**
- `active` — Handler exists and runs at runtime
- `informational` — Display-only; skips phase/workflow gating entirely
- `planned` — Future implementation (not currently used by any built-in type)

---

## 6. Roll Options

Roll options are the string tokens that predicates evaluate against. They are built by `buildBaseRollOptions()` in `src/core/rules/roll-options.js` and augmented by the runtime.

### 6.1 Roll Option Format

All roll options are normalized: lowercase, spaces → hyphens, non-alphanumeric characters (except `:`, `_`, `-`) stripped.

### 6.2 Roll Option Prefixes

#### Test Context
| Prefix | Format | Source |
|---|---|---|
| `test:type:` | `test:type:<slug>` | Test type: `skill`, `characteristic`, `attack`, `spell` |
| `test:skill:` | `test:skill:<slug>` | Skill name slug (e.g., `test:skill:stealth`, `test:skill:observe`) |
| `test:char:` | `test:char:<key>` | Characteristic key (e.g., `test:char:str`, `test:char:wp`) |
| `test:label:` | `test:label:<slug>` | Test label slug (freeform label from the workflow) |

#### Attack/Defense Context
| Prefix | Format | Source |
|---|---|---|
| `attack:mode:` | `attack:mode:<slug>` | Attack mode: `melee`, `ranged`, `aoe` |
| `attack:variant:` | `attack:variant:<slug>` | Attack variant: `standard`, `precision` |
| `defense:type:` | `defense:type:<slug>` | Defense type: `parry`, `evade`, `block`, `counter` |

#### State
| Prefix | Format | Source |
|---|---|---|
| `state:incombat` | `state:incombat` | Actor is in active combat (checked via `game.combat.started` + combatant lookup) |
| `state:hidden` | `state:hidden` | Actor is hidden (condition, status effect, or `system.traits.condition.hidden`) |

#### Workflow Context (added by runtime)
| Prefix | Format | Source |
|---|---|---|
| `side:` | `side:<slug>` | Workflow side: `attacker`, `defender` |
| `workflow:` | `workflow:<slug>` | Workflow type: `skill`, `characteristic`, `combat`, `magic` |
| `phase:` | `phase:<slug>` | Current phase: `preroll`, `postroll`, `predamage`, etc. |

#### Identity (diagnostic/future use)
| Prefix | Format | Source |
|---|---|---|
| `actor:` | `actor:<uuid-slug>` | Actor UUID, slugified |
| `target:` | `target:<uuid-slug>` | Target actor UUID, slugified |
| `item:` | `item:<uuid-slug>` | Item UUID, slugified |

### 6.3 Complete Roll Option Examples

```
test:type:attack
test:type:skill
test:skill:stealth
test:char:agi
attack:mode:melee
attack:mode:ranged
attack:variant:precision
defense:type:parry
defense:type:evade
state:incombat
state:hidden
side:attacker
side:defender
workflow:combat
workflow:magic
workflow:skill
phase:preroll
phase:postroll
```

### 6.4 Additional Roll Options from Context

The runtime also merges:
- `rollContext.rollOptions` — any options from the roll context object
- `rollOptions` parameter — any options passed directly by the caller

---

## 7. Predicate System

Predicates gate when a Rule Element fires. They are evaluated by `evaluatePredicate()` in `src/core/rules/predicate.js`.

### 7.1 Predicate Shapes

| Shape | Meaning | Example |
|---|---|---|
| `null` / `undefined` / `[]` | Always true | `null` |
| `"option:string"` | Single option presence check | `"attack:mode:melee"` |
| `["a", "b"]` | AND — all must be present | `["state:incombat", "attack:mode:melee"]` |
| `{and: [...]}` | Explicit AND | `{and: ["a", "b"]}` |
| `{or: [...]}` | OR — at least one must be present | `{or: ["attack:mode:melee", "attack:mode:ranged"]}` |
| `{not: ...}` | NOT — inner must be false | `{not: "state:hidden"}` |
| `{nor: [...]}` | NOR — none must be present | `{nor: ["a", "b"]}` |
| `{nand: [...]}` | NAND — not all present | `{nand: ["a", "b"]}` |

### 7.2 Evaluation Rules

- **Empty/null predicate** → always `true`
- **String** → checks if the normalized option exists in the roll options set
- **Array** → treated as AND group: every element must evaluate `true`
- **Object with single key** → logical operator (`and`, `or`, `not`, `nor`, `nand`)
- **Objects must have exactly one key** — multiple keys are invalid
- **Max recursion depth**: 32 levels
- **Invalid predicates evaluate as `false`** (with debug logging)

### 7.3 Operator Truth Tables

| Operator | Result |
|---|---|
| `{and: [A, B]}` | `true` if ALL children are `true` |
| `{or: [A, B]}` | `true` if ANY child is `true` |
| `{not: A}` | `true` if A is `false` |
| `{nor: [A, B]}` | `true` if NO children are `true` (= NOT OR) |
| `{nand: [A, B]}` | `true` if NOT ALL children are `true` (= NOT AND) |

### 7.4 Predicate Examples

**"Only when attacking in melee":**
```json
"attack:mode:melee"
```

**"Only when in combat AND using a precision attack":**
```json
["state:incombat", "attack:variant:precision"]
```

**"Only when attack mode is melee OR ranged (not AoE)":**
```json
{"or": ["attack:mode:melee", "attack:mode:ranged"]}
```

**"Only when NOT hidden":**
```json
{"not": "state:hidden"}
```

**"Only on skill tests for Stealth or Deceive":**
```json
{"or": ["test:skill:stealth", "test:skill:deceive"]}
```

**"Complex: in combat AND (melee OR ranged) AND not hidden":**
```json
["state:incombat", {"or": ["attack:mode:melee", "attack:mode:ranged"]}, {"not": "state:hidden"}]
```

**"On the attacker side during combat workflow":**
```json
["side:attacker", "workflow:combat"]
```

### 7.5 Self-Test

Available at runtime:
```js
game.uesrpg.rules.predicate.selfTest()
```
Returns `{total, passed, failed, results}`.

---

## 8. Condition System

Conditions are an alternative to raw predicates. They provide a structured, UI-friendly way to gate Rule Elements. Conditions are stored in the RE's `conditions[]` array. **All conditions use AND logic** — every condition must pass.

At runtime, conditions are compiled to predicates (where possible) by `compileConditionsToPredicate()`. Conditions that can't be compiled to predicates become "residual conditions" evaluated separately.

### 8.1 Condition Types

#### `attackMode`
**Label:** Attack Mode  
**Icon:** `fa-sword`  
**Fields:** `mode` (select: `melee`, `ranged`, `aoe`, `any`)  
**Compiled To:** `attack:mode:<mode>` predicate

#### `attackVariant`
**Label:** Attack Variant  
**Icon:** `fa-crosshairs`  
**Fields:** `variant` (select: `standard`, `precision`)  
**Compiled To:** `attack:variant:<variant>` predicate

#### `hidden`
**Label:** Actor is Hidden  
**Icon:** `fa-eye-slash`  
**Fields:** *(none)*  
**Compiled To:** `state:hidden` predicate

#### `inCombat`
**Label:** In Active Combat  
**Icon:** `fa-swords`  
**Fields:** *(none)*  
**Compiled To:** `state:incombat` predicate

#### `skillTest`
**Label:** Specific Skill Test  
**Icon:** `fa-graduation-cap`  
**Fields:** `skillName` (text)  
**Compiled To:** `test:skill:<slug>` predicate

#### `weaponType`
**Label:** Weapon Type Equipped  
**Icon:** `fa-shield`  
**Fields:** `mode` (select: `melee`, `ranged`, `aoe`, `any`)  
**Compiled To:** `attack:mode:<mode>` predicate (reuses attack mode until dedicated taxonomy exists)

#### `proximity` ⚠️ Residual
**Label:** Proximity (Opponents in Range)  
**Icon:** `fa-users`  
**Fields:**
| Field | Type | Options |
|---|---|---|
| `operator` | select | `>=` (at least), `==` (exactly), `<=` (at most), `>` (more than), `<` (fewer than) |
| `value` | number | Count of opponents |
| `range` | select | `melee` (2m), `close` (10m), `medium` (25m), `any` (∞) |

**Cannot be compiled to predicate.** Evaluated at runtime as a residual condition using canvas token distance measurement. Requires the actor to have an active token on the canvas.

**Range Resolution:** `melee` = actor's melee reach (default 2m), `close` = 10m, `medium` = 25m, `any` = ∞

#### `allyHasTalent` ⚠️ Residual
**Label:** Ally Has Talent (in Range)  
**Icon:** `fa-handshake`  
**Fields:**
| Field | Type |
|---|---|
| `talentName` | text |
| `range` | select (same as proximity) |

**Cannot be compiled to predicate.** Evaluated at runtime by checking all canvas tokens with same disposition within range of the target for the named talent. Requires both actor and target tokens on canvas.

### 8.2 Condition + Predicate Interaction

A Rule Element can have BOTH `conditions[]` AND a `predicate`. At runtime:
1. Conditions are compiled to predicate terms where possible
2. Compiled predicate is AND-merged with the explicit `predicate`
3. Residual conditions are evaluated separately after predicate passes

Effectively: `(compiled_conditions AND explicit_predicate) AND residual_conditions`

---

## 9. Feature Config & Global Settings

Each trait/talent/power item has a per-item Feature Configuration stored at:
```
flags.uesrpg-3ev4.featureConfig
```

### 9.1 Feature Config Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Master enable toggle — when false, feature is completely inert |
| `applyMode` | string | `"auto"` | `"auto"` (immediate), `"confirm"` (dialog first), `"manual"` (require explicit Use) |
| `promptMode` | string | `"owner"` | `"owner"`, `"gm"`, `"both"`, `"never"` |
| `combatOnly` | boolean | `false` | Only activate during active combat |
| `outOfCombatAllowed` | boolean | `true` | May be used outside combat |
| `stackingOverride` | string | `"default"` | `"default"`, `"none"`, `"highest"`, `"add"`, `"any"` |
| `targetPolicy` | string | `"self"` | `"self"`, `"single"`, `"multi"`, `"template"`, `"ask"` |
| `visibility` | string | `"all"` | `"all"`, `"gmOnly"` |
| `debug.showInInspector` | boolean | `true` | Show in Feature Inspector panel |

### 9.2 Capability-Driven UI

Which config controls appear depends on item type:

| Capability | trait | talent | power |
|---|---|---|---|
| Core controls (enabled, applyMode, promptMode) | ✓ | ✓ | ✓ |
| Combat context (combatOnly, outOfCombatAllowed) | ✓ | ✓ | ✓ |
| Stacking override | ✓ | ✗ | ✗ |
| Target policy | ✗ | ✗ | ✓ |
| Visibility | ✓ | ✓ | ✓ |
| Debug | ✓ | ✓ | ✓ |

---

## 10. Workflow Runtime Settings

Located in the Debug Settings menu (GM-only gear icon). All are `scope: "world"`, `config: false`, `type: Boolean`.

### 10.1 Setting Keys

| Setting Key | Default | Label | Description |
|---|---|---|---|
| `enableRuleElementsRuntime` | `true` | Rule Elements Runtime (Experimental) | **Master switch.** Global gate for all RE runtime evaluation. When off, all RE automation is suppressed. |
| `enableRuleElementsRuntimeSkill` | `true` | Rule Elements Runtime: Skill Opposed | Enable RE runtime for skill opposed workflows |
| `enableRuleElementsRuntimeCharacteristic` | `true` | Rule Elements Runtime: Characteristic Opposed | Enable RE runtime for characteristic opposed workflows |
| `enableRuleElementsRuntimeCombat` | `true` | Rule Elements Runtime: Combat Opposed | Enable RE runtime for combat opposed workflows. Talents with configured REs use them instead of hardcoded interceptors. |
| `enableRuleElementsRuntimeMagic` | `true` | Rule Elements Runtime: Magic Opposed | Enable RE runtime for magic workflows. Spellcasting talents with configured REs use them instead of hardcoded interceptors. |
| `ruleElementDebug` | `false` | Rule Elements: Debug Logging | Log predicate and runtime evaluation diagnostics to browser console |

### 10.2 Internal Migration Markers

| Setting Key | Purpose |
|---|---|
| `ruleElementsRuntimeWorkflowMigrated` | V2 migration: Split master setting into per-workflow settings |
| `ruleElementsRuntimeV3Migrated` | V3 migration: Auto-enabled combat + magic workflows |

### 10.3 Accessing Settings

**Programmatically:**
```js
game.settings.get("uesrpg-3ev4", "enableRuleElementsRuntime")
game.settings.get("uesrpg-3ev4", "enableRuleElementsRuntimeCombat")
```

**Via helper:**
```js
import { getRuleElementRuntimeSettingsState } from "./rule-element-runtime.js";
const state = getRuleElementRuntimeSettingsState();
// state = { master: true, workflows: { skill: true, characteristic: true, combat: true, magic: true }, enabled: { skill: true, ... } }
```

**Runtime is enabled when:** `master === true AND workflows[workflowKey] === true`

### 10.4 Debug Settings Template Location

The Debug Settings panel that exposes these checkboxes is rendered from:
```
templates/dev/debug-settings.hbs
```

The settings appear under the **"Rule Elements Runtime (GM)"** fieldset.

---

## 11. UI: Creating & Managing Rule Elements

### 11.1 Where to Find the UI

The Automation tab appears on item sheets for **trait**, **talent**, and **power** items. Look for the **"Automation"** tab in the item sheet nav bar.

**Template:** `templates/partials/sheets/automation-tab.hbs`  
**Listeners:** `src/ui/sheets/item/listeners/rule-elements.js`

### 11.2 Automation Tab Layout

The tab contains these sections:

1. **Global Settings** — Feature Config controls (enabled, applyMode, promptMode, combatOnly, etc.)
2. **Stacking Override** — (traits only) Override canonical stacking rule
3. **Runtime Status** — Status badge legend (Active, Planned, Informational, Disabled by Setting, Unsupported in Workflow)
4. **Rule Elements** — The list of configured REs with full CRUD
5. **Debug** — (GM only) Show in Inspector toggle

### 11.3 CRUD Operations

#### Creating a Rule Element
1. At the bottom of the Rule Elements section, find the **"— Add Rule Element —"** dropdown
2. Elements are grouped by family in the dropdown: **Passive**, **Combat**, **Magic**, **General**
3. Select a type and click **Add** (+ button)
4. A new RE appears in the list with default values

#### Editing a Rule Element
1. Click the **expand chevron** (▼) on any RE to reveal its configuration body
2. Edit the **label** (inline text input in the header)
3. Toggle **enabled/disabled** via the eye icon checkbox
4. Edit **type-specific fields** (rendered dynamically on first expand)
5. Set **workflow scope** checkboxes (Skill, Characteristic, Combat, Magic) — checking none defaults to "All"
6. Edit the **predicate** in the textarea (raw roll-option string or JSON)
7. Add/remove **conditions** via the "Add Condition" button and trash icons
8. All changes persist immediately via `item.setFlag()`

#### Deleting a Rule Element
Click the **trash icon** on the RE header.

#### Reordering Rule Elements
**Drag and drop** — RE items have `draggable="true"` and support reordering via drag/drop.

#### Adding Conditions to a Rule Element
1. Expand the RE
2. Click **"Add Condition"** button
3. A dialog prompts you to select a condition type
4. The condition appears in the conditions list with its specific fields
5. Delete conditions via the ✕ button

### 11.4 Status Badges

Each RE displays a runtime status badge:

| Badge | Meaning |
|---|---|
| **Active** (green) | Handler runs at runtime for current workflow |
| **Planned** (blue) | Handler is planned but not yet implemented |
| **Informational** (gray) | Display-only (notes) |
| **Disabled by Setting** (red) | The workflow runtime setting is turned off |
| **Unsupported in Workflow** (orange) | This RE type doesn't support the current workflow |

### 11.5 Validation

Validation runs inline. Errors and warnings appear below the predicate textarea:
- **Errors** (red): Invalid predicate, missing required fields, non-numeric values
- **Warnings** (yellow): Unknown option values, unrecognized condition types

---

## 12. Interceptor vs Rule Element Deduplication

### 12.1 The `shouldYieldToRE()` Mechanism

Many talents have hardcoded "interceptor" implementations in `combat-talents.js` and `spellcasting-talents.js`. The `shouldYieldToRE()` function implements deduplication: when a talent item has an enabled RE of the appropriate type AND the corresponding workflow runtime is enabled, the interceptor yields (skips) and lets the RE runtime handle it.

**Signature:**
```js
shouldYieldToRE(actor, talentSlug, reType, workflow, getTalentItemFn) → boolean
```

**Returns `true` (interceptor should yield) when ALL of:**
1. Master runtime setting is enabled
2. The specific workflow runtime setting is enabled
3. The talent item exists on the actor
4. The talent item has at least one **enabled** RE of the specified `reType`

### 12.2 Combat Talents with `shouldYieldToRE` Guards

| Talent Slug | RE Type | Workflow | Interceptor Function |
|---|---|---|---|
| `precise` | `tnModifier` | `combat` | `applyAttackerTalentPreTN()` — +20 TN for precision attacks |
| `lightningreflexes` | `defenseOverride` | `combat` | `getDefenseTalentOverrides()` — Parry vs ranged at −20 |
| `brawler` | `dosBonus` | `combat` | `evaluatePostTestTalents()` — +1 DoS with 2+ opponents |
| `duelist` | `dosBonus` | `combat` | `evaluatePostTestTalents()` — +1 DoS vs single opponent |
| `teamwork` | `dosBonus` | `combat` | `evaluatePostTestTalents()` — +1 DoS when ally has Teamwork |
| `hyperawareness` | `dosReplacement` | `combat` | `evaluatePostTestTalents()` — Replace DoS with Observe rank |
| `trickyfighter` | `dosReplacement` | `combat` | `evaluatePostTestTalents()` — Replace DoS with Deceive rank |
| `wrestler` | `dosReplacement` | `combat` | `evaluatePostTestTalents()` — Replace DoS with Combat Style rank (grapple) |
| `champion` | `dosReplacement` | `combat` | `evaluatePostTestTalents()` — Replace DoS with skill rank (1 opponent) |
| `godofwar` | `dosReplacement` | `combat` | `evaluatePostTestTalents()` — Replace DoS with skill rank (2+ opponents) |
| `cripplingstrikes` | `wtDelta` | `combat` | `getEnemyWoundThresholdDelta()` — WT−1 for melee attacks |
| `eyeofvengeance` | `wtDelta` | `combat` | `getEnemyWoundThresholdDelta()` — WT−1 for ranged attacks |
| `sneakattack` | `damageBonus` | `combat` | `applyTalentDamageModifiers()` — Add Stealth rank to damage when hidden |

### 12.3 Spellcasting Talents with `shouldYieldToRE` Guards

| Talent Slug | RE Type | Workflow | Interceptor Function |
|---|---|---|---|
| `cryomancer` | `damageBonus` | `magic` | `_applyCryomancer()` — +1 frost damage |
| `pyromancer` | `damageBonus` | `magic` | `_applyPyromancer()` — +1 fire damage |
| `electromancer` | `damageBonus` | `magic` | `_applyElectromancer()` — +1 shock damage |
| `creative` | `spellModifier` | `magic` | `_applyCreative()` — +1 WB for unconventional restraint |
| `methodical` | `spellModifier` | `magic` | `_applyMethodical()` — +1 WB for conventional restraint |
| `magickacycling` | `spellModifier` | `magic` | `_applyMagickaCycling()` — +2 WB for restraint |
| `mageguard` | `spellModifier` | `magic` | `_applyMageGuard()` — +1 Reinforce effect (not restraining) |

### 12.4 Interceptor-Only Talents (No RE Guard)

These talents have interceptor implementations but **no** `shouldYieldToRE` guard. They remain interceptor-only because their logic is too complex for current RE conditions or they involve multi-step dialog interactions:

**Combat:**
| Talent | Reason |
|---|---|
| `fearsome` | Evade override with Persuade(STR) — complex skill substitution |
| `assassinate` | Conditional AR ignore based on weapon qualities + Sneak Attack state |

**Magic:**
| Talent | Reason |
|---|---|
| `masterofmagicka` | Overload + restraint interaction (boolean flag, no numeric delta) |
| `overcharge` | Dialog opt-in + cost multiplier + roll-twice logic |
| `arcanedefender` | Upgrades Mage Guard bonus to WB/2 — depends on Mage Guard |
| `strongwilled` | Complex fatigue resistance interaction |
| `seasonedconjurer` | Conjuration-specific DoS + AP reduction |
| `livingarmory` | Bound weapon mechanics |
| `control` | Summon duration extension |
| `bladecaller` | Bound weapon variant |
| `weaponecho` | Bound weapon quality inheritance |
| `spellsword` | Weapon-spell hybrid mechanics |
| `unfetteredconjuration` | Conjuration restriction removal |
| `taskmaster` | Summon command mechanics |
| `masterofthehordes` | Multi-summon mechanics |

### 12.5 How Deduplication Works in Practice

1. A combat workflow calls `applyAttackerTalentPreTN()` (interceptor)
2. The interceptor checks `shouldYieldToRE(attacker, "precise", "tnModifier", "combat", getTalentItem)`
3. If the actor's "Precise" talent item has an enabled `tnModifier` RE → returns `true` → interceptor skips
4. Later, `evaluateRuleElementsRuntime()` runs at `preRoll` phase and picks up the RE
5. If the talent has NO REs → `shouldYieldToRE` returns `false` → interceptor runs as normal

**The behavior is additive-only:** talents without Rule Elements continue using hardcoded interceptors. Talents *with* Rule Elements yield the interceptor and let the RE runtime handle them. Both paths cannot fire simultaneously for the same talent.

---

## 13. Debug & Self-Test Utilities

### 13.1 Debug Logging

Enable via Debug Settings → **"Rule Elements: Debug Logging"** checkbox.

Setting key: `ruleElementDebug` (also controls predicate debug output).

When enabled, logs to browser console with prefix:
```
UESRPG | rule-element-runtime | ...
UESRPG | predicate | ...
```

### 13.2 Self-Test Functions

```js
// Test the runtime support matrix, phase normalization, and eligibility sweep
game.uesrpg.rules.ruleElementRuntime.selfTest()

// Test predicate evaluation logic
game.uesrpg.rules.predicate.selfTest()
```

Both return `{total, passed, failed, results}` objects.

### 13.3 Runtime Settings State Inspection

```js
import { getRuleElementRuntimeSettingsState } from "./rule-element-runtime.js";
console.log(getRuleElementRuntimeSettingsState());
// { master: true, workflows: {...}, enabled: {...} }
```

---

## 14. Cross-References

### Related Documentation

| Document | Relevance |
|---|---|
| `docs/Active Effect Wiki.md` | AE modifier keys reference — REs complement AEs but use a separate system |
| `docs/Trait Keys Wiki.md` | Trait key registry — trait keys are a different mechanism from REs |

**Key distinction:** Active Effects and Rule Elements are separate systems. AEs use `changes[]` arrays with attribute keys, while REs use typed handlers with predicates. They can coexist on the same item. The AE system handles passive stat modifications via transfer gating; the RE system handles staged roll workflow automation.

### Key Source Files

| File | Purpose |
|---|---|
| `src/core/traits/features/rule-element-runtime.js` | Runtime evaluator (1052 lines) |
| `src/core/traits/features/rule-elements.js` | Type registry, CRUD helpers, validation (889 lines) |
| `src/core/rules/predicate.js` | Predicate evaluator (225 lines) |
| `src/core/rules/roll-options.js` | Roll option builder (167 lines) |
| `src/core/rules/phases.js` | Phase constants and normalization |
| `src/core/traits/features/conditions-to-predicate.js` | Condition-to-predicate compiler |
| `src/core/traits/features/feature-config.js` | Per-item feature configuration |
| `src/ui/sheets/item/listeners/rule-elements.js` | UI event listeners (402 lines) |
| `templates/partials/sheets/automation-tab.hbs` | Handlebars template for Automation tab |
| `templates/dev/debug-settings.hbs` | Debug Settings panel template |
| `src/core/traits/combat-talents.js` | Combat talent interceptors with RE guards |
| `src/core/traits/spellcasting-talents.js` | Spellcasting talent interceptors with RE guards |
| `src/hooks/init.js` | Setting registrations (lines 245–316) |

---

## Appendix A: Runtime Output Shape

`evaluateRuleElementsRuntime()` returns:

```js
{
  enabled: boolean,           // Whether runtime was enabled for this workflow
  workflow: string,           // Resolved workflow ("skill"|"characteristic"|"combat"|"magic")
  phase: string,              // Resolved phase ("preRoll"|"postRoll"|"preDamage"|...)

  // Accumulated values
  tnDelta: number,            // Total TN modification (preRoll)
  dosDelta: number,           // Total DoS bonus (postRoll)
  dosReplacement: object|null,// Resolved DoS replacement (postRoll)
  pendingDosReplacements: [], // All pending DoS replacement options
  damageBonus: [],            // Array of {value, damageType, ignoresAR}
  wtDelta: number,            // Wound Threshold delta
  defenseOverrides: [],       // Array of {allow, against, tnMod}
  rerollGrants: [],           // Array of {scope, skillName, maxUses}
  spellModifiers: {           // Spell parameter deltas
    restraintWbDelta: number,
    effectDelta: number,
    costDelta: number
  },
  passiveMods: [],            // Passive modifications (flatModifier, booleanFlag, etc.)
  informational: [],          // Note texts

  // Diagnostics
  applied: [],                // Array of applied entry records
  skipped: {                  // Skip counters by reason
    disabled: number,
    unsupportedType: number,
    unsupportedPhase: number,
    workflowScope: number,
    typeGate: number,
    predicate: number,
    residual: number,
    invalid: number
  },
  warnings: [],               // Array of {level, message, elementId, sourceItemId}
  rollOptions: []             // Array of roll option strings used for evaluation
}
```

## Appendix B: Applied Entry Shape

Each entry in `output.applied[]`:

```js
{
  sourceItemId: string|null,   // Item ID of the source trait/talent/power
  sourceItemName: string,      // Item name
  sourceItemType: string,      // Item type ("trait"|"talent"|"power")
  elementId: string|null,      // Rule Element ID
  elementLabel: string,        // RE label
  type: string,                // Handler type key
  lane: string,                // Output lane ("tn"|"dos"|"damage"|"wt"|"defense"|"reroll"|"spell"|"passive"|"info")
  value: number,               // Numeric value applied
  phase: string                // Phase at which it was applied
}
```

## Appendix C: Workflow Resolution Priority

When the workflow is not explicitly specified, it's resolved in this order:

1. Explicit `workflow` parameter
2. `rollContext.workflow`
3. Attack mode `"magic"` → `"magic"`
4. Test type `"skill"` → `"skill"`
5. Test type `"characteristic"` → `"characteristic"`
6. Test type `"attack"` → `"combat"`
7. Test type `"spell"` → `"magic"`
8. Characteristic key present → `"characteristic"`
9. Skill name present → `"skill"`
10. Item type `"spell"` → `"magic"`
11. Item type `"weapon"` → `"combat"`
12. Fallback: `""` (empty — runtime disabled)
