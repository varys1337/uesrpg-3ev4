UESRPG 3ev4 — Active Effects Guide (Foundry VTT v13.351)

 This document describes the Active Effects (AE) framework implemented for the UESRPG 3ev4 system in Foundry VTT v13.351.It serves as:
- A reference for content creators (items, talents, traits)
- A debugging guide for maintainers
- A roadmap marker distinguishing implemented vs deferred AE lanes
- All listed effects are deterministic, stack-safe, and tested, unless explicitly marked otherwise.


ADD vs OVERRIDE semantics
For every supported modifier key:
ADD: stack-safe summation
OVERRIDE: deterministic replacement
Highest-priority OVERRIDE wins
OVERRIDE suppresses all ADD for the same key
OVERRIDE is API-correct and normalized across numeric and string modes.

Transfer semantics (locked)
Weapons / Armor: effects apply only if item.system.equipped === true
Talents / Traits: effects always apply
Spells: WIP , not yet properly introduced

1. Characteristics 
system.modifiers.characteristics.str
system.modifiers.characteristics.end
system.modifiers.characteristics.agi
system.modifiers.characteristics.int
system.modifiers.characteristics.wp
system.modifiers.characteristics.prc
system.modifiers.characteristics.prs
system.modifiers.characteristics.lck

2. Combat & Rolls Attribute Keys
2.1 Combat Target Numbers (TN)
Attacker
system.modifiers.combat.attackTN

Defender
system.modifiers.combat.defenseTN.total
system.modifiers.combat.defenseTN.evade
system.modifiers.combat.defenseTN.block
system.modifiers.combat.defenseTN.parry
system.modifiers.combat.defenseTN.counter

Applies to:
- Opposed combat
- Unopposed combat style rolls (parity guaranteed)
- Shown in UI: Full provenance in TN breakdown (collapsible)

2.2 Skills Attribute Keys
Global lanes (apply to all skills, including Magic Skills)
system.modifiers.tests.all
system.modifiers.skills._all

Per-skill
system.modifiers.skills.<skillKey>

!!! Applies at roll-time only, never mutates stored skill values. !!!

2.3 Spell casting TN (the spell casting test)

These are evaluated inside computeMagicCastingTN() and summed into the TN breakdown.
Global lanes (apply to all casting)

system.modifiers.tests.all
system.modifiers.skills._all
system.modifiers.magic.castingTN._all (virtual lane; supported even if not present in template data)
School-specific lanes (spell’s system.school)
Supported school keys in this system are:
alteration
conjuration
destruction
illusion
mysticism
necromancy
restoration

Author any of:
system.modifiers.skills.alteration
system.modifiers.skills.conjuration
system.modifiers.skills.destruction
system.modifiers.skills.illusion
system.modifiers.skills.mysticism
system.modifiers.skills.necromancy
system.modifiers.skills.restoration

And/or the casting-only equivalents:
system.modifiers.magic.castingTN.alteration
system.modifiers.magic.castingTN.conjuration
system.modifiers.magic.castingTN.destruction
system.modifiers.magic.castingTN.illusion
system.modifiers.magic.castingTN.mysticism
system.modifiers.magic.castingTN.necromancy
system.modifiers.magic.castingTN.restoration	

3. Damage System Attribute Keys
3.1 Attacker-side modifiers
Bonus damage
system.modifiers.combat.damage.dealt

Supports:
Numeric: +3
Typed: 3[fire], 2[frost], etc.
Typed bonus damage:

Is applied as part of the same damage workflow and uses the correct damage type. It is reduced by resistances and toughness and is shown in the damage breakdown

Penetration
system.modifiers.combat.penetration

Note: Penetration effectively reduces target armor by increasing penetration.
This behavior is consistent and deterministic, even if not strictly RAW in all interpretations.

3.2 Defender-side modifiers Attribute Keys
Damage taken
system.modifiers.combat.damage.taken

Flat mitigation
system.modifiers.combat.mitigation.flat

3.3 Damage types, armor & resistance Attribute Keys
Armor Rating
system.modifiers.combat.armorRating
system.modifiers.combat.armorRating.<LocationKey>

Resistances
system.resistance.fireR
system.modifiers.resistance.fireR
system.traits.resistance.fire

system.resistance.frostR
system.modifiers.resistance.frostR
system.traits.resistance.frost

system.resistance.shockR
system.modifiers.resistance.shockR
system.traits.resistance.shock

