# Damage Mitigation Audit

## Summary
The UESRPG 3ev4 system has a comprehensive damage mitigation pipeline with proper separation of concerns. Physical damage mitigation works correctly; spell damage mitigation has a critical gap where Magic AR is ignored for elemental spells.

## 1. Canonical Damage Types

**File:** `src/core/combat/damage/types.js`

```javascript
export const DAMAGE_TYPES = {
  HEALING: "healing",
  PHYSICAL: "physical",
  FIRE: "fire",
  FROST: "frost",
  SHOCK: "shock",
  POISON: "poison",
  MAGIC: "magic",
  SILVER: "silver",
  SUNLIGHT: "sunlight",
};
```

## 2. Mitigation Stage Pipeline

### Stage 1: Hit Location & Coverage Normalization
**File:** `src/core/combat/damage/reduction.js` → `getDamageReduction()`

**Inputs:**
- `actor` – Target actor
- `damageType` – One of DAMAGE_TYPES
- `hitLocation` – "Head", "Body", "RightArm", etc.
- `options.ignoreNonMagicArmor` – Incorporeal attack flag

**Coverage Resolver:**
```javascript
// Armor items define coverage via:
// 1. system.category (head/body/l_arm/r_arm/l_leg/r_leg/shield)
// 2. system.hitLocations (boolean map)
// 3. system.armorClass (partial vs full)

// Normalization:
// - Full armor: category is authoritative
// - Partial armor: if all hitLocations === true (legacy default), use category
// - Otherwise: only explicit true values count
```

### Stage 2: Physical Damage Mitigation
**Applies when:** `damageType === DAMAGE_TYPES.PHYSICAL`

**Mitigation sources:**
1. **Armor Rating (AR)** – From equipped armor items covering the hit location
   - Uses `item.system.armorEffective` (derived, accounts for Damaged quality)
   - Only counts items where `equipped === true` and `isShield === false`
   - Coverage: item must cover the hit location (via category or hitLocations map)
   - Prone adjustment: Full armor treated as Partial
   - Wall of Steel: +1 AR to all worn armor

2. **Physical Resistance** – `actor.system.resistance.physicalR`

3. **Natural Toughness** – `actor.system.resistance.natToughness`

**Formula:**
```javascript
totalMitigation = armor + resistance + toughness
```

**Special case — Incorporeal attackers:**
- If `options.ignoreNonMagicArmor === true`, only armor items with `isItemMagicSource() === true` contribute AR
- `isItemMagicSource()` checks: material magic AR, runed, charges, Magic/Silver quality tokens

### Stage 3: Non-Physical Damage Mitigation
**Applies when:** `damageType !== DAMAGE_TYPES.PHYSICAL`

**Mitigation sources:**
1. **Typed AR** – From equipped armor items covering the hit location
   - **Special AR:** `item.system.special_ar_type` + `item.system.special_arEffective`  
     Example: Stalhrim armor has `special_ar_type: "frost"`, `special_ar: 6`
   - **Magic AR:** `item.system.magic_arEffective` (only for `damageType === "magic"`)
   - Only counts items where `equipped === true` and `isShield === false`
   - Coverage: same rules as physical

2. **Typed Resistance** – From actor traits/Active Effects
   - Fire: `actor.system.resistance.fireR`
   - Frost: `actor.system.resistance.frostR`
   - Shock: `actor.system.resistance.shockR`
   - Poison: `actor.system.resistance.poisonR`
   - Magic: `actor.system.resistance.magicR`
   - Silver: `actor.system.resistance.silverR`
   - Sunlight: `actor.system.resistance.sunlightR`

3. **Natural Toughness** – `actor.system.resistance.natToughness` (applies to ALL damage types)

**Formula:**
```javascript
armor = 0;
// For each equipped armor covering hitLocation:
//   if (special_ar_type === damageType) armor += special_arEffective
//   if (damageType === "magic") armor += magic_arEffective

totalMitigation = armor + resistance + toughness
```

