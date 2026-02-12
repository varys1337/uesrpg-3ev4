# Spellcasting Talents — Test Plan

## Overview

This document covers manual test procedures for all automated spellcasting talents
(Chapter 4). Each test assumes a clean system load with the UESRPG 3ev4 system on
Foundry VTT v13.351.

**Setup for all tests:**
1. Create (or use an existing) PC with at least one magic skill at Journeyman+ rank.
2. Ensure the actor has at least 50 Magicka and 3 AP available.
3. Assign Willpower ≥ 30 (WB 3) for predictable restraint math.

---

## 1. Elemental Specialist Talents

### 1.1 Pyromancer (+1 fire damage)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create PC; do NOT add Pyromancer talent | — |
| 2 | Cast a fire-damage spell at a target | Record base damage value |
| 3 | Add embedded Talent item named "Pyromancer" to PC | — |
| 4 | Cast the same fire-damage spell at a target | Damage total = base + 1 (elemental bonus appears in chat) |
| 5 | Cast a frost-damage spell | Damage unchanged (no bonus) |
| 6 | Cast a shock-damage spell | Damage unchanged (no bonus) |

### 1.2 Cryomancer (+1 frost damage)

Same as §1.1 but with frost-damage spells. Verify +1 frost only, no effect on fire/shock.

### 1.3 Electromancer (+1 shock damage)

Same as §1.1 but with shock-damage spells. Verify +1 shock only, no effect on fire/frost.

---

## 2. Spell Restraint Modifier Talents

### 2.1 Magicka Cycling (+2 WB for restraint)

| Step | Action | Expected |
|------|--------|----------|
| 1 | PC with WB 3, no Magicka Cycling talent | — |
| 2 | Cast a spell with Spell Restraint checked | Restraint reduction = 3 (WB) |
| 3 | Add Talent item "Magicka Cycling" to PC | — |
| 4 | Cast same spell with Spell Restraint | Restraint reduction = 5 (WB + 2) |
| 5 | Cast without Restraint | Cost unchanged (no Cycling benefit) |

### 2.2 Creative (+1 WB for unconventional restraint)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Add Talent "Creative" to PC | — |
| 2 | Cast an **unconventional** spell with Spell Restraint | Restraint WB = base WB + 1 |
| 3 | Cast a **conventional** spell with Spell Restraint | Restraint WB = base WB (no bonus) |

### 2.3 Methodical (+1 WB for conventional restraint)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Add Talent "Methodical" to PC (must NOT have Creative) | — |
| 2 | Cast a **conventional** spell with Spell Restraint | Restraint WB = base WB + 1 |
| 3 | Cast an **unconventional** spell with Spell Restraint | Restraint WB = base WB (no bonus) |

### 2.4 Combined: Magicka Cycling + Creative

| Step | Action | Expected |
|------|--------|----------|
| 1 | Add both "Magicka Cycling" and "Creative" talents | — |
| 2 | Cast unconventional spell with Restraint | Restraint WB = base WB + 3 (+2 Cycling, +1 Creative) |
| 3 | Cast conventional spell with Restraint | Restraint WB = base WB + 2 (+2 Cycling only) |

---

## 3. Master of Magicka (Overload + Restrain simultaneously)

| Step | Action | Expected |
|------|--------|----------|
| 1 | PC has a spell with the Overload attribute | — |
| 2 | Open casting dialog without Master of Magicka | Restrain and Overload checkboxes are mutually exclusive |
| 3 | Add Talent "Master of Magicka" to PC | — |
| 4 | Open casting dialog | Both Restrain AND Overload can be checked simultaneously |
| 5 | Cast with both checked | Spell applies overload effect AND grants restraint reduction on success |

---

## 4. Overcharge (roll damage 2×, keep highest)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Add Talent "Overcharge" to PC | — |
| 2 | Open casting dialog | "Overcharge (talent option)" checkbox appears |
| 3 | Cast damaging spell with Overcharge checked | Two damage rolls appear in chat; highest is used |
| 4 | Verify cost is doubled (after restraint if applicable) | Final MP cost = 2× normal |
| 5 | Cast non-damaging spell with Overcharge | Overcharge has no effect (no damage to double) |

---

## 5. Mage Guard (+1 Reinforce effect)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create a spell with the Reinforce attribute | — |
| 2 | Cast without Mage Guard talent | Reinforce effect = base value |
| 3 | Add Talent "Mage Guard" to PC | — |
| 4 | Cast the Reinforce spell WITHOUT restraining | Reinforce effect = base + 1 |
| 5 | Cast the Reinforce spell WITH restraining | Reinforce effect = base (Mage Guard requires no restraint) |

---

## 6. Arcane Defender (Reinforce → WB/2 round up)

| Step | Action | Expected |
|------|--------|----------|
| 1 | PC with WB 5 has both "Mage Guard" and "Arcane Defender" | — |
| 2 | Cast Reinforce spell without restraining | Reinforce bonus = ceil(5/2) = 3 total |
| 3 | Cast Reinforce spell while restraining | Reinforce bonus = 0 (requires no restraint) |
| 4 | Remove Mage Guard talent but keep Arcane Defender | — |
| 5 | Cast Reinforce spell | No bonus (Arcane Defender requires Mage Guard) |

---

## 7. Strong Willed (+1 DoS on Conjuration tests)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Cast a Conjuration spell without Strong Willed | Record DoS |
| 2 | Add Talent "Strong Willed" to PC | — |
| 3 | Cast same Conjuration spell | Profile talentModifiers shows conjurationBonusDoS: 1 |
| 4 | Cast a non-Conjuration spell (e.g. Destruction) | No DoS bonus in talentModifiers |

