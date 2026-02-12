# Armor AC/Speed Audit

## Summary
The UESRPG 3ev4 system currently implements armor speed penalties and AC status categories correctly for the most part, but there are minor gaps in UI consistency and documentation. Magic AR derivation is correct, but the damage application pipeline for elemental spells ignores it.

## 1. Canonical Armor Data Schema (template.json)

### Armor Item Schema
```json
{
  "armor": {
    "armor": 0,                    // Base physical AR (set by user or derived)
    "magic_ar": 0,                 // Base magic AR (set by user or derived)
    "special_ar": 0,               // Typed mitigation value (e.g., fire/frost)
    "special_ar_type": "",         // Type: "fire", "frost", "shock", etc.
    "weightClass": "none",         // Base weight class from dropdown
    "effectiveWeightClass": "none",// Derived (quality-adjusted) weight class
    "armorClass": "partial",       // "partial" or "full"
    "material": "standard",        // Material key (chitin, steel, daedric, etc.)
    "qualityLevel": "common",      // "inferior", "common", "superior"
    "isShield": false,             // Shield flag
    "shieldType": "normal",        // "normal", "tower", "targe", "buckler"
    "equipped": false,             // Equipped gating
    "carried": false,
    "qualitiesStructured": [],     // Structured qualities (e.g., Damaged(X))
    "category": "",                // Hit location category (head, body, etc.)
    "hitLocations": {              // Coverage map
      "Head": true,
      "Body": true,
      "RightArm": true,
      "LeftArm": true,
      "RightLeg": true,
      "LeftLeg": true
    }
  }
}
```

### Actor-Level Armor Status
- **Stored:** `actor.system.armor_class` (legacy status dropdown; fallback when no item provides weight class)
- **Derived:** Computed by `getArmorMobilityPenalties()` in `src/core/actors/rules/armor-mobility.js`

## 2. Derivation Pipeline

### Item-Level Derived Values (item.js prepareData)
**File:** `src/core/documents/item.js` → `_prepareArmorItem()`

**Inputs:**
- `system.material` (e.g., "steel", "daedric")
- `system.armorClass` ("partial" or "full")
- `system.qualityLevel` ("inferior", "common", "superior")
- `system.qualitiesStructured` (e.g., `[{ key: "damaged", value: 2 }]`)
- `system.isShield`, `system.shieldType`

**Outputs (derived, non-persisted):**
- `system.armorEffective` = base AR - Damaged
- `system.magic_arEffective` = base Magic AR - Damaged
- `system.special_arEffective` = base special AR - Damaged
- `system.weightClassEffective` = quality-adjusted weight class
- `system.encEffective` = derived encumbrance
- `system.priceEffective` = quality/runed-adjusted price
- `system.blockRatingEffective` (shields only)
- `system.magic_brEffective` (shields only)

**Material Profiles:**
- Defined in `src/core/constants.js` → `UESRPG.ARMOR_PROFILES.partial.<material>` and `UESRPG.ARMOR_PROFILES.full.<material>`
- Example (Partial Daedric): `{ ar: 6, magicAR: 6, magicARType: "magic", weightClass: "heavy", enc: 5, ... }`
- Example (Full Dragonbone): `{ ar: 9, magicAR: 9, magicARType: "magic", weightClass: "superheavy", enc: 6, ... }`

### Actor-Level Aggregation (armor-mobility.js)
**File:** `src/core/actors/rules/armor-mobility.js` → `getArmorMobilityPenalties(actorData)`

**Inputs:**
- All items from `actorData.items`
- Filters: `type === "armor"`, `equipped === true`, `isShield === false` (shields excluded)
- Reads `system.weightClass` or `system.effectiveWeightClass` from each armor item

**Outputs:**
```javascript
{
  armorWeightClass: "heavy",        // Canonical derived AC status
  agilityTestPenalty: -20,          // -10/-20/-30 based on class
  agilityPenaltyExemptSkills: ["combatstyle"],
  skillTestPenalties: { "acrobatics": -10 }, // Light-specific
  allTestPenalty: 0,                // Crippling only
  speedPenalty: -2,                 // -1/-2/-3 based on class
  sources: [{ id, name }]
}
```

**RAW Rules Applied:**
- None: no penalties
- Light: -10 Acrobatics
- Medium: -10 Agility (except Combat Style), -1 Speed
- Heavy: -20 Agility (except Combat Style), -2 Speed
- Super-Heavy: -30 Agility (except Combat Style), -3 Speed
- Crippling: -40 all tests, cannot move

**Quality Adjustments:**
- Inferior: +1 weight class step
- Superior: -1 weight class step

**Stacking Rule:**
- Only the **heaviest** equipped armor piece counts (max precedence)

### Actor Speed Calculation
**File:** `src/core/documents/actor.js` → `_speedCalc(actorData)`

