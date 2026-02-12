# T5-1: Alteration School — Spell → AE Mapping & Test Plan

**Scope:** Verify/create all conventional Alteration spells with correct AE change profiles.
**Source:** Chapter 6 — Magic (Alteration section, pp. 130–132)
**Engine Primitives:** modifier-registry.js (T3-A), origin-effect.js (T1), overtime-engine.js (T4-A)

---

## Files Modified (T5 Baseline)

| File | Change | Purpose |
|------|--------|---------|
| `src/core/active-effects/modifier-registry.js` | Fixed characteristic keys (`per→prc`, `wil→wp`, `cha→prs`, `luc→lck`); added 11 new keys | Correct registry + new AE lanes |
| `src/core/actors/prepare/ensure-system-data.js` | Init new modifier paths (flySpeed, swimSpeed, movement, stealth, magic defense, traits) | Safe defaults for new AE lanes |
| `src/core/actors/ae/modifiers.js` | Extended `getSpeedAEModifiers()` to return flySpeed and swimSpeed | AE consumption |
| `src/core/actors/prepare/character.js` | Consume flySpeed/swimSpeed AE modifiers in speed block | Character prepare pipeline |
| `src/core/actors/prepare/npc.js` | Same as character.js | NPC prepare pipeline |
| `docs/Active Effect Wiki.md` | Fixed characteristic keys; added sections 4.3–4.8 | Documentation |

---

## Alteration Spells — Complete AE Mapping

### 1. Armor
**Tags:** Upkeep, Reinforce, Instant
**Effect:** +[SS × 2] AR to all hit locations (upkeep)
**AE Profile:**
```
Key: system.modifiers.combat.armorRating
Mode: ADD
Value: SS × 2 (e.g., Level 3 → SS 3 → value 6)
```
**Spell Fields:**
- `school`: "alteration"
- `hasUpkeep`: true
- `hasReinforce`: true
- `isInstant`: true
- `isAttackSpell`: false
- `isDamagingSpell`: false

### 2. Burden
**Tags:** Upkeep, Direct (opposed WP test)
**Effect:** Target's Carry Rating reduced; target's Speed reduced
**AE Profile (on target):**
```
Key 1: system.modifiers.carry.bonus   | Mode: ADD | Value: -(SS × 10)
Key 2: system.modifiers.speed.bonus   | Mode: ADD | Value: -(SS)
```
**Spell Fields:**
- `hasUpkeep`: true
- `isDirect`: true
- `isAttackSpell`: true (opposed: caster WP vs target WP)

### 3. Feather
**Tags:** Upkeep, Instant
**Effect:** Doubles carry rating (SS 3 = × 2)
**AE Profile:**
```
Key: system.modifiers.carry.bonus   | Mode: ADD | Value: actor's base carry rating (effectively doubles it)
```
**Note:** At spell strength 3, this doubles carry. The AE should use ADD with a value equal to the target's current carry base. Since AEs are static values, the recommended approach is to set the value at cast-time based on the target's carry.base.
**Spell Fields:**
- `hasUpkeep`: true
- `isInstant`: true

### 4. Jump
**Tags:** Instant
**Effect:** Jump [SS] meters higher or further (one-time action bonus)
**AE Profile:** None — this is a per-action modifier, not a persistent AE.
**Implementation:** Chat message with distance value. No AE needed.

### 5. Levitate
**Tags:** Upkeep
**Effect:** Fly speed = [SS × 3] meters (upkeep)
**AE Profile:**
```
Key: system.modifiers.speed.flySpeed   | Mode: ADD | Value: SS × 3 (e.g., Level 3 → SS 3 → value 9)
```
**Spell Fields:**
- `hasUpkeep`: true
- `isInstant`: false
- `isAttackSpell`: false

### 6. Lock
**Tags:** Instant
**Effect:** Magically locks a door/container with lock rating = [SS × 2]
**AE Profile:** None — narrative automation (sets lock difficulty on target object).
**Implementation:** Chat message announcing lock rating.

### 7. Magic Armor
**Tags:** Upkeep, Reinforce, Instant
**Effect:** +[SS] Magic Resistance (upkeep)
**AE Profile:**
```
Key: system.resistance.magicR   | Mode: ADD | Value: SS (e.g., Level 3 → SS 3 → value 3)
```
**Spell Fields:**
- `hasUpkeep`: true
- `hasReinforce`: true
- `isInstant`: true

### 8. Magic Shield
**Tags:** Upkeep, Reinforce, Instant
**Effect:** Barrier with [SS + 5] HP absorbing magic damage. Barrier HP does not belong to target.
**AE Profile:** Barrier mechanic — not a standard modifier.
**Implementation Notes:**
- Creates a "barrier" AE with `flags.uesrpg-3ev4.barrier.hp = SS + 5`
- Barrier absorbs magic damage before it reaches the target
- If barrier HP > 0 at duration end: free upkeep refresh
- If barrier HP = 0: spell cannot be refreshed, must recast
- **Deferred:** Barrier HP tracking requires future engine work (not a modifier-only effect)

### 9. Open
**Tags:** Instant
**Effect:** Unlocks locks up to lock rating [SS × 2]
**AE Profile:** None — narrative automation.
**Implementation:** Chat message with effective lock rating overcome.

### 10. Repair
**Tags:** Upkeep, Instant
**Effect:** Restores [SS] points of item durability per round
**AE Profile:** None — item automation (modifies item durability, not actor stats).
**Implementation:** If item durability system exists, creates OverTime effect on the item.

