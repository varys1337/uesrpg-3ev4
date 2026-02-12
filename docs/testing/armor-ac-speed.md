# Armor AC/Speed Testing Checklist

## Test Environment Setup

### Required Test Actor Setup
1. **Test PC 1 - Light Armor**
   - Equipped: Partial Leather Armor (all locations covered)
   - Expected AC Status: Light
   - Expected Speed Penalty: 0
   - Expected Acrobatics Penalty: -10

2. **Test PC 2 - Medium Armor**
   - Equipped: Partial Steel Armor (body + head)
   - Expected AC Status: Medium
   - Expected Speed Penalty: -1
   - Expected Agility Test Penalty: -10 (except Combat Style)

3. **Test PC 3 - Heavy Armor**
   - Equipped: Full Steel Armor (full suit)
   - Expected AC Status: Heavy
   - Expected Speed Penalty: -2
   - Expected Agility Test Penalty: -20 (except Combat Style)

4. **Test PC 4 - Super-Heavy Armor**
   - Equipped: Full Daedric Armor (full suit)
   - Expected AC Status: Super-Heavy
   - Expected Speed Penalty: -3
   - Expected Agility Test Penalty: -30 (except Combat Style)

5. **Test PC 5 - Quality Adjustments**
   - Equipped: Partial Steel (Medium, Quality: Inferior)
   - Expected AC Status: Heavy (shifted +1 step)
   - Expected Speed Penalty: -2

6. **Test PC 6 - Quality Adjustments (Superior)**
   - Equipped: Full Daedric (Super-Heavy, Quality: Superior)
   - Expected AC Status: Heavy (shifted -1 step)
   - Expected Speed Penalty: -2

7. **Test PC 7 - Wall of Steel Talent**
   - Equipped: Full Steel Armor (Heavy)
   - Has Talent: Wall of Steel
   - Expected Speed Penalty: 0 (ignored)
   - Expected Agility Test Penalty: -20 (still applies)

8. **Test PC 8 - Tower Shield**
   - Equipped: No armor + Steel Tower Shield
   - Expected AC Status: None
   - Expected Speed Penalty: -1 (from tower shield)

9. **Test PC 9 - Mixed Armor**
   - Equipped: Partial Leather (head) + Full Steel (body) + Partial Leather (limbs)
   - Expected AC Status: Heavy (heaviest piece, Full Steel)
   - Expected Speed Penalty: -2

---

## Part 1: Armor Speed Reduction Tests

### Test 1.1: Light Armor Speed (None)
- **Setup:** Test PC 1 (Partial Leather)
- **Action:** Check actor.system.speed.value
- **Expected:**
  - Speed reduction: 0 (Light has no speed penalty)
  - Acrobatics test: -10 penalty visible in skill TN calculation
- **Pass Criteria:** Speed unchanged from base

### Test 1.2: Medium Armor Speed
- **Setup:** Test PC 2 (Partial Steel)
- **Action:** Check actor.system.speed.value
- **Expected:**
  - Speed reduction: -1
  - Base speed 10 → effective speed 9
- **Pass Criteria:** Speed reduced by exactly 1

### Test 1.3: Heavy Armor Speed
- **Setup:** Test PC 3 (Full Steel)
- **Action:** Check actor.system.speed.value
- **Expected:**
  - Speed reduction: -2
  - Base speed 10 → effective speed 8
- **Pass Criteria:** Speed reduced by exactly 2

### Test 1.4: Super-Heavy Armor Speed
- **Setup:** Test PC 4 (Full Daedric)
- **Action:** Check actor.system.speed.value
- **Expected:**
  - Speed reduction: -3
  - Base speed 10 → effective speed 7
- **Pass Criteria:** Speed reduced by exactly 3

### Test 1.5: Quality Adjustment (Inferior → heavier)
- **Setup:** Test PC 5 (Partial Steel Inferior)
- **Action:**
  1. Set armor quality to "Inferior"
  2. Check actor.system.mobility.armorWeightClass
  3. Check speed
- **Expected:**
  - AC Status: Heavy (Medium + 1 step)
  - Speed reduction: -2