system.resistance.poisonR
system.modifiers.resistance.poisonR
system.resistances.poison
system.traits.resistance.poison

system.resistance.diseaseR
system.modifiers.resistance.diseaseR
system.resistances.disease
system.traits.resistance.disease

system.resistance.magicR / system.modifiers.resistance.magicR
system.resistance.silverR / system.modifiers.resistance.silverR
system.resistance.sunlightR / system.modifiers.resistance.sunlightR
system.resistance.physicalR / system.modifiers.resistance.physicalR

Natural Toughness (RAW-aligned)
system.modifiers.resistance.natToughness

Important (RAW):
Natural Toughness reduces all damage types. It functions like AR but does not count as armor

4. Derived Stats Attribute Keys
4.1 Initiative
system.modifiers.initiative.base
system.modifiers.initiative.bonus

Not supported:
initiative.value (by design; initiative is derived)

4.2 Speed Attribute Keys

system.modifiers.speed.base
system.modifiers.speed.bonus
system.modifiers.speed.value

// Applied after all recalculations and movement restriction semantics so OVERRIDE truly sets the final speed. Swim speed is re-derived from the final ground speed while preserving the existing swim-bonus pipeline.

4.3 Fly Speed / Swim Speed

system.modifiers.speed.flySpeed (ADD/OVERRIDE) — Levitate and similar; applied after trait-based fly calculation.
system.modifiers.speed.swimSpeed (ADD/OVERRIDE) — applied after base swim (ground/2 + trait bonus).

4.4 Movement Modifier Keys

system.modifiers.movement.fallDamage (ADD/OVERRIDE) — fall damage reduction in meters (Slowfall); consumed at fall-damage evaluation time.
system.traits.movement.waterBreathing (boolean) — can breathe underwater (Water Breathing spell); ADD 1 = true.
system.traits.movement.waterWalking (boolean) — can walk on water surface (Water Walking spell); ADD 1 = true.

4.5 Stealth Modifier Keys (Illusion)

system.modifiers.stealth.visual (ADD/OVERRIDE) — penalty applied to visual Observe tests against the target (Chameleon).
system.modifiers.stealth.auditory (ADD/OVERRIDE) — penalty applied to auditory Observe tests against the target (Muffle).

4.6 Magic Defense Keys (Mysticism / Alteration)

system.modifiers.magic.spellReflect (ADD/OVERRIDE) — reflects incoming spells of level ≤ value (Reflect spell).
system.modifiers.magic.spellAbsorption (ADD/OVERRIDE) — absorbs incoming spells of level ≤ value as MP recovery (Spell Absorption).

4.7 Situational Test Modifiers

system.modifiers.tests.fear (ADD/OVERRIDE) — bonus to Fear/Panic resistance tests (Courage spell).

4.8 Condition State Flags

system.traits.condition.silenced (boolean) — blocks verbal spellcasting component (Silence spell); ADD 1 = true.
system.traits.condition.invisible (boolean) — invisible state flag (Invisibility spell); ADD 1 = true.

5. Resources (Max values only)
Supported
system.modifiers.hp.max

Magicka resource (derived max/value adjustments used by casting and upkeep)
These are explicitly supported in actor.js as deterministic AE lanes (ADD / OVERRIDE semantics per lane), and they affect derived system.magicka.* values used during play:
system.modifiers.magicka.base
system.modifiers.magicka.bonus
system.modifiers.magicka.max
system.modifiers.magicka.value
// Guidance: Prefer these system.modifiers.magicka.* lanes over directly changing system.magicka.max/value, because Magicka max/value are derived and clamped during actor data preparation.

system.modifiers.stamina.max

system.modifiers.luck_points.max

Behavior: Max values are derived. Current values are clamped only if exceeding max. No direct mutation of current values via AE