---

## 8. Seasoned Conjurer (use Conjuration rank as DoS)

| Step | Action | Expected |
|------|--------|----------|
| 1 | PC with Conjuration at Expert rank (4) and Seasoned Conjurer talent | — |
| 2 | Cast Conjuration spell; succeed with 2 DoS | May choose skill rank (4) instead of rolled DoS (2) |
| 3 | Profile talentModifiers shows: `conjurationUseSkillRank: true, conjurationSkillRankValue: 4` | — |

---

## 9. Control (negate backfire with Willpower test)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Add Talent "Control" to PC | — |
| 2 | Trigger a backfire (cast unconventional spell, fail) | Dialog appears asking to test Willpower |
| 3 | Succeed the Willpower test | "Backfire Negated" message in chat; no backfire effect |
| 4 | Fail the Willpower test | Normal backfire table resolved |
| 5 | Decline the Control prompt | Normal backfire proceeds |

---

## 10. Living Armory (AP instead of MP for upkeep)

| Step | Action | Expected |
|------|--------|----------|
| 1 | PC has "Living Armory" talent and a "Conjure Weapon" spell with Upkeep | — |
| 2 | Cast Conjure Weapon targeting self | Spell activates normally |
| 3 | When upkeep prompt appears | Prompt shows "Living Armory: Can pay 1 AP instead of X MP" |
| 4 | Click Upkeep with ≥ 1 AP available | 1 AP deducted (not MP); notification confirms Living Armory used |
| 5 | Repeat with 0 AP available | Falls back to MP payment as normal |
| 6 | Cast Conjure Weapon targeting another actor | Living Armory NOT offered (self-only restriction) |
| 7 | Cast non-Conjure spell with Upkeep | Living Armory NOT offered |

---

## 11. Activated Talents (Primed State)

### 11.1 Healer (activated)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Add Talent "Healer" to PC | — |
| 2 | Activate the Healer talent from the item sheet | Chat message confirms primed state; actor flag set |
| 3 | Check `actor.getFlag("uesrpg-3ev4", "spellcasting.primed")` | `{ slug: "healer", usesRemaining: 1, ... }` |
| 4 | Primed state persists until used or cleared | — |

### 11.2 Flow of Magicka (activated reaction)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Add Talent "Flow of Magicka" to PC | — |
| 2 | Activate from item sheet | Chat message: readies reaction; actor flag set |
| 3 | Flag value | `{ slug: "flowofmagicka", usesRemaining: 1, ... }` |

### 11.3 Bend Reality (activated)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Add Talent "Bend Reality" to PC | — |
| 2 | Activate from item sheet | Chat: may use Alteration in place of Athletics/Acrobatics; flag set |

---

## 12. Milestone-Dependent Talents (Stubs)

These talents produce a GM whisper warning when the actor has the talent but the required
subsystem is not yet implemented. They have no mechanical effect.

| Talent | Expected behavior |
|--------|-------------------|
| Bladecaller | GM whisper: "Requires Conjure Weapon spell framework" |
| Weapon Echo | GM whisper: "Requires Conjure Weapon spell framework" |
| Spell Sword | GM whisper: "Requires equipment interaction framework" |
| Unfettered Conjuration | GM whisper: "Requires summoning spell framework" |
| Taskmaster | GM whisper: "Requires Mindlock / summoning framework" |
| Master of the Hordes | GM whisper: "Requires Mindlock / summoning framework" |
| Void Channeler | GM whisper: "Requires summoned creature management" |
| The Mending Tides of Oblivion | GM whisper: "Requires summoned creature management" |

### Stub verification

| Step | Action | Expected |
|------|--------|----------|
| 1 | Add Talent "Bladecaller" to PC | — |
| 2 | Cast any spell | Check console: warning about missing Conjure Weapon framework |
| 3 | Check GM chat whispers | Warning message present with talent name and required subsystem |
| 4 | Spell casting proceeds normally (stub does not block) | — |

---

## 13. Double-Application Prevention

| Step | Action | Expected |
|------|--------|----------|
| 1 | PC has Pyromancer + a fire spell | — |
| 2 | Cast fire spell against single target | Elemental bonus = +1 (not +2) |
| 3 | Profile `talentModifiers.damageBonus` = 1 | — |
| 4 | Chat card damage shows elemental bonus once | — |
| 5 | Cast fire spell in AoE (shared damage) | All targets receive the same base + 1 damage |

---

## 14. Stale State Prevention

| Step | Action | Expected |
|------|--------|----------|
| 1 | PC activates "Overcharge" (primed state set) | — |
| 2 | Cast a damaging spell with Overcharge option | Primed state consumed |
| 3 | Check `actor.getFlag("uesrpg-3ev4", "spellcasting.primed")` | `null` or `undefined` |
| 4 | Cast another spell without activating Overcharge again | Normal casting (no Overcharge) |

---

## Deferred / GM Adjudication

| Talent | Reason |
|--------|--------|
| Bend Reality | Skill substitution (Alteration for Athletics/Acrobatics) is not part of casting pipeline; requires skill test system integration |
| Healer | Standalone ritual action outside the spell casting pipeline; requires dedicated ritual workflow |
| Flow of Magicka | Reaction counter-spell; requires integration with opposed magic defense system |
| Trickster | Skill substitution (Illusion for Deceive); same as Bend Reality |
| Thought Caster | Equipment/somatic requirement check not yet implemented |
| Depth of Understanding | Grants Power Well trait via item; no profile modifier needed |
