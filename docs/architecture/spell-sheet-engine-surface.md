# Spell Sheet Engine Surface Audit

## Overview

This document inventories all engine capabilities the spell item sheet must expose,
maps current config sources, identifies gaps, and defines the canonical config model.

---

## 1. Canonical Engine Primitives

| # | Capability | File | Status |
|---|-----------|------|--------|
| 1 | Spell Profile Resolver | `src/core/magic/spell-profile.js` | Complete |
| 2 | Casting Service / Dialogs | `src/core/magic/casting-service.js` | Complete |
| 3 | Origin AE Lifecycle | `src/core/magic/origin-effect.js` | Complete |
| 4 | Upkeep Contract | `src/core/magic/upkeep-workflow.js` | Complete |
| 5 | Zone/Template Service | `src/core/magic/spell-zone-service.js` | Infrastructure |
| 6 | Tick Engine | `src/core/magic/spell-tick-engine.js` | Complete |
| 7 | OverTime Engine | `src/core/magic/overtime-engine.js` | Complete |
| 8 | Magic Modifiers | `src/core/magic/magic-modifiers.js` | Complete |
| 9 | Dispel Service | `src/core/magic/dispel-service.js` | Complete |
| 10 | Summon Service | `src/core/magic/summon-service.js` | Structural |
| 11 | Rune Trigger Service | `src/core/magic/rune-trigger-service.js` | Structural |
| 12 | Bound Item Service | `src/core/magic/bound-item-service.js` | Structural |
| 13 | Soul Trap Service | `src/core/magic/soul-trap-service.js` | Complete |
| 14 | Scaling Validator | `src/core/magic/scaling-validator.js` | Complete |
| 15 | Spell Range | `src/core/magic/spell-range.js` | Complete |
| 16 | Spellcasting Talents | `src/core/traits/spellcasting-talents.js` | Complete |

---

## 2. Spell Item Fields Inventory

### 2.1 Fields in template.json (canonical)

| Path | Default | Sheet Editable | Engine Consumer |
|------|---------|---------------|-----------------|
| `system.description` | `""` | Yes (ProseMirror) | — |
| `system.level` | `0` | Yes | spell-profile, dispel-service |
| `system.cost` | `0` | Yes | spell-profile, casting-service |
| `system.school` | `""` | Yes (select) | spell-profile, dispel-service |
| `system.spellType` | `"conventional"` | Yes (select) | spell-profile, magic-modifiers |
| `system.isAttackSpell` | `false` | Yes (checkbox) | spell-profile |
| `system.isDamagingSpell` | `false` | Yes (checkbox) | spell-profile |
| `system.isHealingSpell` | `false` | Yes (checkbox) | — (dead; magicka-utils detects from type) |
| `system.isInstant` | `false` | Yes (checkbox) | spell-profile, casting-service |
| `system.hasUpkeep` | `false` | Yes (checkbox) | spell-profile, origin-effect, upkeep-workflow |
| `system.hasOverload` | `false` | Yes (checkbox) | spell-profile |
| `system.overloadEffect` | `""` | Conditional | — (display only) |
| `system.overloadBonusDamage` | `""` | Conditional | spell-profile |
| `system.hasReinforce` | `false` | Yes (checkbox) | spell-profile |
| `system.isDirect` | `false` | Yes (checkbox) | spell-profile, casting-service |
| `system.damageType` | `"none"` | Yes (select) | spell-profile |
| `system.damageFormula` | `""` | Yes (text) | spell-profile |
| `system.rangeType` | `""` | Yes (select) | spell-profile |
| `system.range` | `""` | Yes (text) | spell-range |
| `system.aoeShape` | `"circle"` | Conditional | spell-profile |
| `system.aoeSize` | `0` | Conditional | spell-profile |
| `system.aoeWidth` | `0` | Conditional | spell-profile |
| `system.aoePulse` | `false` | No (missing from sheet) | spell-profile |
| `system.aoeIncludeCaster` | `false` | Conditional | spell-profile |
| `system.duration.value` | `0` | Yes | spell-profile, origin-effect |
| `system.duration.unit` | `"rounds"` | Yes (select) | spell-profile, origin-effect |
| `system.mindlockValue` | `0` | Yes | spell-profile |
| `system.isRuneSpell` | `false` | Yes (checkbox) | rune-trigger-service |
| `system.runeTriggerType` | `""` | Conditional | rune-trigger-service |
| `system.runeTriggerRadius` | `3` | Conditional | rune-trigger-service |
| `system.runeTriggerDelay` | `0` | Conditional | rune-trigger-service |
| `system.isSummonSpell` | `false` | Yes (checkbox) | — (UI gating only) |
| `system.isZonePersistent` | `false` | Yes (checkbox) | — (UI gating only) |
| `system.hasOverTime` | `false` | Yes (checkbox) | — (UI gating only) |
| `system.overTime.*` | various | Conditional | overtime-engine (via AE flags) |
| `system.scaling.levels` | `[]` | Yes (table) | spell-profile |
| `system.healAmount` | `""` | **Dead** | — |
| `system.spell_str` | `""` | **Dead** | — |
| `system.attributes` | `""` | **Dead** | — |
| `system.damage` | `""` | **Dead** (replaced by damageFormula) | — |
| `system.form` | `""` | **Not editable** | spell-profile |

### 2.2 Fields missing from template.json but used

| Path | Used In | Impact |
|------|---------|--------|
| `system.reinforceDescription` | spell-sheet.html textarea | No default; form-submitted only |
| `system.rangeValue` | spell-range.js (fallback exists) | Graceful fallback |

### 2.3 Gaps: Engine capabilities with no sheet config

| Capability | Currently Configurable | Gap |
|------------|----------------------|-----|
| Dispel Identity (spell level + strength) | Only via `system.level` | No explicit dispel policy |
| Origin AE stacking policy | Hardcoded | No sheet exposure |
| Summon actor/compendium source | Runtime dialog only | No pre-configuration |
| Zone tick payload | Not on spell item | Constructed from OverTime on AE flags |
| Rune detonation payload | Not on spell item | Only trigger conditions configurable |
| Effect recipes (modifier-based) | Only raw AE editor | No structured builder |

---

## 3. Canonical Config Model Decision

**Single resolver: `resolveSpellProfile()` in `spell-profile.js`** — already canonical.

No competing spell config models exist. All casting paths route through the profile resolver.

The sheet should expose configuration that maps 1:1 to existing `system.*` fields consumed by the resolver plus the identified gaps above. New gaps should use the `system.engine.*` namespace.

---

## 4. Recommended New Fields (system.engine.*)

| Path | Type | Default | Purpose |
|------|------|---------|---------|
| `system.engine.targeting.mode` | string | `"single"` | Target mode: self/single/multi |
| `system.engine.targeting.maxTargets` | number | `1` | Max targets for multi mode |
| `system.engine.effects.recipes` | array | `[]` | Structured effect recipes |
| `system.engine.effects.stackingPolicy` | string | `"replace"` | replace/stack/refresh |
| `system.engine.effects.ownershipPolicy` | string | `"target"` | target/self/both |
| `system.engine.persistence.dispelStrength` | string | `"level"` | level/fixed/immune |
| `system.engine.persistence.dispelFixedValue` | number | `0` | Fixed dispel strength |
| `system.engine.summon.actorUuid` | string | `""` | Pre-configured summon |
| `system.engine.summon.quantity` | number | `1` | Number to summon |
