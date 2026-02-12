# T5-5: Mysticism School — Spell → AE Mapping

**School:** Mysticism  
**Source:** Chapter 6 — Magic (pp.140-141)  
**Total spells:** 14 (including 7 Absorb [Char] variants)

## Spell Inventory

| # | Spell | Tags | Cost (L1-7) | SS (L1-7) | Duration |
|---|---|---|---|---|---|
| 1-7 | Absorb [Characteristic] ×7 | Ranged (100m), Upkeep | 10/18/26/34/42/50/58 | 5/10/15/20/25/30/35 | Upkeep |
| 8 | Absorb Life | Melee (1m), Attack, Overload | 4/7/10/13/16/19/22 | 1d4-2d10 | Instant |
| 9 | Absorb Magicka | Direct | 7/10/13/16/19/22/25 | 1d4-2d10 | Instant |
| 10 | Detect [Type] | Upkeep, Instant | 6/11/16/21/26/31/36 | 10-70m range | Upkeep |
| 11 | Dispel | — | 5/9/13/17/21/25/29 | 1-7 | Instant |
| 12 | Intervention | Upkeep | 11 (L4 only) | — | Upkeep |
| 13 | Mark | — | 6 | — | Permanent |
| 14 | Recall | Instant | 16 (L3 only) | — | Instant |
| 15 | Reflect | Upkeep, Instant | 4/7/10/13/16/19/22 | 1-7 | Upkeep |
| 16 | Soul Trap | Upkeep, Direct | 16 (L2 only) | — | Upkeep |
| 17 | Spell Absorption | Upkeep, Instant | 4/7/10/13/16/19/22 | 1-7 | Upkeep |
| 18 | Sunder Binding | Direct (also Conjuration) | 5/6/7/8/9/10/11 | +20/+10/0/-10/-20/-30/-40 | Instant |
| 19 | Telekinesis | Upkeep, Instant | 4/7/10/13/16/19/22 | 1-7 | Upkeep |
| 20 | Telepathy | Upkeep, Instant | 4/7/10/13/16/19/22 | 1-7 | Upkeep |

---

## AE Profile Mapping

### Category 1: Paired AE Buffs/Debuffs — AE-Ready (7 spells)

Absorb [Characteristic] creates **two linked AEs** with a shared origin:
- **Target debuff**: reduces characteristic by SS
- **Caster buff**: increases same characteristic by SS

| Spell | Target AE Key | Caster AE Key | Mode | Value (L1) |
|---|---|---|---|---|
| Absorb Strength | `system.modifiers.characteristics.str` | same | ADD | -5 (target) / +5 (caster) |
| Absorb Endurance | `system.modifiers.characteristics.end` | same | ADD | -5 / +5 |
| Absorb Agility | `system.modifiers.characteristics.agi` | same | ADD | -5 / +5 |
| Absorb Intelligence | `system.modifiers.characteristics.int` | same | ADD | -5 / +5 |
| Absorb Willpower | `system.modifiers.characteristics.wp` | same | ADD | -5 / +5 |
| Absorb Perception | `system.modifiers.characteristics.prc` | same | ADD | -5 / +5 |
| Absorb Personality | `system.modifiers.characteristics.prs` | same | ADD | -5 / +5 |

> **Note**: The macro embeds only the **target debuff AE**. The paired caster buff is handled at cast-time by `applySpellEffectsToTarget()` or the casting service. If reflected, the spell has no net effect (RAW).

### Category 2: Magic Defense AEs — AE-Ready (2 spells)

| Spell | AE Key | Mode | Value (L1) | Effect |
|---|---|---|---|---|
| Reflect | `system.modifiers.magic.spellReflect` | ADD | `1` | Reflects spells of level ≤ SS back at caster |
| Spell Absorption | `system.modifiers.magic.spellAbsorption` | ADD | `1` | Absorbs spells of level ≤ SS, converting cost to MP |

### Category 3: Damage + Self-Heal — No Persistent AE (2 spells)