- **Pass Criteria:** Speed penalty matches Heavy, not Medium

### Test 1.6: Quality Adjustment (Superior → lighter)
- **Setup:** Test PC 6 (Full Daedric Superior)
- **Action:**
  1. Set armor quality to "Superior"
  2. Check actor.system.mobility.armorWeightClass
  3. Check speed
- **Expected:**
  - AC Status: Heavy (Super-Heavy - 1 step)
  - Speed reduction: -2
- **Pass Criteria:** Speed penalty matches Heavy, not Super-Heavy

### Test 1.7: Wall of Steel Talent
- **Setup:** Test PC 7 (Full Steel + Wall of Steel)
- **Action:** Check actor.system.speed.value
- **Expected:**
  - Speed penalty ignored: 0
  - Base speed 10 → effective speed 10
- **Pass Criteria:** No speed reduction despite Heavy armor

### Test 1.8: Tower Shield Speed Penalty
- **Setup:** Test PC 8 (Tower Shield only)
- **Action:**
  1. Equip steel tower shield
  2. Check speed
- **Expected:**
  - Speed reduction: -1
- **Pass Criteria:** Speed reduced by 1 despite no armor

### Test 1.9: Stacking Rule (Max Precedence)
- **Setup:** Test PC 9 (Mixed armor)
- **Action:**
  1. Equip Partial Leather (Light) on head
  2. Equip Full Steel (Heavy) on body
  3. Equip Partial Leather (Light) on limbs
  4. Check mobility
- **Expected:**
  - AC Status: Heavy (from Full Steel body)
  - Speed reduction: -2
- **Pass Criteria:** Heaviest armor determines penalty, not sum

---

## Part 2: AC Status Category Tests

### Test 2.1: Derived AC Status (Light)
- **Setup:** Test PC 1 (Partial Leather)
- **Action:** Check actor.system.mobility.armorWeightClass
- **Expected:** "light"
- **Pass Criteria:** Exact string match (lowercase)

### Test 2.2: Derived AC Status (Medium)
- **Setup:** Test PC 2 (Partial Steel)
- **Action:** Check actor.system.mobility.armorWeightClass
- **Expected:** "medium"
- **Pass Criteria:** Exact string match

### Test 2.3: Derived AC Status (Heavy)
- **Setup:** Test PC 3 (Full Steel)
- **Action:** Check actor.system.mobility.armorWeightClass
- **Expected:** "heavy"
- **Pass Criteria:** Exact string match

### Test 2.4: Derived AC Status (Super-Heavy)
- **Setup:** Test PC 4 (Full Daedric)
- **Action:** Check actor.system.mobility.armorWeightClass
- **Expected:** "superheavy"
- **Pass Criteria:** Exact string match (note: no hyphen)

### Test 2.5: Legacy Dropdown Update
- **Setup:** Test PC 3 (Full Steel Heavy)
- **Action:**
  1. Open actor sheet
  2. Check "Armor Status" dropdown value
- **Expected:** Shows "Heavy" as selected option
- **Pass Criteria:** Dropdown reflects derived weight class

### Test 2.6: Shield Exclusion
- **Setup:** Test PC 8 (Tower Shield only, no armor)
- **Action:** Check actor.system.mobility.armorWeightClass
- **Expected:** "none"
- **Pass Criteria:** Shield does not contribute to AC status

---

## Part 3: Agility Test Penalties

### Test 3.1: Light Armor Acrobatics Penalty
- **Setup:** Test PC 1 (Partial Leather)
- **Action:**
  1. Make Acrobatics skill test
  2. Check breakdown
- **Expected:**
  - Acrobatics: -10
  - Other Agility skills: 0
  - Combat Style: 0
- **Pass Criteria:** Only Acrobatics penalized

### Test 3.2: Medium Armor Agility Penalty
- **Setup:** Test PC 2 (Partial Steel)
- **Action:**
  1. Make Acrobatics test
  2. Make Stealth test
  3. Make Combat Style test
- **Expected:**
  - Acrobatics: -10
  - Stealth (Agility-based): -10
  - Combat Style: 0 (exempt)
