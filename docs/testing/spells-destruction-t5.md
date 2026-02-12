# T5-3: Destruction School — Spell → AE Mapping

**School:** Destruction  
**Source:** Chapter 6 — Magic (pp.135-137)  
**Total spells:** 34 individual (8 [Type] templates × 3 elements + 10 standalone)

## Spell Inventory

### Parameterized [Type] Template Spells

Each template generates 3 variants: Fire, Frost, Shock (= 24 spells).

| Template | Range/AoE | Tags | Cost (L1-7) | SS (L1-7) |
|---|---|---|---|---|
| [Type] Bolt | Ranged (100m) | Attack, Overload | 4/6/8/10/12/14/16 | 1d4/1d6/1d8/1d10/2d6/2d8/2d10 |
| [Type] Touch | Melee (1m) | Attack, Overload | 3/5/7/9/11/13/15 | 1d4/1d6/1d8/1d10/2d6/2d8/2d10 |
| [Type] Ball | AoE (2m sphere) | Attack, Overload | 8/10/12/14/16/18/20 | 1d4/1d6/1d8/1d10/2d6/2d8/2d10 |
| [Type] Beam | AoE (30m beam) | Attack, Overload | 10/13/16/19/22/25/29 | 1d4/1d6/1d8/1d10/2d6/2d8/2d10 |
| [Type] Cone | AoE (5m cone) | Attack, Overload | 9/11/13/15/17/19/21 | 1d4/1d6/1d8/1d10/2d6/2d8/2d10 |
| [Type] Cloak | Self (1m aura) | Upkeep, Overload | 6/8/10/12/14/16/18 | 1d4/1d6/1d8/1d10/2d6/2d8/2d10 |
| [Type] Rune | Placed trap (3m burst) | Overload, isRuneSpell | 9/11/13/15/17/19/21 | 1d4/1d6/1d8/1d10/2d6/2d8/2d10 |
| [Type] Storm | AoE (7m sphere) | Attack, Upkeep, isZonePersistent | 9/11/13/15/17/19/21 | [Type] damage per round |

### Standalone Spells (10 spells)

| Spell | Range/AoE | Tags | Cost (L1-7) | SS (L1-7) |
|---|---|---|---|---|
| Chain Lightning | Ranged (50m) | Attack, Overload, Shock | 9/11/13/15/17/19/21 | 1d4/1d6/1d8/1d10/2d6/2d8/2d10 |
| Disintegrate Armor | Ranged (100m) | Attack | 6/10/14/18/22/26/30 | 1/2/3/4/5/6/7 |
| Disintegrate Weapon | Ranged (100m) | Attack | 6/10/14/18/22/26/30 | 1/2/3/4/5/6/7 |
| Drain Magicka | Upkeep, Direct | Upkeep | 6/8/10/12/14/16/18 | 4/8/12/16/20/24/28 |
| Enervation | Direct, Attack | Upkeep, Direct | 6/8/10/12/14/16/18 | +20/+10/+0/-10/-20/-30/-40 |
| Weakness to Fire | Upkeep, Direct | Debuff | 5/6/7/8/9/10/11 | 1/2/3/4/5/6/7 |
| Weakness to Frost | Upkeep, Direct | Debuff | 5/6/7/8/9/10/11 | 1/2/3/4/5/6/7 |
| Weakness to Shock | Upkeep, Direct | Debuff | 5/6/7/8/9/10/11 | 1/2/3/4/5/6/7 |
| Weakness to Poison | Upkeep, Direct | Debuff | 5/6/7/8/9/10/11 | 1/2/3/4/5/6/7 |
| Weakness to Magic | Upkeep, Direct | Debuff | 7/10/13/16/19/22/25 | 1/2/3/4/5/6/7 |

---

## AE Profile Mapping

### Category 1: Pure Damage — No Persistent AE (15 spells)

These spells deal instant damage via the damage pipeline. No AE changes are embedded; the damage roll is resolved at cast time.

| Spell (×3 variants) | damageType | damageFormula (L1) | Notes |
|---|---|---|---|
| [Type] Bolt | fire/frost/shock | 1d4 | Standard ranged attack |
| [Type] Touch | fire/frost/shock | 1d4 | Melee range, +WB overload |
| [Type] Ball | fire/frost/shock | 1d4 | AoE 2m sphere |
| [Type] Beam | fire/frost/shock | 1d4 | AoE 30m beam |
| [Type] Cone | fire/frost/shock | 1d4 | AoE 5m cone |

### Category 2: Damage + Upkeep Zone (6 spells)

Persistent damage effects maintained via upkeep. No AE modifier changes, but use zone/cloak system flags for persistence.

| Spell (×3 variants) | System Fields | Notes |
|---|---|---|
| [Type] Cloak | `hasUpkeep: true`, `hasOverload: true` | Self-centered 1m aura, damages nearby each round |
| [Type] Storm | `hasUpkeep: true`, `isZonePersistent: true`, `aoeSize: 7` | 7m sphere zone, damages all within each round |

### Category 3: Rune/Trap Spells (3 spells)

Use `isRuneSpell: true` with trigger configuration. Damage on detonation.

| Spell (×3 variants) | System Fields | Notes |
|---|---|---|
| [Type] Rune | `isRuneSpell: true`, `runeTriggerType: "proximity"`, `runeTriggerRadius: 3` | Placed trap, 3m burst on trigger |

### Category 4: Chain Spell — No AE (1 spell)