### Stage 4: Active Effects Modifiers
**File:** `src/core/combat/damage/reduction.js` lines 310-380

**Applied after base mitigation:**
- **Armor Rating modifiers:** `system.modifiers.combat.armorRating` (global), `system.modifiers.combat.armorRating.<Location>` (location-specific)
- **Resistance modifiers:** `system.modifiers.resistance.<type>` (additive)
- **Natural Toughness modifiers:** `system.modifiers.resistance.natToughness`

**Example:**
```javascript
// Temporary "Stoneskin" effect grants +5 AR to all locations
ActiveEffect.changes = [{ key: "system.modifiers.combat.armorRating", mode: ADD, value: 5 }]
```

### Stage 5: Damage Application
**File:** `src/core/combat/damage/apply.js` → `applyDamage()`

**Inputs:**
- `actor` – Target actor
- `baseDamage` – Raw damage value
- `damageType` – Damage type constant
- `options` – Context (hitLocation, source, ignoreReduction, etc.)

**Process:**
1. If `options.ignoreReduction === false` (default):
   - Call `getDamageReduction(actor, damageType, hitLocation)`
   - Subtract `total` mitigation from `baseDamage`
2. Apply min 0 clamp: `finalDamage = Math.max(0, baseDamage - mitigation)`
3. Subtract from HP: `newHP = currentHP - finalDamage`
4. Check wound threshold: if `finalDamage > woundThreshold`, apply wound
5. Generate chat card with breakdown

## 3. Spell Damage Pathways

### Pathway A: Pure Magic Damage (magic type)
**File:** `src/core/magic/damage-application.js` → `applyMagicDamage()`

**When:** `spell.system.damageType === "magic"` OR unspecified

**Flow:**
```javascript
applyMagicDamage(actor, damage, "magic", spell, options)
  → applyDamage(actor, damage, "magic", { ...options, magicSource: true })
    → getDamageReduction(actor, "magic", hitLocation)
      → armor = sum(magic_arEffective from equipped armor)
        resistance = actor.system.resistance.magicR
        toughness = actor.system.resistance.natToughness
      → total = armor + resistance + toughness
    → finalDamage = damage - total
```

**✅ STATUS:** Correctly applies Magic AR

### Pathway B: Elemental Damage (fire/frost/shock)
**File:** `src/core/magic/damage-application.js` → `applyMagicDamage()`

**When:** `spell.system.damageType === "fire" | "frost" | "shock"`

**Current Flow (BROKEN):**
```javascript
applyMagicDamage(actor, damage, "fire", spell, options)
  → isElementalSpell = true
  → elementalReduction = getDamageReduction(actor, "fire", hitLocation)
     → armor = sum(special_ar where type === "fire")  // e.g., Stalhrim frost AR
     → resistance = actor.system.resistance.fireR
     → total = armor + resistance + toughness
  → ❌ elementalResistance = elementalReduction.resistance  // IGNORES .armor!
  
  → magicReduction = getDamageReduction(actor, "magic", hitLocation)
     → armor = sum(magic_arEffective)                      // e.g., 6 from Daedric
     → resistance = actor.system.resistance.magicR
     → total = armor + resistance + toughness
  → ❌ magicResistance = magicReduction.resistance          // IGNORES .armor!
  
  → afterElemental = damage - elementalResistance
  → finalDamage = afterElemental - magicResistance
  → applyDamage(actor, finalDamage, "fire", { ignoreReduction: true })
```

**❌ STATUS:** Magic AR is computed but ignored; only resistances are applied

**Expected Flow (CORRECT):**
```javascript
applyMagicDamage(actor, damage, "fire", spell, options)
  → elementalReduction = getDamageReduction(actor, "fire", hitLocation)
  → ✅ elementalTotal = elementalReduction.total  // armor + resistance + toughness
  
  → magicReduction = getDamageReduction(actor, "magic", hitLocation)
  → ✅ magicTotal = magicReduction.total          // Magic AR + magic resistance + toughness
  
  → afterElemental = damage - elementalTotal
  → finalDamage = afterElemental - magicTotal
  → applyDamage(actor, finalDamage, "fire", { ignoreReduction: true })
```