- **Pass Criteria:** All Agility tests except Combat Style penalized

### Test 3.3: Heavy Armor Agility Penalty
- **Setup:** Test PC 3 (Full Steel)
- **Action:** Same as 3.2
- **Expected:**
  - Acrobatics: -20
  - Stealth (Agility-based): -20
  - Combat Style: 0
- **Pass Criteria:** Penalty magnitude correct

### Test 3.4: Combat Style Exemption
- **Setup:** Test PC 3 (Full Steel Heavy)
- **Action:**
  1. Make Combat Style (Agility) test
  2. Check breakdown
- **Expected:** Combat Style test has NO armor penalty
- **Pass Criteria:** Penalty line not present in breakdown

---

## Part 4: Equipment Gating

### Test 4.1: Unequipped Armor Ignored
- **Setup:**
  1. Create Test PC with Full Daedric armor
  2. Mark armor as equipped=false
- **Action:** Check mobility
- **Expected:**
  - AC Status: "none"
  - Speed penalty: 0
- **Pass Criteria:** Unequipped armor has no effect

### Test 4.2: Equipping Armor Applies Penalties
- **Setup:** Same as 4.1
- **Action:**
  1. Mark armor as equipped=true
  2. Check mobility
- **Expected:**
  - AC Status: "superheavy"
  - Speed penalty: -3
- **Pass Criteria:** Equipping immediately applies penalties

---

## Code Verification Checklist

### ✅ Verified
- [ ] `getArmorMobilityPenalties()` correctly filters `equipped === true`
- [ ] Quality adjustment applied before stacking check
- [ ] Shield exclusion (`isShield === true` filtered out)
- [ ] Weight class normalization handles variants (super_heavy, superheavy)
- [ ] Stacking uses max precedence (heaviest armor wins)
- [ ] Speed penalties match RAW table
- [ ] Agility penalties match RAW table
- [ ] Combat Style exemption implemented
- [ ] Wall of Steel talent ignores speed penalty
- [ ] Tower shield -1 Speed applied separately
- [ ] `actor.system.mobility.armorWeightClass` is canonical source
- [ ] Legacy `actor.system.armor_class` updated for backward compatibility

---

## Regression Tests

### Regression 1: Legacy Data Migration
- **Setup:** Import actor with old schema (no `weightClass` field on armor)
- **Expected:** Fallback to actor.system.armor_class (manual dropdown)
- **Pass Criteria:** No errors, graceful degradation

### Regression 2: Partial Coverage Armor
- **Setup:**
  1. Equip Full Steel helmet (Head only)
  2. Equip Partial Leather body (Body only)
- **Expected:**
  - AC Status: Heavy (from Full Steel)
  - Coverage only on specified locations
- **Pass Criteria:** Heaviest equipped piece determines status

### Regression 3: Multiple Quality Adjustments
- **Setup:**
  1. Equip Inferior Full Ebony (Super-Heavy → Crippling)
- **Expected:**
  - AC Status: "crippling"
  - All tests: -40 penalty
  - Movement: blocked (handled separately)
- **Pass Criteria:** Edge case quality shifts handled correctly

---

## Performance Tests

### Performance 1: 20+ Armor Items in Inventory
- **Setup:** Create actor with 20 armor items (only 1 equipped)
- **Action:** Open character sheet, observe responsiveness
- **Expected:** No lag, only equipped items processed
- **Pass Criteria:** Sub-100ms sheet render time (typical)

---

## Integration Tests (with other systems)

### Integration 1: Encumbrance + Armor Speed Stack
- **Setup:**
  1. Equip Full Steel (Heavy, -2 Speed)
  2. Carry 3× Carry Rating (Crushing, -1 Speed)
- **Expected:**
  - Total Speed penalty: -3 (armor) + encumbrance penalty
- **Pass Criteria:** Penalties stack additively

### Integration 2: Active Effects + Armor Penalty
- **Setup:**
  1. Equip Heavy armor (-20 Agility)
  2. Apply Temporary Active Effect: -10 Agility tests
- **Expected:**
  - Total Agility penalty: -30
- **Pass Criteria:** Penalties stack with AE modifiers