### 11. Shield
**Tags:** Upkeep, Reinforce, Instant
**Effect:** Barrier with [SS + 5] HP absorbing physical damage. Same barrier mechanic as Magic Shield.
**AE Profile:** Barrier mechanic — deferred (same as Magic Shield).
**Implementation Notes:** Same as Magic Shield but absorbs physical damage only.

### 12. Slowfall
**Tags:** Upkeep, Instant
**Effect:** Reduces fall damage by [SS × 2] meters equivalent
**AE Profile:**
```
Key: system.modifiers.movement.fallDamage   | Mode: ADD | Value: SS × 2 (meters of fall negated)
```
**Spell Fields:**
- `hasUpkeep`: true
- `isInstant`: true

### 13. Spell Resistance (Fire/Frost/Shock/Poison variant)
**Tags:** Upkeep, Reinforce, Instant, [Fire, Frost, Shock, Poison]
**Effect:** +[SS] resistance to chosen element type
**AE Profile (per variant):**
```
Key: system.resistance.fireR    | Mode: ADD | Value: SS   (Fire variant)
Key: system.resistance.frostR   | Mode: ADD | Value: SS   (Frost variant)
Key: system.resistance.shockR   | Mode: ADD | Value: SS   (Shock variant)
Key: system.resistance.poisonR  | Mode: ADD | Value: SS   (Poison variant)
```
**Note:** Each variant is a separate spell item in the compendium (e.g., "Spell Resistance (Fire)").

### 14. Spell Absorption (Fire/Frost/Shock/Poison variant)
**Tags:** Upkeep, Reinforce, Instant, [Fire, Frost, Shock, Poison]
**Effect:** Absorbs incoming elemental damage of chosen type as MP recovery (SS = level threshold)
**AE Profile:**
```
Key: system.modifiers.magic.spellAbsorption   | Mode: ADD | Value: SS
```
**Note:** Absorption is checked during damage application workflow. The AE sets the level threshold; the damage pipeline must check `actor.system.modifiers.magic.spellAbsorption > 0` and route accordingly.
**Implementation Notes:**
- Barrier-like mechanic: spell damage of matching type converts to MP gain
- If barrier HP depleted: spell ends (same as Shield/Magic Shield barrier rules)
- **Deferred:** Full absorption routing requires damage pipeline integration

### 15. Water Breathing
**Tags:** Upkeep, Instant
**Effect:** Can breathe underwater (boolean state)
**AE Profile:**
```
Key: system.traits.movement.waterBreathing   | Mode: ADD | Value: 1 (boolean true)
```
**Spell Fields:**
- `hasUpkeep`: true
- `isInstant`: true

### 16. Water Walking
**Tags:** Upkeep, Instant
**Effect:** Can walk on water surface (boolean state)
**AE Profile:**
```
Key: system.traits.movement.waterWalking   | Mode: ADD | Value: 1 (boolean true)
```
**Spell Fields:**
- `hasUpkeep`: true
- `isInstant`: true

### 17. Ward
**Tags:** Reinforce, Instant (also a Restoration spell)
**Effect:** Barrier with [SS + 5] HP. Absorbs all damage types.
**AE Profile:** Barrier mechanic — deferred (same as Shield/Magic Shield).
**Note:** Ward appears in both Alteration and Restoration schools. Single spell item, dual school tag.
**Spell Fields:**
- `hasReinforce`: true
- `isInstant`: true
- Power Block is incompatible with this spell

---

## Coverage Summary

| Category | Spells | Status |
|----------|--------|--------|
| **AE-Ready (modifier keys exist)** | Armor, Burden, Feather, Levitate, Magic Armor, Slowfall, Spell Resistance (×4), Water Breathing, Water Walking | ✅ Ready |
| **Non-AE (automation/chat only)** | Jump, Lock, Open, Repair | ✅ No AE needed |
| **Barrier mechanic (deferred)** | Shield, Magic Shield, Spell Absorption, Ward | ⏳ Needs barrier HP engine |

---

## Test Matrix

### AE Application Tests

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | Armor AE applies | Create spell "Armor" with AE `system.modifiers.combat.armorRating` ADD 6 → cast on PC | Actor AR increases by 6 |
| 2 | Levitate grants fly speed | Create spell with AE `system.modifiers.speed.flySpeed` ADD 9 → cast on PC | `actor.system.speed.flySpeed` = 9 (or base + 9) |
| 3 | Magic Armor adds magic resistance | Create spell with AE `system.resistance.magicR` ADD 3 → cast on PC | `actor.system.resistance.magicR` increases by 3 |
| 4 | Spell Resistance (Fire) | AE `system.resistance.fireR` ADD 3 → cast on PC | Fire resistance +3 |
| 5 | Water Breathing flag | AE `system.traits.movement.waterBreathing` ADD 1 → cast on PC | `actor.system.traits.movement.waterBreathing` = true |
| 6 | Slowfall reduction | AE `system.modifiers.movement.fallDamage` ADD 6 → cast on PC | Fall damage modifier = 6 |
| 7 | Burden reduces carry + speed | AE on target: `system.modifiers.carry.bonus` ADD -30, `system.modifiers.speed.bonus` ADD -3 | Target carry -30, speed -3 |

### Upkeep Integration Tests

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 8 | Armor upkeep prompt | Cast Armor → advance time → upkeep window | Upkeep dialog appears; pay MP refreshes AE |
| 9 | Levitate upkeep expiry | Cast Levitate → decline upkeep | Fly speed returns to baseline |

### Non-AE Spell Tests

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 10 | Jump chat output | Cast Jump (SS 3) | Chat: "Jump 3 meters higher/further" |
| 11 | Open chat output | Cast Open (SS 3) | Chat: "Opens locks up to rating 6" |
