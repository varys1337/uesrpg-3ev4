# Spellcasting Talents Integration Architecture

## Overview

This document describes how spellcasting talents (Chapter 4) are integrated into the
UESRPG 3ev4 magic framework. The implementation follows the single-stage modifier pattern
used by combat talents but adapted for the spell profile resolver and casting service.

---

## Extension Points

### 1. Spell Profile Resolution (single modifier stage)

**File:** `src/core/traits/spellcasting-talents.js`

The spell profile resolver (`src/core/magic/spell-profile.js`) calls
`applySpellcastingTalentModifiers()` after all base profile sections are resolved
(metadata, classification, cost, damage, duration, range, AoE, scaling, mindlock).

```
resolveSpellProfile(spell, actor, options)
  ├─ _resolveMetadata(spell)
  ├─ _resolveClassification(spell)
  ├─ _resolveCostProfile(actor, spell, options)
  ├─ _resolveDamageProfile(spell, options)
  ├─ _resolveDuration(spell, options)
  ├─ _resolveRangeProfile(spell)
  ├─ _resolveAoEProfile(spell)
  ├─ _resolveScaling(spell, options)
  ├─ _resolveMindlock(spell)
  └─ ** applySpellcastingTalentModifiers() **   ← NEW
       ├─ Run all passive talent applicators
       ├─ Build summary object
       └─ applyTalentSummaryToProfile() → mutates profile in-place
```

The talent modifier stage is **idempotent**: calling it twice on the same profile
produces the same result (all checks are additive with no state mutation).

### 2. Spell Restraint Refund (talent-aware WB)

**File:** `src/core/magic/magicka-utils.js`

`applySpellRestraintRefund()` now delegates WB computation to
`computeSpellRestraintReduction()` from `magic-modifiers.js`, which includes:

- Base WB (Willpower / 10)
- Magicka Cycling: +2 WB
- Creative: +1 WB (unconventional spells only)
- Methodical: +1 WB (conventional spells only)
- Stunted Magicka trait: halve reduction (round down)
- Critical success on non-damaging spells: double reduction

This replaces the previous raw-WB implementation that ignored talent modifiers.

### 3. Casting Dialog (Master of Magicka)

**File:** `src/core/magic/opposed/actions/attacker.js`

The casting dialog now checks for "Master of Magicka" talent to determine whether
the Restrain and Overload checkboxes should be mutually exclusive. When the talent
is present, both can be checked simultaneously.

### 4. Upkeep Workflow (Living Armory)

**File:** `src/core/magic/upkeep-workflow.js`

The upkeep confirmation handler (`handleUpkeepGroupConfirm`) now checks for the
"Living Armory" talent. When applicable (Conjure Weapon/Armour spells targeting
only the caster), it deducts 1 AP instead of Magicka.

The upkeep prompt card also displays a visual indicator when Living Armory is
available.

### 5. Backfire Negation (Control)

**File:** `src/core/magic/backfire.js`

Already implemented prior to this integration. The `triggerBackfire()` function
checks for "Control" talent and prompts a Willpower test to negate the backfire.

### 6. Post-Cast Hook (primed state consumption)

**File:** `src/core/traits/spellcasting-talents.js`

A `Hooks.on("uesrpg.spell.castResolved")` listener is registered once during
system initialization. It checks for primed talent states and consumes them
when a qualifying spell cast completes.

---

## Data Contracts

### Profile `talentModifiers` Object

After spell profile resolution, the profile contains a `talentModifiers` property:

```javascript
profile.talentModifiers = {
  damageBonus: number,           // Flat damage bonus (Pyromancer/Cryomancer/Electromancer)
  rollDamageTwice: boolean,      // Overcharge: roll 2×, keep highest
  restraintWpBonusDelta: number, // WB adjustment for restraint (Creative/Methodical/Cycling)
  reinforceBonusDelta: number,   // Reinforce effect bonus (Mage Guard/Arcane Defender)
  conjurationBonusDoS: number,   // Bonus DoS on Conjuration tests (Strong Willed)
  conjurationUseSkillRank: boolean, // Can use skill rank as DoS (Seasoned Conjurer)
  conjurationSkillRankValue: number,
  allowOverloadWithRestrain: boolean, // Master of Magicka
  upkeepApInsteadOfMp: boolean,      // Living Armory
  backfireCanNegate: boolean,         // Control
  costMultiplier: number,             // Overcharge: 2× cost
  costMultiplierAfterRestraint: boolean,
  labels: string[],                   // Human-readable breakdown
  applied: boolean                    // Marker that modifier stage ran
}
```

### Primed State Flag

Activated talents use an actor flag for primed state:

```javascript
// Flag path: flags.uesrpg-3ev4.spellcasting.primed
{
  slug: "overcharge",           // Talent slug
  expiresAtWorldTime: null,     // Optional world-time expiry
  usesRemaining: 1,             // Consumed after qualifying cast
  options: {},                  // Talent-specific options
  primedAt: 1707300000000       // Timestamp when primed
}
```

**Lifecycle:**
1. Talent activation → `setSpellcastingPrimedState(actor, state)`
2. Qualifying spell cast → `handlePostCastTalentConsumption(payload)` → uses consumed
3. Expiry or manual clear → `clearSpellcastingPrimedState(actor)`

---

