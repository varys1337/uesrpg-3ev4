# Spell Absorption & Spell Reflect — Complete Setup Guide

**System Version:** UESRPG 3ev4 for Foundry VTT v13.351  
**Last Updated:** 2026-02-09

This guide documents all methods for granting Spell Absorption and Spell Reflect capabilities to actors in the UESRPG system.

---

## Overview

Both **Spell Absorption** and **Spell Reflect** are defensive magical effects that protect against incoming spells:

- **Spell Absorption**: Roll 1d10 when targeted by a spell. If roll ≤ threshold, the spell is absorbed (no effect) and the target recovers MP equal to the spell's cost.
- **Spell Reflect**: Roll 1d10 when targeted by a spell. If roll ≤ threshold, the spell is reflected back at the caster.

**Threshold** = Spell Strength (SS) value of the Spell Absorption/Reflect spell, or the value from other sources (traits, manual AEs).

---

## Method 1: Spell Sheet Configuration (Recommended)

**Use this method when creating Spell Absorption or Spell Reflect spells.**

### Setup Steps

1. **Open the spell item sheet** (or create a new spell)
2. Navigate to the **Casting** tab
3. Scroll to **"Casting Attributes"** section
   - Set the **Strength** field (labeled `damageFormula`) to the desired threshold value
   - Example: `5` or `SS` (if using a variable)
4. Open **Advanced Options** (at the bottom of the Casting tab)
5. Expand **Automation Modules**
6. Find the **Spell Defense** module panel
7. **Check** the box: "Spell Defense (Absorption/Reflect)"
8. **Select Type** from dropdown:
   - `Spell Absorption` — absorbs spells and restores MP
   - `Spell Reflect` — reflects spells back at caster
9. Save the spell

### What This Does

When this spell is cast on a target:
- **Duration**: Forced to exactly 1 round (regardless of configured duration)
- **Active Effect Created**: Tracker AE with the following changes:
  - For **Absorption**: Sets `system.modifiers.magic.spellAbsorption` = SS value (OVERRIDE mode)
  - For **Reflect**: Sets `system.modifiers.magic.spellReflect` = SS value (OVERRIDE mode)
- **Flags Set**: 
  - `flags.uesrpg-3ev4.spellDefense = { type: "absorption"|"reflect", ss: <value> }`
  - For Absorption only: `flags.uesrpg-3ev4.spellAbsorption = <value>` (legacy compatibility)

### Benefits

✅ **No manual AE setup required** — system auto-creates the effect  
✅ **1-round duration enforced** — RAW compliance  
✅ **Type-safe** — prevents misconfiguration  
✅ **Future-proof** — uses new flag-based detection

---

## Method 2: Manual Active Effects (Direct Application)

**Use this method for custom items, racial abilities, or permanent effects.**

### Setup Steps

1. Open the item sheet (Talent, Trait, Power, or Spell)
2. Navigate to the **Effects** tab
3. Click **Add Effect**
4. Configure the Active Effect:
   - **Name**: "Spell Absorption (5)" or "Spell Reflect (7)" (include threshold in name for clarity)
   - **Icon**: Choose appropriate icon
   - **Duration**: 
     - For 1-round buffs: `Combat Rounds: 1`
     - For permanent/racial: Leave blank (unlimited)
   - **Transfer**: ✅ Check if on an equipped item (Talent/Trait) or always-active source
5. Add an **Effect Change**:
   - **Attribute Key**: 
     - For Absorption: `system.modifiers.magic.spellAbsorption`
     - For Reflect: `system.modifiers.magic.spellReflect`
   - **Change Mode**: `Override` (or `Add` if stacking with other sources)
   - **Effect Value**: The threshold value (e.g., `5`, `7`, `10`)
6. **(Optional)** Add flags for traceability:
   - **Attribute Key**: `flags.uesrpg-3ev4.spellDefense`
   - **Change Mode**: `Override`
   - **Effect Value**: `{"type":"absorption","ss":5}` (use valid JSON)
7. Save the effect

### What This Does

When the effect is active on an actor:
- The `system.modifiers.magic.spellAbsorption` or `spellReflect` value is set
- The magic damage/reflect pipeline reads this value during spell resolution
- Roll 1d10 vs threshold when targeted by spells

### Example: Racial Dragonskin Ability

```javascript
{
  name: "Dragonskin (Racial)",
  icon: "icons/magic/defensive/shield-barrier-blue.webp",
  transfer: true, // Always active
  changes: [
    {
      key: "system.modifiers.magic.spellAbsorption",
      mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
      value: "5",
      priority: 20
    }
  ],
  flags: {
    "uesrpg-3ev4": {
      spellAbsorption: 5,
      source: "racial"
    }
  }
}
```

---

## Method 3: Trait-Based (Racial/Innate Abilities)

**Use this method for permanent racial or innate spell defense capabilities.**

### Current Implementation

The system supports **trait-based** spell absorption via the trait registry. Currently implemented for:

- **Dragonskin (Breton racial)**: Spell Absorption threshold 5

