# Magic AR Damage Testing Checklist

## Test Environment Setup

### Required Test Actors

1. **Test Target 1 - No Magic AR**
   - Equipped: Full Iron Armor (0 Magic AR)
   - Resistances: All 0
   - Natural Toughness: 0
   - HP: 50
   - Wound Threshold: 10

2. **Test Target 2 - Generic Magic AR**
   - Equipped: Partial Daedric Armor, Body location (Magic AR 6)
   - Resistances: All 0
   - Natural Toughness: 0
   - HP: 50
   - Wound Threshold: 10

3. **Test Target 3 - Full Daedric Suit**
   - Equipped: Full Daedric Armor, all locations (Magic AR 8 each)
   - Resistances: All 0
   - Natural Toughness: 0
   - HP: 50
   - Wound Threshold: 10

4. **Test Target 4 - Typed Magic AR (Frost)**
   - Equipped: Partial Stalhrim Armor, Body location (6 Frost AR, 0 Magic AR)
   - Resistances: All 0
   - Natural Toughness: 0
   - HP: 50
   - Wound Threshold: 10

5. **Test Target 5 - Stacked Magic AR + Shield**
   - Equipped: Partial Daedric Armor, Body (Magic AR 6)
   - Equipped: Daedric Shield (Magic BR 12, not relevant for direct damage)
   - Resistances: All 0
   - Natural Toughness: 0
   - HP: 50
   - Wound Threshold: 10

6. **Test Target 6 - Magic AR + Resistance**
   - Equipped: Partial Daedric Armor, Body (Magic AR 6)
   - Resistances: Magic 20%, Fire 10%
   - Natural Toughness: 0
   - HP: 50
   - Wound Threshold: 10

7. **Test Target 7 - Magic AR + Natural Toughness**
   - Equipped: Partial Daedric Armor, Body (Magic AR 6)
   - Resistances: All 0
   - Natural Toughness: 3
   - HP: 50
   - Wound Threshold: 10

8. **Test Target 8 - Runed Armor**
   - Equipped: Partial Steel Armor (0 base Magic AR) with "Runed" quality
   - Expected Magic AR: 1 (from Runed)
   - Resistances: All 0
   - Natural Toughness: 0
   - HP: 50
   - Wound Threshold: 10

9. **Test Target 9 - Damaged Armor**
   - Equipped: Partial Daedric (Magic AR 6), with Damaged(2) quality
   - Expected Effective Magic AR: 4 (6 - 2)
   - Resistances: All 0
   - Natural Toughness: 0
   - HP: 50
   - Wound Threshold: 10

---

## Part 1: Pure Magic Damage Tests

### Test 1.1: Magic Spell vs No Magic AR
- **Setup:** Cast pure "Magic" damage spell on Test Target 1
- **Spell:** Magic Missile (20 magic damage)
- **Hit Location:** Body
- **Expected:**
  - Mitigation: 0 (no Magic AR)
  - Damage Applied: 20
  - New HP: 30
- **Pass Criteria:** Full damage applied

### Test 1.2: Magic Spell vs Generic Magic AR
- **Setup:** Cast pure "Magic" damage spell on Test Target 2
- **Spell:** Magic Missile (20 magic damage)
- **Hit Location:** Body (where Daedric is equipped)
- **Expected:**
  - Magic AR: 6
  - Damage Applied: 14 (20 - 6)
  - New HP: 36
- **Pass Criteria:** Correct Magic AR reduction

### Test 1.3: Magic Spell vs Different Hit Location
- **Setup:** Same as 1.2
- **Hit Location:** Head (not covered by Partial armor)
- **Expected:**
  - Magic AR: 0 (no armor on Head)
  - Damage Applied: 20
  - New HP: 30
- **Pass Criteria:** Location-based AR applied correctly

### Test 1.4: Magic Spell vs Full Suit
- **Setup:** Cast spell on Test Target 3 (Full Daedric all locations)
- **Spell:** Magic Missile (20 magic damage)
- **Hit Location:** Any (all covered)
- **Expected:**
  - Magic AR: 8
  - Damage Applied: 12 (20 - 8)
  - New HP: 38
- **Pass Criteria:** Full armor Magic AR applied

---

## Part 2: Elemental Spell Damage Tests (CRITICAL)

### Test 2.1: Fire Spell vs No Magic AR
- **Setup:** Cast Fire spell on Test Target 1
- **Spell:** Fire Bolt (30 fire damage)
- **Hit Location:** Body
- **Expected:**
  - Fire AR: 0
  - Magic AR: 0
  - Fire Resistance: 0
  - Magic Resistance: 0
  - Natural Toughness: 0
  - Total Mitigation: 0
  - Damage Applied: 30
  - New HP: 20
- **Pass Criteria:** Full damage applied

