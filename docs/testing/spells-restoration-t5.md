# T5-2: Restoration School — Spell → AE Mapping & Test Plan

**Scope:** Verify/create all conventional Restoration spells with correct AE change profiles.
**Source:** Chapter 6 — Magic (Restoration section, pp. 143–144)
**Engine Primitives:** modifier-registry.js (T3-A/T5), origin-effect.js (T1), overtime-engine.js (T4-A)

---

## Restoration Spells — Complete AE Mapping

### 1. Cure Disease
**Tags:** Instant
**Effect:** Removes disease condition from target. Higher SS cures more severe diseases.
**AE Profile:** None — condition removal automation.
**Spell Fields:**
- `school`: "restoration"
- `isInstant`: true
- `hasUpkeep`: false
- `isAttackSpell`: false
- `isDamagingSpell`: false

### 2. Cure Poison
**Tags:** Direct, Instant
**Effect:** Removes poisoned condition from target.
**AE Profile:** None — condition removal automation.
**Spell Fields:**
- `school`: "restoration"
- `isInstant`: true
- `isDirect`: true

### 3. Cure Paralysis
**Tags:** Direct, Instant
**Effect:** Removes paralysis/stunned condition from target.
**AE Profile:** None — condition removal automation.
**Spell Fields:**
- `school`: "restoration"
- `isInstant`: true
- `isDirect`: true

### 4. Fortify [Characteristic] (7 variants)
**Tags:** Upkeep, [Strength, Endurance, Agility, Intelligence, Willpower, Perception, Personality]
**Effect:** +[SS × 5] to chosen characteristic (upkeep)
**AE Profile (per variant):**
```
Fortify Strength:     Key: system.modifiers.characteristics.str  | Mode: ADD | Value: SS×5
Fortify Endurance:    Key: system.modifiers.characteristics.end  | Mode: ADD | Value: SS×5
Fortify Agility:      Key: system.modifiers.characteristics.agi  | Mode: ADD | Value: SS×5
Fortify Intelligence: Key: system.modifiers.characteristics.int  | Mode: ADD | Value: SS×5
Fortify Willpower:    Key: system.modifiers.characteristics.wp   | Mode: ADD | Value: SS×5
Fortify Perception:   Key: system.modifiers.characteristics.prc  | Mode: ADD | Value: SS×5
Fortify Personality:  Key: system.modifiers.characteristics.prs  | Mode: ADD | Value: SS×5
```
**CRITICAL:** Uses the corrected characteristic keys (`wp`, `prc`, `prs` — NOT `wil`, `per`, `cha`).
**Cost Table:** Level 1–7, Cost: 9/17/25/33/41/49/57, SS: 5/10/15/20/25/30/35
**Spell Fields:**
- `hasUpkeep`: true
- `isInstant`: false

### 5. Heal
**Tags:** Direct, Instant
**Effect:** Restores [SS × 2] HP to target.
**AE Profile:** None — direct HP modification via `requestUpdateDocument`.
**Cost Table:** Level 1–7, Cost: 6/8/10/12/14/16/18, SS: 2/4/6/8/10/12/14
**Spell Fields:**
- `isDirect`: true
- `isHealingSpell`: true
- `healAmount`: "SS × 2"
- `damageType`: "healing"

### 6. Heal Wound
**Tags:** Direct, Instant
**Effect:** Removes [SS] wound levels from target.
**AE Profile:** None — wound system automation.
**Cost Table:** Level 1–7, Cost: 3/5/7/9/11/13/15, SS: 2/4/6/8/10/12/14

### 7. Regeneration
**Tags:** Upkeep, Instant
**Effect:** Target regenerates [SS × 2] HP per round (OverTime HoT).
**AE Profile:** OverTime engine payload:
```
overTime.trigger: "turnStart"
overTime.payloadType: "healing"
overTime.formula: "SS × 2" (e.g., Level 1 → 4 HP/round)
overTime.cadenceEvery: 1
overTime.cadenceUnit: "rounds"
```
**Cost Table:** Level 1–7, Cost: 3/5/7/9/11/13/15, SS: 2/4/6/8/10/12/14
**Spell Fields:**
- `hasUpkeep`: true
- `isHealingSpell`: true
- `hasOverTime`: true