| Spell | damageType | damageFormula | Healing | Notes |
|---|---|---|---|---|
| Absorb Life | magic | 1d4 (L1) | Self-heal = damage dealt | Attack + Overload. Melee range only |
| Absorb Magicka | magic | 1d4 (L1) | Self-MP = amount drained | Direct. Drains MP from target, gives to caster |

### Category 4: Utility / Service Spells — No Modifier AE (7 spells)

| Spell | Mechanism | Notes |
|---|---|---|
| Detect [Type] | Service: returns targets within SS×10m | Variants: Life, Undead, Magic, other. UI: chat + token highlight |
| Dispel | Service: removes spell AEs from target | SS = max spell level removable. Uses origin teardown |
| Intervention | Teleport to nearest temple/shrine | L4 only _cost 11. Upkeep duration |
| Mark | Places teleport anchor | Stored as flag. Max = INT Bonus anchors |
| Recall | Teleports to Mark location | L3 only, cost 16. Instant |
| Telekinesis | Manipulate objects at range | SS = weight category. Utility only |
| Telepathy | Mental communication | SS = range multiplier. No combat effect |

### Category 5: Anti-Summon (1 spell)

| Spell | Mechanism | Notes |
|---|---|---|
| Sunder Binding | Opposed WP test vs summoned creature | SS modifies WP test TN (+20 to -40). Also a Conjuration spell |

---

## Coverage Summary

| Category | Count | AE Required? | Status |
|---|---|---|---|
| Paired Absorb [Char] ×7 | 7 | Yes (target debuff AE) | ✅ Keys exist |
| Magic Defense (Reflect, Spell Absorption) | 2 | Yes | ✅ Keys exist |
| Damage + Self-Heal (Absorb Life/Magicka) | 2 | No (damage pipeline) | ✅ Damage pipeline |
| Utility/Service (Detect, Dispel, Mark, etc.) | 7 | No | ✅ Service-layer |
| Anti-Summon (Sunder Binding) | 1 | No | ✅ WP test workflow |
| **Total** | **19** (14 unique + 5 variants) | **9 AE-capable** | |

---

## Framework Deferred Items

1. **Paired AE creation** (Absorb [Char]): `applySpellEffectsToTarget()` needs paired-buff logic — create caster buff AE alongside target debuff, linked by origin. Phase 6 enhancement.
2. **Spell Absorption damage pipeline check**: Damage pipeline must check `system.modifiers.magic.spellAbsorption` before applying spell damage. Central implementation, Phase 6.
3. **Dispel service**: `dispel-service.js` exists but needs integration with origin teardown + SS-based strength threshold policy. 
4. **Soul Trap death hook**: On-death hook checking for Soul Trap marker, creates soul gem item. Permission-safe, idempotent. Phase 6.
5. **Mark/Recall anchor storage**: Flag-based teleport anchor system with INT Bonus cap. Phase 6.
6. **Detect service**: Query actors within range by type, provide chat + token highlight feedback. Phase 6.

---

## Test Matrix

| # | Test Case | Spells | Validation |
|---|---|---|---|
| 1 | Absorb Strength L2 paired | Absorb Strength | Target -10 STR, caster +10 STR. Both clean on origin teardown |
| 2 | Absorb Willpower L1 on reflect | Absorb Willpower | If target has Reflect, no net effect (RAW) |
| 3 | Absorb Life L3 damage + heal | Absorb Life | 1d8 magic damage to target, caster heals same amount |
| 4 | Absorb Magicka L2 drain | Absorb Magicka | 1d6 MP drained from target, given to caster |
| 5 | Reflect L4 active | Reflect | Caster gets spellReflect = 4; spells L4 or below reflected |
| 6 | Spell Absorption L3 active | Spell Absorption | Caster gets spellAbsorption = 3; spells L3 or below absorbed as MP |
| 7 | Dispel L5 removes effect | Dispel | Removes spell effects of L5 or below from target |
| 8 | Soul Trap L2 on death | Soul Trap | Target dies → soul captured in gem. Triggers only once |
| 9 | Mark + Recall roundtrip | Mark, Recall | Mark stores position → Recall teleports caster back |
| 10 | Sunder Binding L3 | Sunder Binding | Opposed WP test vs summoned creature, TN +0 |