### Test 2.2: Fire Spell vs Generic Magic AR (CRITICAL FIX VERIFICATION)
- **Setup:** Cast Fire spell on Test Target 2
- **Spell:** Fire Bolt (30 fire damage)
- **Hit Location:** Body (Partial Daedric equipped, Magic AR 6)
- **Expected:**
  - Fire AR: 0 (Daedric has no typed fire AR)
  - Magic AR: 6 (generic Magic AR blocks elemental damage)
  - Fire Resistance: 0
  - Magic Resistance: 0
  - Natural Toughness: 0
  - Total Mitigation: 6
  - Damage Applied: 24 (30 - 6)
  - New HP: 26
- **Pass Criteria:** ✅ **Magic AR reduces fire damage** (this was the bug)

### Test 2.3: Fire Spell vs Full Daedric
- **Setup:** Cast Fire spell on Test Target 3
- **Spell:** Fire Bolt (30 fire damage)
- **Hit Location:** Body (Full Daedric, Magic AR 8)
- **Expected:**
  - Fire AR: 0
  - Magic AR: 8
  - Total Mitigation: 8
  - Damage Applied: 22 (30 - 8)
  - New HP: 28
- **Pass Criteria:** Full Magic AR applied

### Test 2.4: Frost Spell vs Typed Frost AR
- **Setup:** Cast Frost spell on Test Target 4
- **Spell:** Frost Bolt (30 frost damage)
- **Hit Location:** Body (Partial Stalhrim, 6 Frost AR)
- **Expected:**
  - Frost AR: 6 (typed mitigation)
  - Magic AR: 0 (Stalhrim partial has no generic Magic AR, only typed)
  - Frost Resistance: 0
  - Magic Resistance: 0
  - Natural Toughness: 0
  - Total Mitigation: 6
  - Damage Applied: 24 (30 - 6)
  - New HP: 26
- **Pass Criteria:** Typed AR applied correctly

### Test 2.5: Shock Spell vs Generic Magic AR
- **Setup:** Cast Shock spell on Test Target 2
- **Spell:** Shock Bolt (30 shock damage)
- **Hit Location:** Body (Partial Daedric, Magic AR 6)
- **Expected:**
  - Shock AR: 0
  - Magic AR: 6
  - Total Mitigation: 6
  - Damage Applied: 24 (30 - 6)
  - New HP: 26
- **Pass Criteria:** Magic AR applies to shock damage

---

## Part 3: Layered Mitigation Tests

### Test 3.1: Elemental Spell vs Magic AR + Resistance
- **Setup:** Cast Fire spell on Test Target 6
- **Spell:** Fire Bolt (30 fire damage)
- **Hit Location:** Body (Partial Daedric, Magic AR 6 + Fire Resistance 10% + Magic Resistance 20%)
- **Expected:**
  - Note: 10% of 30 = 3; 20% of 30 = 6
  - Fire AR: 0
  - Fire Resistance: 3
  - Elemental Total: 3
  - Magic AR: 6
  - Magic Resistance: 6
  - Magic Total: 12
  - Natural Toughness: 0
  - Total Mitigation: 15 (3 + 12)
  - Damage Applied: 15 (30 - 15)
  - New HP: 35
- **Pass Criteria:** Layered mitigation applied (elemental first, then magic)

### Test 3.2: Elemental Spell vs Magic AR + Natural Toughness
- **Setup:** Cast Fire spell on Test Target 7
- **Spell:** Fire Bolt (30 fire damage)
- **Hit Location:** Body (Partial Daedric, Magic AR 6 + Natural Toughness 3)
- **Expected:**
  - Fire AR: 0
  - Fire Resistance: 0
  - Elemental Total: 0
  - Magic AR: 6
  - Magic Resistance: 0
  - Magic Total: 6
  - Natural Toughness: 3
  - Total Mitigation: 9
  - Damage Applied: 21 (30 - 9)
  - New HP: 29
- **Pass Criteria:** Natural Toughness counted exactly once

### Test 3.3: Multi-Component Spell (Fire + Shock)
- **Setup:** Cast spell with multiple damage components on Test Target 2
- **Spell:** Lightning Storm (15 fire + 15 shock = 30 total)
- **Hit Location:** Body (Partial Daedric, Magic AR 6)
- **Expected:**
  - Component 1 (Fire): 15 - 6 (Magic AR) = 9
  - Component 2 (Shock): 15 - 6 (Magic AR) = 9
  - Total Damage Applied: 18
  - New HP: 32
- **Pass Criteria:** Magic AR applied to each component separately

---

## Part 4: Special Qualities & Edge Cases

### Test 4.1: Runed Armor (+1 Magic AR)
- **Setup:** Cast Fire spell on Test Target 8
- **Spell:** Fire Bolt (30 fire damage)
- **Hit Location:** Body (Partial Steel Runed, Magic AR 1)
- **Expected:**
  - Magic AR: 1 (from Runed)
  - Total Mitigation: 1
  - Damage Applied: 29
  - New HP: 21
- **Pass Criteria:** Runed quality grants +1 Magic AR

### Test 4.2: Damaged Armor (Reduced Magic AR)
- **Setup:** Cast Fire spell on Test Target 9
- **Spell:** Fire Bolt (30 fire damage)
- **Hit Location:** Body (Partial Daedric Damaged(2), Magic AR 4)
- **Expected:**
  - Magic AR: 4 (6 - 2 from Damaged)
  - Total Mitigation: 4
  - Damage Applied: 26
  - New HP: 24