### How It Works

1. Trait-based spell absorption is read via `_maxTraitValue(actor, "spellAbsorption")`
2. The value is aggregated with AE-based and flag-based values
3. Threshold = `Math.max(traitValue, flagValue, aeModifierLane)`

### Adding New Trait-Based Defenses

To add trait-based spell defenses, edit:
- **File**: `src/core/traits/racial-talents.js` (or appropriate trait registry file)
- **Method**: Add `spellAbsorption: <value>` or similar property to the trait's flags

**Example** (Dragonskin):
```javascript
{
  name: "Dragonskin",
  // ... other properties
  flags: {
    uesrpg: { 
      key: EFFECT_KEY_DRAGONSKIN, 
      spellAbsorption: 5, 
      source: "talent" 
    }
  }
}
```

**Note**: Trait-based **Spell Reflect** is currently **not implemented** but could be added following the same pattern. The `_applySpellAbsorption` function in `damage-application.js` would need a corresponding `_maxTraitValue(actor, "spellReflect")` call in `spell-reflect.js`.

---

## Method 4: Legacy Name-Based Detection (Deprecated)

**Use this method only for backward compatibility with existing spells.**

### How It Works

The system automatically detects spells named:
- `"Spell Absorption"` or `"Spell Absorption (Mysticism)"` → treated as Absorption
- `"Reflect"` → treated as Reflect

**Warning**: This method is **deprecated** and only works when the new `isSpellDefense` flag is **NOT set**. If you set `isSpellDefense = true`, the flag-based type takes absolute precedence.

### Migration Path

For existing spells using name-based detection:
1. Open the spell sheet
2. Navigate to **Casting** → **Advanced Options** → **Spell Defense**
3. Check "Spell Defense" and select the correct type
4. Save — the spell will now use flag-based detection

---

## Complete Active Effect Modifier Keys

### Spell Absorption

**Primary Lane** (recommended):
```
system.modifiers.magic.spellAbsorption
```
- **Mode**: `Override` (replaces base) or `Add` (stacks)
- **Value**: Numeric threshold (0-10 typical range)
- **Behavior**: Roll 1d10 when targeted by spell. If roll ≤ value, spell is absorbed and target recovers MP.

**Legacy Flag Path** (compatibility):
```
flags.uesrpg.spellAbsorption
```
- Still read by `damage-application.js` for backward compatibility
- Prefer the `system.modifiers.magic.spellAbsorption` lane for new effects

### Spell Reflect

**Primary Lane** (only option):
```
system.modifiers.magic.spellReflect
```
- **Mode**: `Override` (replaces base) or `Add` (stacks)
- **Value**: Numeric threshold (0-10 typical range)
- **Behavior**: Roll 1d10 when targeted by spell. If roll ≤ value, spell is reflected back at caster.

---

## Detection Priority & Aggregation

### Spell Absorption Threshold

The system aggregates **three independent sources** and uses the **highest** value:

1. **Trait-based**: `_maxTraitValue(actor, "spellAbsorption")`  
   Example: Breton Dragonskin racial = 5
2. **AE Flag Path** (legacy): `flags.uesrpg.spellAbsorption`  
   Example: Activated talent with custom flag
3. **AE Modifier Lane**: `system.modifiers.magic.spellAbsorption`  
   Example: Spell Absorption spell's tracker AE

**Formula**: `threshold = Math.max(traitVal, flagVal, modLane)`

### Spell Reflect Threshold

The system aggregates **two sources** and uses the **higher** value:

1. **AE Modifier Lane**: `system.modifiers.magic.spellReflect`  
   Example: Reflect spell's tracker AE
2. **Direct Data Path**: `actor.system.modifiers.magic.spellReflect`  
   Example: Manually set base value (rare)

**Formula**: `threshold = Math.max(aeValue, dataValue)`

**Note**: Trait-based Spell Reflect is not currently implemented.

---

## Type Detection Logic (Spell Sheet)

When determining if a spell should apply Spell Absorption or Reflect effects, the system uses:

### Flag-Based Detection (Primary)

If `spell.system.isSpellDefense === true`:
- Uses `spell.system.spellDefenseType` value exclusively
- `"absorption"` → Spell Absorption
- `"reflect"` → Spell Reflect
- Ignores spell name completely (prevents name collisions)

### Name-Based Detection (Fallback)

If `spell.system.isSpellDefense !== true`:
- Checks spell name (case-insensitive, trimmed):
  - `"spell absorption"` or `"spell absorption (mysticism)"` → Absorption
  - `"reflect"` → Reflect
- Used only for legacy spells that haven't been migrated

**Critical Rule**: Flag-based detection **always** takes precedence. This ensures that:
- A spell named "Reflect" can be configured as Absorption via the UI
- A spell named "Spell Absorption" can be configured as Reflect via the UI
- No name collisions or conflicts

---

## Common Scenarios

### Scenario 1: Create a Custom Spell Absorption Spell