**Inputs:**
- Base speed: `actorData.system.speed.base`
- Half-speed items: `items.filter(item => item.system.halfSpeed === true)`
- Tower shields: special -1 Speed (hardcoded legacy path)
- Armor speed penalty: pulled from `getArmorMobilityPenalties()`
- Wall of Steel talent: ignores armor speed penalty
- Active Effects: `getSpeedAEModifiers()`

**Output:**
- `actorData.system.speed.value` = base + modifiers - penalties

## 3. Current Implementation Status

### ✅ Correct
1. **Material-based Magic AR derivation** – `item.js` correctly computes `magic_arEffective` from ARMOR_PROFILES
2. **Quality adjustment** – Inferior/Superior correctly shift weight class
3. **Damaged quality** – Correctly reduces AR and Magic AR
4. **Speed penalty derivation** – `armor-mobility.js` correctly computes speed penalties per RAW
5. **Equipped gating** – Only equipped armor contributes to AC status and penalties
6. **Shield exclusion** – Shields do not contribute to AC status (only to Block mechanics)

### ❌ Issues Found

#### Issue 1: Magic AR ignored in elemental spell damage
**Location:** `src/core/magic/damage-application.js` → `applyMagicDamage()`  
**Line:** 202-234

**Current behavior:**
```javascript
const elementalReduction = getDamageReduction(targetActor, dt, hitLocation);
const elementalResistance = elementalReduction.resistance || 0; // ❌ Only uses resistance

const magicReduction = getDamageReduction(targetActor, DAMAGE_TYPES.MAGIC, hitLocation);
const magicResistance = magicReduction.resistance || 0; // ❌ Only uses resistance

const afterElemental = damage - elementalResistance;
const finalDamage = afterElemental - magicResistance;
```

**Problem:** 
- `getDamageReduction()` returns `{ armor, resistance, toughness, total }`
- For elemental spells, the code only extracts `.resistance` and ignores `.armor` (which contains Magic AR)
- This means Magic AR never reduces elemental spell damage, only pure "magic" damage type spells

**Expected behavior:**
- Fire/Frost/Shock spells should have their damage reduced by:
  1. Special AR (e.g., stalhrim has 6 frost AR)
  2. Magic AR (the armor's generic magic protection)
  3. Elemental resistance (trait/Active Effect)
  4. Magic resistance (trait/Active Effect)
  5. Natural Toughness

#### Issue 2: AC status category not exposed to actor UI
**Location:** Actor sheet templates  
**Issue:** The derived `armorWeightClass` from `getArmorMobilityPenalties()` is computed but not consistently displayed on the actor sheet header or status section.

**Impact:** Medium — GMs/Players cannot easily see a character's current AC status category at a glance.

#### Issue 3: Shield speed penalty (Tower Shield) uses legacy hardcoded path
**Location:** `src/core/documents/actor.js` → `_speedCalc()` line 458  
**Code:** `if (!ignoreArmorSpeedPenalty && hasTowerShield) speed = Math.max(0, speed - 1);`

**Issue:** Tower shield speed penalty is hardcoded separately instead of being integrated into the armor-mobility aggregation.

**Impact:** Low — Works correctly but is architecturally inconsistent.

## 4. Derivation Data Flow Diagram

```
[Item Schema]
  ├── material + armorClass → [ARMOR_PROFILES lookup]
  ├── qualityLevel → [quality adjustment]
  ├── qualitiesStructured (Damaged) → [AR reduction]
  └── → system.armorEffective
       system.magic_arEffective
       system.weightClassEffective

[Actor Items Filter]
  └── type=armor, equipped=true, isShield=false
      → [getArmorMobilityPenalties]
         └── armorWeightClass (canonical AC status)
             speedPenalty
             agilityTestPenalty
             skillTestPenalties

[Actor prepareData]
  └── _speedCalc
      └── base - speedPenalty (from armor) - towerShield - halfSpeed + AE mods
         → system.speed.value
```

## 5. References

### RAW Documentation
- **Chapter 1: Getting Started** – Weight Class table (page 432+)
- **Chapter 7: Economics & Equipment** – Armor tables (pages 274-400), Quality rules, Material profiles

### Code Files
- **Armor derivation:** `src/core/documents/item.js` (_prepareArmorItem)
- **Mobility penalties:** `src/core/actors/rules/armor-mobility.js` (getArmorMobilityPenalties)
- **Speed calculation:** `src/core/documents/actor.js` (_speedCalc)
- **Material profiles:** `src/core/constants.js` (UESRPG.ARMOR_PROFILES, SHIELD_PROFILES)
- **Damage reduction:** `src/core/combat/damage/reduction.js` (getDamageReduction)
- **Magic damage:** `src/core/magic/damage-application.js` (applyMagicDamage)