### Pathway C: Physical Spell Damage (rare)
**Examples:** Conjure Weapon summons, telekinesis attacks

**Flow:**
```javascript
applyMagicDamage(actor, damage, "physical", spell, options)
  → applyDamage(actor, damage, "physical", { ...options, magicSource: true })
    → getDamageReduction(actor, "physical", hitLocation)
      → armor = sum(armorEffective from equipped armor)
        resistance = actor.system.resistance.physicalR
        toughness = actor.system.resistance.natToughness
```

**✅ STATUS:** Works correctly (uses standard physical mitigation)

## 4. Shield Block Mechanics

**File:** `src/core/combat/opposed/defense.js` (not audited in detail)

**Notes:**
- Shields contribute Block Rating (BR), not Armor Rating (AR)
- Shield Magic BR applies when blocking magical attacks
- Shields are excluded from AC status and speed penalty derivation
- Tower shields have -1 Speed penalty (legacy hardcoded path in actor.js)

## 5. Critical Findings

### Finding 1: Elemental spell Magic AR bypass (CRITICAL)
**Severity:** High  
**Impact:** Players with expensive magic armor (Daedric, Dragonbone) receive no benefit against elemental spells  
**Location:** `src/core/magic/damage-application.js` lines 202-234  
**Fix:** Use `.total` instead of `.resistance` when extracting mitigation values

### Finding 2: Double-counting Natural Toughness (LOW RISK)
**Current behavior:**
- For elemental spells, `getDamageReduction()` includes toughness in both elemental and magic totals
- The layered subtraction (`damage - elementalTotal - magicTotal`) could double-count toughness

**Mitigation:** Currently irrelevant because `.resistance` is used (which doesn't include toughness separately). Once fixed, need to ensure toughness is only counted once.

**Proposed solution:** Extract toughness once and add at the end:
```javascript
const elementalMitigation = elementalReduction.armor + elementalReduction.resistance;
const magicMitigation = magicReduction.armor + magicReduction.resistance;
const toughness = elementalReduction.toughness; // Same for all types
const finalDamage = damage - elementalMitigation - magicMitigation - toughness;
```

## 6. Test Coverage Gaps

### Missing Test Cases
1. **Elemental spell vs Magic AR armor**  
   - Setup: Actor wearing Partial Daedric (Magic AR 6)
   - Cast: Fire spell dealing 20 damage
   - Expected: Damage reduced by Magic AR 6 (+ any fire resistance)
   - Current: Magic AR ignored

2. **Stacked elemental protections**  
   - Setup: Partial Stalhrim (6 frost AR) + 20% frost resistance + Natural Toughness 2
   - Cast: Frost spell dealing 30 damage
   - Expected: 30 - 6 (frost AR) - 6% (20% of 30) - 6 (Magic AR) - 2 (toughness) = ~10 damage
   - Current: Incomplete (Magic AR missing)

3. **Shield Magic BR vs spell**  
   - Setup: Daedric Shield (Magic BR 12)
   - Cast: Fire spell, defender blocks
   - Expected: Block test with BR 12, then damage mitigation per RAW
   - Current: Untested (block path not in scope)

## 7. References

### RAW Documentation
- **Chapter 5: Advanced Mechanics** – Damage resolution, AR/BR mechanics
- **Chapter 6: Magic** – Spell damage layering, resistance stacking
- **Chapter 7: Economics & Equipment** – Armor/shield tables, magic AR values

### Code Files
- **Damage types:** `src/core/combat/damage/types.js`
- **Mitigation calculator:** `src/core/combat/damage/reduction.js`
- **Damage application:** `src/core/combat/damage/apply.js`
- **Magic damage:** `src/core/magic/damage-application.js`
- **Resolver facade:** `src/core/combat/damage-resolver.js`