6. Wound Threshold Attribute Keys
system.modifiers.wound_threshold.bonus
system.modifiers.wound_threshold.value
system.traits.immunity.passiveWounds - the actor’s passive wound penalty is suppressed when return true (ADD/OVERRID // 1) 

//Applies after form/trait adjustments.

7. Carry & Encumbrance Attribute Keys
7.1 Carry capacity

system.modifiers.carry.base
system.modifiers.carry.bonus
system.modifiers.carry.override

7.2 Encumbrance penalty lanes Attribute Keys (RAW-aligned)
Test penalty
system.modifiers.encumbrance.testPenalty

Legacy alias (still supported):
system.modifiers.encumbrance.penalty

Speed penalty
system.modifiers.encumbrance.speedPenalty

Stamina penalty
system.modifiers.encumbrance.staminaPenalty

These modify post-bracket penalties, not the bracket selection itself.

[[ Encumbrance → Fatigue conversion (RAW)

If encumbrance penalties would reduce Stamina max below 0:
- Stamina max is clamped to 0
- Excess converts into fatigue bonus
- Conversion is derived-only and reversible ]]

8. Fatigue / Exhaustion Attribute Keys
Bonus lane
system.modifiers.fatigue.bonus
Alias: system.modifiers.exhaustion.bonus

Penalty lane
system.modifiers.fatigue.penalty
Alias: system.modifiers.exhaustion.penalty

[[ Application order: Encumbrance overflow (derived) => Fatigue bonus AE => Fatigue level calculation => Base fatigue penalty => Fatigue penalty AE ]]

9. OVERRIDE support (global)
OVERRIDE is supported and tested for all keys listed above.

Rules:
OVERRIDE replaces ADD for the same key. Deterministic resolution via priority

Works for:
- TN
- Skills
- Damage
- Derived stats
- Resources
- Encumbrance
- Fatigue

10. Condition immunities
| Condition (UI / rules text) | AE Key                               |
| --------------------------- | ------------------------------------ |
| Paralysis                   | `system.traits.immunity.paralysis`   |
| Stunned                     | `system.traits.immunity.stunned`     |
| Unconscious                 | `system.traits.immunity.unconscious` |
| Prone                       | `system.traits.immunity.prone`       |
| Fear / Panic                | `system.traits.immunity.fear`        |
| Horror                      | `system.traits.immunity.horror`      |
| Charm / Mind Control        | `system.traits.immunity.charm`       |

| Condition | AE Key                            |
| --------- | --------------------------------- |
| Bleeding  | `system.traits.immunity.bleeding` |
| Burning   | `system.traits.immunity.burning`  |
| Poisoned  | `system.traits.immunity.poisoned` |
| Disease   | `system.traits.immunity.disease`  |

| Condition  | AE Key                              |
| ---------- | ----------------------------------- |
| Fatigue    | `system.traits.immunity.fatigue`    |
| Exhaustion | `system.traits.immunity.exhaustion` |


11.Initiative Rating (IR)
Current/override + “special formula replacement”
system.modifiers.initiative.bonus (ADD / OVERRIDE)
system.modifiers.initiative.base (ADD / OVERRIDE)
system.modifiers.initiative.value (ADD / OVERRIDE

Special-formula (deterministic) support

system.modifiers.initiative.mult.agi (ADD / OVERRIDE; default 1; ADD treated as delta on top of 1)
system.modifiers.initiative.mult.int (ADD / OVERRIDE; default 1; ADD treated as delta on top of 1)
system.modifiers.initiative.mult.prc (ADD / OVERRIDE; default 1; ADD treated as delta on top of 1)
system.modifiers.initiative.flat (ADD / OVERRIDE; default 0)

Computed as
IR = AB*mAgi + IB*mInt + PcB*mPrc + flat + bonus, then:

legacy item-based replacement (replace.ini) still runs,
then system.modifiers.initiative.value applies (ADD/OVERRIDE) last.

12. Action Points
system.modifiers.action_points.max (ADD / OVERRIDE)
system.modifiers.action_points.value (ADD / OVERRIDE)

13. Lucky / Unlucky Numbers (crit matching only)


system.modifiers.lucky_numbers.max (ADD / OVERRIDE)
( Alias: system.modifiers.lucky_numbers.value)

system.modifiers.unlucky_numbers.max (ADD / OVERRIDE)
(Alias: system.modifiers.unlucky_numbers.value)

11. Deferred / Not Implemented (by design)

These are explicitly not implemented yet and safe to ignore until future updates:

- Spell targeting & spell AE transfer logic
- Economy modifiers
- Armor mobility penalties as explicit AE lanes (currently handled internally, not AE-exposed)
- Initiative “current value” overrides
- Any AE mutating stored document data


## .value Semantics (Current Values)

For deterministic Active Effect keys ending in `.value` that target a current pool (HP, Magicka, Stamina, Luck Points, Action Points), the `.value` lane modifies the actor’s **current** value.

- If a `.value` modifier is present (ADD or OVERRIDE), the system allows the current value to exceed max (overcap) while the effect is active.
- Without a `.value` modifier, current values are clamped to `[0, max]`.