### 8. Resist [Type] (Fire/Frost/Shock/Poison)
**Tags:** Upkeep, Instant, [Fire, Frost, Shock, Poison]
**Effect:** +[SS] elemental resistance
**AE Profile (per variant):**
```
Resist Fire:    Key: system.resistance.fireR    | Mode: ADD | Value: SS
Resist Frost:   Key: system.resistance.frostR   | Mode: ADD | Value: SS
Resist Shock:   Key: system.resistance.shockR   | Mode: ADD | Value: SS
Resist Poison:  Key: system.resistance.poisonR  | Mode: ADD | Value: SS
```
**Cost Table:** Level 1–7, Cost: 3/5/7/9/11/13/15, SS: 1/2/3/4/5/6/7
**Note:** Also appears in Alteration as "Spell Resistance" with the same AE keys.

### 9. Resist Magic
**Tags:** Upkeep, Instant
**Effect:** +[SS] Magic Resistance
**AE Profile:**
```
Key: system.resistance.magicR   | Mode: ADD | Value: SS
```
**Cost Table:** Level 1–7, Cost: 5/9/13/17/21/25/29, SS: 1/2/3/4/5/6/7

### 10. Stabilize
**Tags:** Direct, Instant
**Effect:** Stabilizes a dying character (prevents death from bleeding out).
**AE Profile:** None — condition/state automation.
**Cost Table:** Level 1, Cost: 2

### 11. Turn Undead
**Tags:** Direct
**Effect:** Opposed WP test. Undead must flee if they fail. Higher SS = harder to resist.
**AE Profile:** None — behavioral automation (applies fear/flee condition to undead on failed test).
**Cost Table:** Level 1–7, Cost: 7/10/13/16/19/22/25, SS: +20/+10/+0/-10/-20/-30/-40

### 12. Ward
**Tags:** Reinforce, Instant (also Alteration)
**Effect:** Barrier with [SS + 5] HP. Same as Alteration Ward.
**AE Profile:** Barrier mechanic — deferred. Already defined in Alteration.
**Note:** Same item as Alteration Ward (dual school).

---

## Coverage Summary

| Category | Spells | Status |
|----------|--------|--------|
| **AE-Ready (modifier keys exist)** | Fortify [Char] ×7, Resist [Type] ×4, Resist Magic | ✅ Ready |
| **OverTime (HoT)** | Regeneration | ✅ Ready (T4 engine) |
| **Healing automation** | Heal, Heal Wound | ✅ No AE needed |
| **Non-AE (condition removal)** | Cure Disease, Cure Poison, Cure Paralysis, Stabilize | ✅ No AE needed |
| **Non-AE (behavioral)** | Turn Undead | ✅ No AE needed |
| **Barrier mechanic (deferred)** | Ward | ⏳ Same as Alteration |

---

## Test Matrix

### AE Application Tests

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | Fortify STR | AE `system.modifiers.characteristics.str` ADD 5 → cast on PC | STR increases by 5 |
| 2 | Fortify WP | AE `system.modifiers.characteristics.wp` ADD 10 → cast on PC | WP increases by 10 |
| 3 | Fortify PRC | AE `system.modifiers.characteristics.prc` ADD 15 → cast on PC | PRC increases by 15 |
| 4 | Resist Fire | AE `system.resistance.fireR` ADD 3 → cast on PC | Fire resistance +3 |
| 5 | Resist Magic | AE `system.resistance.magicR` ADD 2 → cast on PC | Magic resistance +2 |

### OverTime/Healing Tests

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 6 | Regeneration HoT | Cast Regeneration (Level 1) → advance round | Target gains 4 HP per round |
| 7 | Heal instant | Cast Heal (Level 3, SS 6) → check target HP | Target HP +12 |

### Condition Tests

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 8 | Cure Disease | Apply disease condition → cast Cure Disease | Disease condition removed |
| 9 | Cure Poison | Apply poisoned condition → cast Cure Poison | Poisoned condition removed |
| 10 | Stabilize | Set PC to dying → cast Stabilize | Dying state cleared |