1. Create new spell: "Greater Spell Absorption"
2. Set **Strength** = `8`
3. Set **Duration** = `1 Round` (will be forced anyway)
4. Enable **Spell Defense** → select **Spell Absorption**
5. Cast on target → target gains absorption threshold 8 for 1 round

### Scenario 2: Permanent Racial Spell Absorption (Breton)

1. Create or edit racial Trait item: "Dragonskin"
2. Add Active Effect:
   - Key: `system.modifiers.magic.spellAbsorption`
   - Mode: `Override`
   - Value: `5`
   - Transfer: ✅ (always active)
3. Add trait to Breton actor → permanent absorption threshold 5

### Scenario 3: Stacking Multiple Sources

**Actor has**:
- Breton Dragonskin (trait-based): threshold 5
- Spell Absorption spell active (AE mod lane): threshold 7
- Old talent with legacy flag: threshold 3

**Result**: System uses `Math.max(5, 3, 7)` = **threshold 7**

### Scenario 4: Temporary Reflect Buff

1. Create spell: "Reflect"
2. Set **Strength** = `6`
3. Enable **Spell Defense** → select **Spell Reflect**
4. Cast on ally → ally reflects spells (1d10 ≤ 6) for 1 round

---

## Technical Details

### Duration Override (1 Round)

Both Spell Absorption and Spell Reflect spells have their duration **forced** to exactly 1 round:

```javascript
if (_isSpellAbsorptionSpell(spell) || _isReflectSpell(spell)) {
  const rt = MagicTimekeeping.roundTimeSeconds();
  duration = { rounds: 1, seconds: rt, unit: "rounds" };
}
```

This override happens **after** the upkeep default block, ensuring these spells never exceed 1 round even if configured differently.

### Tracker AE Creation

When a Spell Absorption/Reflect spell is cast and has **no embedded Active Effects**, the system creates a fallback tracker AE with:

**For Spell Absorption**:
```javascript
changes: [
  {
    key: "system.modifiers.magic.spellAbsorption",
    mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
    value: String(spellStrength),
    priority: 20
  }
],
flags: {
  "uesrpg-3ev4": {
    spellDefense: { type: "absorption", ss: spellStrength },
    spellAbsorption: spellStrength // legacy path
  }
}
```

**For Spell Reflect**:
```javascript
changes: [
  {
    key: "system.modifiers.magic.spellReflect",
    mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
    value: String(spellStrength),
    priority: 20
  }
],
flags: {
  "uesrpg-3ev4": {
    spellDefense: { type: "reflect", ss: spellStrength }
  }
}
```

### Spell Strength Calculation

The threshold value for auto-created tracker AEs comes from `_getSpellStrength(spell)`:

1. **Primary**: `spell.system.damageFormula` (numeric value)
2. **Fallback**: `spell.system.level`
3. **Clamped**: `0 ≤ SS ≤ 10`

**Example**: A Level 5 Spell Absorption spell with `damageFormula = "7"` creates threshold **7**.

---

## Files Modified (Recent Changes)

### Bug Fix (2026-02-09)

**Issue**: Legacy name-based fallback was interfering with flag-based detection, causing:
- Spells named "Reflect" configured as Absorption → incorrectly created Reflect effects
- Flag-based type selection ignored if name matched legacy pattern

**Fix**: Updated `spell-effects.js` helper functions:
- `_isSpellAbsorptionSpell()` — now checks `isSpellDefense === true` first, trusts flag exclusively
- `_isReflectSpell()` — now checks `isSpellDefense === true` first, trusts flag exclusively
- Legacy name-based detection only used when `isSpellDefense !== true`

**Files Modified**:
- `src/core/magic/spell-effects.js` (lines 22-48)

---

## Summary Table

| Method | Use Case | Setup Complexity | Transfer | Duration | Stacking |
|--------|----------|------------------|----------|----------|----------|
| **Spell Sheet Config** | Creating Absorption/Reflect spells | ⭐ Easy | Auto (1 round) | Forced 1 round | No (OVERRIDE) |
| **Manual Active Effect** | Custom items, effects | ⭐⭐ Medium | Your choice | Your choice | Yes (if ADD mode) |
| **Trait-Based** | Racial/innate abilities | ⭐⭐⭐ Advanced | Always | Unlimited | Yes (aggregated) |
| **Legacy Name-Based** | Old spells (deprecated) | ⭐ Easy | Auto (1 round) | Forced 1 round | No (OVERRIDE) |

---

## References

- **Active Effect Modifier Keys**: `docs/Active Effect Wiki.md` (lines 194-195)
- **Spell Effects Implementation**: `src/core/magic/spell-effects.js` (lines 16-48, 267-305)
- **Absorption Mechanics**: `src/core/magic/damage-application.js` (function `_applySpellAbsorption`)
- **Reflect Mechanics**: `src/core/magic/spell-reflect.js` (functions `getSpellReflectThreshold`, `trySpellReflect`)
- **Racial Talents**: `src/core/traits/racial-talents.js` (Dragonskin example, line 245)
- **Data Model**: `template.json` (lines 1152-1159)