## Module Dependency Graph

```
spell-profile.js
  └─ imports from: spellcasting-talents.js
       └─ imports from: talents-api.js, magic-modifiers.js

magicka-utils.js
  └─ imports from: magic-modifiers.js (computeSpellRestraintReduction)

upkeep-workflow.js
  └─ imports from: talents-api.js (hasTalent)

backfire.js
  └─ imports from: magic-modifiers.js (actorHasTalent)

init.js
  └─ imports from: spellcasting-talents.js (registerSpellcastingTalentHooks)
```

No circular dependencies exist. The `spellcasting-talents.js` module does not import
from `spell-profile.js`, `casting-service.js`, or `magicka-utils.js`.

---

## Talent Implementation Reference

### Fully Automated (passive, no activation required)

| Talent | Modifier Type | Target |
|--------|--------------|--------|
| Pyromancer | `damage.bonusFlat: 1` | Fire damage spells |
| Cryomancer | `damage.bonusFlat: 1` | Frost damage spells |
| Electromancer | `damage.bonusFlat: 1` | Shock damage spells |
| Creative | `restraint.wpBonusDelta: 1` | Unconventional spell restraint |
| Methodical | `restraint.wpBonusDelta: 1` | Conventional spell restraint |
| Magicka Cycling | `restraint.wpBonusDelta: 2` | All spell restraint |
| Master of Magicka | `overload.allowWithRestrain` | Spells with Overload attribute |
| Mage Guard | `reinforce.bonusDelta: 1` | Reinforce spells, no restraint |
| Arcane Defender | `reinforce.bonusDelta: WB/2-1` | Reinforce spells (extends Mage Guard) |
| Strong Willed | `conjuration.bonusDoS: 1` | Conjuration tests |
| Seasoned Conjurer | `conjuration.useSkillRank` | Conjuration tests |
| Living Armory | `upkeep.apInsteadOfMp` | Self-targeting Conjure equipment upkeep |

### Dialog-Activated (opt-in per cast)

| Talent | Modifier Type | Target |
|--------|--------------|--------|
| Overcharge | `damage.rollTwice`, `cost.multiplier: 2` | Damaging spells |

### Pre-Implemented (in backfire.js)

| Talent | Implementation |
|--------|---------------|
| Control | WP test to negate backfire in `triggerBackfire()` |

### Standalone Actions (not profile modifiers)

| Talent | Type | Status |
|--------|------|--------|
| Bend Reality | Skill substitution | Deferred (skill system) |
| Healer | Ritual action | Deferred (standalone workflow) |
| Flow of Magicka | Counter-spell reaction | Deferred (defense system) |
| Trickster | Skill substitution | Deferred (skill system) |
| Thought Caster | Somatic requirement | Deferred (equipment system) |
| Depth of Understanding | Grants Power Well trait | No modifier needed |

### Milestone-Dependent (stubs with GM warning)

| Talent | Required Subsystem |
|--------|-------------------|
| Bladecaller | Conjure Weapon spell framework |
| Weapon Echo | Conjure Weapon spell framework |
| Spell Sword | Equipment interaction framework |
| Unfettered Conjuration | Summoning spell framework |
| Taskmaster | Mindlock / summoning framework |
| Master of the Hordes | Mindlock / summoning framework |
| Void Channeler | Summoned creature management |
| The Mending Tides of Oblivion | Summoned creature management |

---

## How to Add a New Spellcasting Talent

1. **Add alias** in `src/core/traits/talents-api.js` → `TALENT_NAME_ALIASES`
2. **Add applicator** in `src/core/traits/spellcasting-talents.js`:
   - Create `_applyTalentName(actor, profile, spell, castContext)` function
   - Return `null` if preconditions not met
   - Return `TalentModifier` object with appropriate keys
3. **Register** in the `PASSIVE_TALENT_APPLICATORS` array
4. **Update summary builder** if new modifier types are added to `_buildSummary()`
5. **Wire downstream consumers** if the modifier needs to be applied in a specific
   workflow stage (damage computation, upkeep, etc.)
6. **Add tests** to `docs/testing/talents-spellcasting.md`
7. **Update this document** with the new talent's modifier type and target

---

## Interaction with OverTime/Zone Payloads

Talent modifiers are applied to the **resolved profile**, which serves as the
source of truth for all downstream consumers including:

- **OverTime engine** (`overtime-engine.js`): reads damage formulas from the profile
- **Zone ticks** (`spell-zone-service.js`): damage per tick uses profile values
- **Origin AE** (`origin-effect.js`): stores profile data in AE flags

The talent modifier stage runs before these consumers, so the adjusted profile
(with elemental damage bonuses, reinforce bonuses, etc.) is automatically inherited
by all downstream systems.

---

## Upkeep Contract Adjustments

Living Armory modifies the upkeep payment method (not the cost value):

- **At cast time**: The spell profile `talentModifiers.upkeepApInsteadOfMp` flag is set
- **At upkeep time**: `handleUpkeepGroupConfirm()` checks the caster for the
  Living Armory talent and spell name criteria
- **Conditions**: Spell name contains "Conjure Weapon" or "Conjure Armour" AND
  all targets are the caster
- **Payment**: 1 AP deducted instead of stored upkeep MP cost
- **Failure mode**: If AP is insufficient, falls back to normal MP payment
