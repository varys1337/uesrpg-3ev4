# Stamina Actions Bug Fixes

**Date:** 2026-02-05  
**Status:** FIXED

---

## Issues Identified

1. **Power Attack**: Not contributing damage to attacks
2. **Power Block**: Throwing error when used
3. **Power Draw**: Working correctly ✓

---

## Root Causes

### 1. Power Attack Bug (ae-mods.js)

**Location:** [src/core/combat/damage/resolver/ae-mods.js](../../src/core/combat/damage/resolver/ae-mods.js)

**Problem:** Incorrect property access on the return value of `evaluateAEModifierKeys()`

**Code Before (WRONG):**
```javascript
const attackerDamageDealt = atkResolved ? (atkResolved["system.modifiers.combat.damage.dealt"]?.total ?? 0) : 0;
const attackerPen = atkResolved ? (atkResolved["system.modifiers.combat.penetration"]?.total ?? 0) : 0;

const defenderDamageTaken = defResolved["system.modifiers.combat.damage.taken"]?.total ?? 0;
const defenderMitFlat = defResolved["system.modifiers.combat.mitigation.flat"]?.total ?? 0;
```

**Code After (CORRECT):**
```javascript
const attackerDamageDealt = atkResolved ? (atkResolved["system.modifiers.combat.damage.dealt"] ?? 0) : 0;
const attackerPen = atkResolved ? (atkResolved["system.modifiers.combat.penetration"] ?? 0) : 0;

const defenderDamageTaken = defResolved["system.modifiers.combat.damage.taken"] ?? 0;
const defenderMitFlat = defResolved["system.modifiers.combat.mitigation.flat"] ?? 0;
```

**Explanation:**

The function `evaluateAEModifierKeys()` from [modifier-evaluator.js](../../src/core/active-effects/modifier-evaluator.js) returns:
```javascript
return _evaluateCore(actor, keys, options).totalsByKey;
```

Where `totalsByKey` is defined as:
```javascript
@returns {Record<string, number>} Map of key->numeric modifier total
```

This means it returns a **flat object** where each key maps directly to a number, NOT an object with a `.total` property.

So `atkResolved["system.modifiers.combat.damage.dealt"]` is already a number (e.g., `6`), not an object like `{total: 6}`.

Accessing `.total` on a number returns `undefined`, causing the Power Attack bonus to always be 0.

---

### 2. Power Block Bug (resolve.js)

**Location:** [src/core/combat/opposed/actions/resolve.js](../../src/core/combat/opposed/actions/resolve.js)

**Problem:** Missing import for `DAMAGE_TYPES` constant

**Code Before (MISSING IMPORT):**
```javascript
import { getDamageTypeFromWeapon } from "../../combat-utils.js";
import { getBlockValue } from "../../mitigation.js";
import { rollWeaponDamage as _rollWeaponDamage } from "../weapon-damage-roller.js";
// ... later in code at line 369:
const isPowerBlockActive = powerBlockEffect && String(damageType).toLowerCase() === DAMAGE_TYPES.PHYSICAL;
```

**Code After (IMPORT ADDED):**
```javascript
import { getDamageTypeFromWeapon } from "../../combat-utils.js";
import { getBlockValue } from "../../mitigation.js";
import { DAMAGE_TYPES } from "../../damage-automation.js"; // ADDED
import { rollWeaponDamage as _rollWeaponDamage } from "../weapon-damage-roller.js";
```

**Explanation:**

The Power Block stamina effect checks if the incoming damage type is physical before doubling the Block Rating:

```javascript
const isPowerBlockActive = powerBlockEffect && String(damageType).toLowerCase() === DAMAGE_TYPES.PHYSICAL;
```

But `DAMAGE_TYPES` was never imported, causing a `ReferenceError: DAMAGE_TYPES is not defined` when Power Block was used.

The constant is exported from [damage-automation.js](../../src/core/combat/damage-automation.js) which re-exports it from [damage/types.js](../../src/core/combat/damage/types.js).

---

## Files Modified

1. **[src/core/combat/damage/resolver/ae-mods.js](../../src/core/combat/damage/resolver/ae-mods.js)**
   - Lines 59-63: Removed incorrect `.total` property access

2. **[src/core/combat/opposed/actions/resolve.js](../../src/core/combat/opposed/actions/resolve.js)**
   - Line 15: Added `import { DAMAGE_TYPES } from "../../damage-automation.js";`

3. **Debug logging removed from:**
   - [src/core/stamina/stamina-dialog.js](../../src/core/stamina/stamina-dialog.js)
   - [src/core/combat/damage/resolver/ae-mods.js](../../src/core/combat/damage/resolver/ae-mods.js)
   - [src/core/combat/damage/resolver/resolve.js](../../src/core/combat/damage/resolver/resolve.js)
   - [src/core/active-effects/modifier-evaluator.js](../../src/core/active-effects/modifier-evaluator.js)

---

## Testing

### Power Attack
- ✓ Spend 1-3 SP on Power Attack
- ✓ Make an attack and roll damage
- ✓ Damage should increase by 2× SP (or 3× with Killing Blow talent)
- ✓ Power Attack effect should be consumed automatically
- ✓ Chat message should confirm consumption

### Power Block
- ✓ Spend 1 SP on Power Block
- ✓ Block an attack with a shield (physical damage only)
- ✓ BR should be doubled (e.g., BR 5 → 10)
- ✓ Effect should be consumed automatically
- ✓ No errors should occur

### Power Draw
- ✓ Already working correctly (no changes needed)

---

## Why This Happened (Post-Refactor Analysis)

These bugs were introduced during a recent refactoring of the opposed combat system. The most likely scenario:

1. **Power Attack**: Someone changed how `evaluateAEModifierKeys` returns data (from detailed object to flat totals) but didn't update all call sites. The function used to return `{ totalsByKey: {...}, detailsByKey: {...} }` but was simplified to return just `totalsByKey` directly. The detailed version is now `evaluateAEModifierKeysDetailed()`.

2. **Power Block**: During modularization of the opposed combat workflow (splitting into 30+ modules), the import statements were not fully updated when Power Block integration was added to `resolve.js`.

---

## Prevention

To prevent similar issues:

1. **Type Safety**: Consider adding JSDoc types or TypeScript to catch these at compile-time
2. **Integration Tests**: Add automated tests for stamina actions
3. **Code Review**: Ensure refactors update all call sites of changed functions
4. **Import Linting**: Use tools to detect missing/unused imports

---

## Related Documentation

- [Active Effect Wiki](../Active%20Effect%20Wiki.md) - Complete AE modifier keys reference
- [Stamina System Analysis](STAMINA_SYSTEM_ANALYSIS.md) - RAW compliance and implementation details
- [Stamina Player Guide](STAMINA_PLAYER_GUIDE.md) - How to use stamina actions