| Spell | damageType | Notes |
|---|---|---|
| Chain Lightning | shock | Bounces to additional targets. Chain count = SS |

### Category 5: Equipment Degradation — No AE (2 spells)

Attack spells that reduce target equipment durability. Not AE-driven; resolved via opposed combat workflow + item damage pipeline.

| Spell | Target | Notes |
|---|---|---|
| Disintegrate Armor | Target's equipped armor | Reduces AR by SS per successful hit |
| Disintegrate Weapon | Target's equipped weapon | Reduces weapon condition by SS per hit |

### Category 6: AE Debuff — Resistance Reduction (5 spells)

These apply **negative resistance** AE changes to the target, making them more vulnerable.

| Spell | AE Key | Mode | Value (L1) | Effect |
|---|---|---|---|---|
| Weakness to Fire | `system.resistance.fireR` | ADD | `-1` | Reduces Fire Resistance by SS |
| Weakness to Frost | `system.resistance.frostR` | ADD | `-1` | Reduces Frost Resistance by SS |
| Weakness to Shock | `system.resistance.shockR` | ADD | `-1` | Reduces Shock Resistance by SS |
| Weakness to Poison | `system.resistance.poisonR` | ADD | `-1` | Reduces Poison Resistance by SS |
| Weakness to Magic | `system.resistance.magicR` | ADD | `-1` | Reduces Magic Resistance by SS |

### Category 7: AE Debuff — Drain / Enervation (2 spells)

| Spell | Mechanism | AE Key | Notes |
|---|---|---|---|
| Drain Magicka | OverTime drain | `system.magicka.max` ADD -SS | Reduces max MP by SS per round (upkeep). OverTime payloadType "magickaDrain" — needs engine extension |
| Enervation | Debuff tests | `system.modifiers.tests.all` ADD SS | SS is +20/+10/0/-10/-20/-30/-40. Positive = easier resist, negative = harder resist. Targets combat effectiveness |

---

## Coverage Summary

| Category | Count | AE Required? | Status |
|---|---|---|---|
| Pure Damage (Bolt/Touch/Ball/Beam/Cone) | 15 | No | ✅ Damage pipeline |
| Damage + Upkeep (Cloak/Storm) | 6 | No (zone/flags) | ✅ Zone system |
| Rune/Trap | 3 | No (rune system) | ✅ Rune triggers |
| Chain Lightning | 1 | No | ✅ Damage + chain logic |
| Equipment Damage | 2 | No | ✅ Item damage pipeline |
| Weakness to [Type/Magic] | 5 | **Yes** (negative resistance) | ✅ Keys exist |
| Drain Magicka | 1 | **Yes** (OverTime) | ⚠️ Needs `magickaDrain` payloadType |
| Enervation | 1 | **Yes** (test modifier) | ✅ `tests.all` key exists |
| **Total** | **34** | **7 AE-Ready** | |

---

## Test Matrix

| # | Test Case | Spells | Validation |
|---|---|---|---|
| 1 | Fire Bolt L1 damage | Fire Bolt | Deals 1d4 fire damage to single target at 100m |
| 2 | Frost Ball L3 AoE | Frost Ball | Deals 1d8 frost to all targets in 2m sphere |
| 3 | Shock Beam L5 line | Shock Beam | Deals 2d6 shock in 30m beam |
| 4 | Fire Cone L2 | Fire Cone | Deals 1d6 fire in 5m cone |
| 5 | Frost Cloak L1 upkeep | Frost Cloak | 1d4 frost/round to nearby; remove on end upkeep |
| 6 | Shock Storm L4 zone | Shock Storm | 7m persistent zone, 1d10 shock/round |
| 7 | Fire Rune trigger | Fire Rune | Place rune → triggered by proximity → 1d4 fire in 3m burst |
| 8 | Weakness to Fire L3 | Weakness to Fire | Target gets -3 Fire Resistance (AE on target actor) |
| 9 | Weakness to Magic L5 | Weakness to Magic | Target gets -5 Magic Resistance |
| 10 | Chain Lightning L2 | Chain Lightning | 1d6 shock → chain to adjacent target |
| 11 | Disintegrate Armor L4 | Disintegrate Armor | Reduces target armor condition by SS 4 |
| 12 | Drain Magicka L3 upkeep | Drain Magicka | Target loses 12 MP/max per round while maintained |
| 13 | Enervation L5 debuff | Enervation | Target gets -20 to combat tests |
| 14 | Overload mechanic | Any [Type] spell with Overload | +WB to damage when overloaded |

---

## Notes

- **Overload**: Most Destruction spells have `hasOverload: true` with `overloadEffect: "+WB to Dmg"`. The `overloadBonusDamage` field stores the formula.
- **Dice SS**: Unlike most other schools where SS is a flat numeric value, Destruction damage spells use dice formulas (1d4→2d10). The `damageFormula` field in the spell data model stores the current level's dice, and `scaling.levels[].spellStr` stores the dice formula string.
- **Storm persistence**: [Type] Storm uses `isZonePersistent: true` + `hasUpkeep: true`. The zone remains and deals damage each round to all targets caught within or ending their turn in it.
- **Rune triggers**: [Type] Rune uses `isRuneSpell: true` with `runeTriggerType` (proximity/time/manual) and `runeTriggerRadius: 3`.
- **Drain Magicka OverTime**: Current OverTime engine supports "damage" and "healing" payloadTypes. Drain Magicka needs a "magickaDrain" payloadType extension to the engine. For now the spell is created without OverTime config; the engine extension is a Phase 6 task.