- **Pass Criteria:** Damaged quality reduces Magic AR correctly

### Test 4.3: Spell Absorption (bypasses Magic AR)
- **Setup:**
  1. Grant Test Target 2 Spell Absorption trait (threshold 5)
  2. Cast Fire spell
  3. Spell Absorption roll: 3 (success)
- **Spell:** Fire Bolt (30 damage, MP cost 15)
- **Expected:**
  - Spell absorbed: no damage
  - Magicka restored: 15 (or up to missing MP)
  - HP unchanged
- **Pass Criteria:** Absorption bypasses all mitigation

### Test 4.4: Incorporeal Attacker (non-magic AR ignored)
- **Setup:**
  1. Attacker has Incorporeal trait
  2. Target: Test Target 2 (Partial Daedric, Magic AR 6)
  3. Weapon: Non-magic weapon
- **Expected:**
  - Physical AR: 0 (ignored for non-magic armor)
  - Magic AR: not relevant for physical attacks
  - Attack bypasses physical armor
- **Pass Criteria:** Non-magic armor ignored for incorporeal physical attacks

---

## Part 5: Chat Card Breakdown Verification

### Test 5.1: Damage Breakdown Display (Fire Spell)
- **Setup:** Cast Fire Bolt on Test Target 6 (Magic AR 6, Fire Res 10%, Magic Res 20%)
- **Action:** Check damage application chat card
- **Expected Breakdown:**
  ```
  Base Damage: 30
  Fire AR: -0
  Fire Resistance: -3
  Magic AR: -6
  Magic Resistance: -6
  Natural Toughness: -0
  ---
  Final Damage: 15
  ```
- **Pass Criteria:** All mitigation sources visible in breakdown

### Test 5.2: Breakdown for Pure Magic Damage
- **Setup:** Cast Magic Missile on Test Target 2
- **Expected Breakdown:**
  ```
  Base Damage: 20
  Magic AR: -6
  Magic Resistance: -0
  Natural Toughness: -0
  ---
  Final Damage: 14
  ```
- **Pass Criteria:** No redundant elemental lines for pure magic damage

---

## Code Verification Checklist

### ✅ Verified
- [ ] `getDamageReduction(actor, "fire", location)` returns correct object with `.armor` populated from special_ar
- [ ] `getDamageReduction(actor, "magic", location)` returns correct object with `.armor` populated from magic_ar
- [ ] `applyMagicDamage()` for elemental spells uses `.armor + .resistance` (not just `.resistance`)
- [ ] Natural Toughness counted exactly once in layered mitigation
- [ ] Chat card breakdown shows AR and resistance separately
- [ ] Runed quality grants +1 Magic AR (verified in item derivation)
- [ ] Damaged quality reduces Magic AR (verified in item derivation)
- [ ] Shield Magic BR does not contribute to non-block damage mitigation (verified shields excluded)
- [ ] Location-based coverage correctly filters applicable armor items

---

## Regression Tests

### Regression 1: Pure Magic Spell (no elementals)
- **Setup:** Cast pure "magic" damage spell (not fire/frost/shock)
- **Expected:** Magic AR applied via normal damage pipeline (not layered)
- **Pass Criteria:** No double-counting or missing mitigation

### Regression 2: Physical Spell Damage (e.g., Conjure Weapon)
- **Setup:** Cast spell that deals "physical" damage type
- **Expected:** Physical AR applied (not Magic AR)
- **Pass Criteria:** Correct damage type routing

### Regression 3: Healing Spell (damage type "healing")
- **Setup:** Cast healing spell
- **Expected:** No mitigation applied (healing ignores AR)
- **Pass Criteria:** Full healing value restored

---

## Performance Tests

### Performance 1: Multiple Targets (AoE Spell)
- **Setup:** Cast AoE Fire spell targeting 10 actors (mixed armor)
- **Expected:** Each target's Magic AR calculated independently
- **Pass Criteria:** No shared mitigation state between targets, sub-500ms total

---

## Integration Tests

### Integration 1: Opposed Magic Test + Magic AR
- **Setup:** Opposed magic test (attacker vs defender skill)
- **Action:** Resolve damage on success
- **Expected:** Magic AR applied to final damage value
- **Pass Criteria:** Same mitigation logic as direct damage

### Integration 2: Apply Damage Chat Button
- **Setup:**
  1. GM rolls spell damage manually
  2. GM uses "Apply Damage" chat card button
  3. Target has Magic AR
- **Expected:** Magic AR applied via same resolver
- **Pass Criteria:** No difference from automatic damage application

### Integration 3: Wound Effects from Spell Damage
- **Setup:**
  1. Target has 20 HP, WT 10
  2. Cast spell dealing 25 damage
  3. Target has Magic AR 6 → final damage 19
- **Expected:**
  - Damage > WT: wound triggered
  - Final HP: 1
  - Wound effect applied
- **Pass Criteria:** Wound triggered on post-mitigation damage

