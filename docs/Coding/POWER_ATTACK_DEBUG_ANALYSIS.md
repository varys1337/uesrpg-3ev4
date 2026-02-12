# Power Attack Debug Analysis

**Date:** 2026-02-04  
**Issue:** Power Attack stamina action not providing proper damage bonuses  
**Status:** Debug logging added for investigation

---

## Problem Statement

User reports that Power Attack (and possibly other stamina actions) are not providing the expected bonuses. Power Attack should:
- Cost 1-3 SP (spent before damage roll)
- Add +2 damage per SP spent (max +6 normally)
- Add +3 damage per SP spent (max +9 with Killing Blow talent)

---

## Code Flow Analysis

### 1. Effect Creation (stamina-dialog.js)

When user spends SP on Power Attack:

```javascript
// Line 319: Calculate damage bonus
const multiplier = hasTalent(actor, "killingblow") ? 3 : 2;
const damageBonus = spAmount * multiplier;

// Line 324-329: Add Active Effect change
effectData.changes.push({
  key: "system.modifiers.combat.damage.dealt",
  mode: CONST.ACTIVE_EFFECT_MODES.ADD,
  value: String(damageBonus),
  priority: 20
});
```

**Expected behavior:** Creates Active Effect with changes array containing damage bonus.

### 2. Effect Evaluation (modifier-evaluator.js)

When damage is being resolved:

```javascript
// Line ~100: Collect all applicable effects
const effects = _collectApplicableEffects(actor, { dedupeByOrigin, debug });

// Effects are evaluated and aggregated
// Line ~125-165: Process ADD and OVERRIDE modes
```

**Expected behavior:** Power Attack effect should be in the collected effects list with proper changes array.

### 3. Damage Modifier Extraction (ae-mods.js)

```javascript
// Line 36-37: Evaluate attacker damage modifiers
const atkResolved = attackerActor ? evaluateAEModifierKeys(attackerActor, atkKeys) : null;

// Line 59: Extract total damage dealt bonus
const attackerDamageDealt = atkResolved ? (atkResolved["system.modifiers.combat.damage.dealt"]?.total ?? 0) : 0;
```

**Expected behavior:** attackerDamageDealt should contain the Power Attack bonus (2-9 damage).

### 4. Damage Application (resolve.js)

```javascript
// Line ~166: Apply AE bonus to raw damage
ctx.rawDamage = Math.max(0, ctx.rawDamage + asNumber(mods.attacker.damageDealt));
```

**Expected behavior:** Raw damage increased by Power Attack bonus before mitigation.

### 5. Effect Consumption (resolve.js)

```javascript
// Line 180-207: Consume Power Attack effect after damage applied
if (attackerActor && mods.attacker.damageDealt > 0) {
  const powerAttackEffect = attackerActor.effects.find(e => 
    !e.disabled && e?.flags?.uesrpg?.key === "stamina-power-attack"
  );
  
  if (powerAttackEffect) {
    await powerAttackEffect.delete();
    // Post consumption notification
  }
}
```

**Expected behavior:** Effect deleted after contributing to damage, chat message posted.

---

## Debug Logging Added

### File: [src/core/stamina/stamina-dialog.js](../../src/core/stamina/stamina-dialog.js)

**Location:** After line 340 (after changes array population)

**Logs:**
```javascript
console.log("UESRPG | Creating Power Attack effect:", {
  spAmount,
  damageBonus: effectData.flags.uesrpg.damageBonus,
  changes: effectData.changes,
  fullEffectData: effectData
});
```

**Purpose:** Verify effect is created with correct:
- spAmount (1-3)
- damageBonus (2-9)
- changes array with proper key and value

---

### File: [src/core/active-effects/modifier-evaluator.js](../../src/core/active-effects/modifier-evaluator.js)

**Location:** After line ~105 (after _collectApplicableEffects)

**Logs:**
```javascript
if (keySet.has("system.modifiers.combat.damage.dealt")) {
  console.log("UESRPG | Modifier Evaluator - Collected Effects for damage.dealt:", {
    actorName: actor.name,
    totalEffects: effects.length,
    effects: effects.map(e => ({
      name: e.name,
      disabled: e.disabled,
      key: e.flags?.uesrpg?.key,
      changes: e.changes,
      uuid: e.uuid,
      origin: e.origin
    })),
    requestedKeys: Array.from(keySet)
  });
}
```

**Purpose:** Verify Power Attack effect is in the collected effects list with:
- Correct `flags.uesrpg.key` ("stamina-power-attack")
- Non-empty changes array
- disabled = false

---

### File: [src/core/combat/damage/resolver/ae-mods.js](../../src/core/combat/damage/resolver/ae-mods.js)

**Location:** After line ~62 (after extracting attacker/defender totals)

**Logs:**
```javascript
console.log("UESRPG | AE Damage Modifiers:", {
  attackerName: attackerActor?.name,
  attackerDamageDealt,
  attackerPen,
  atkResolvedFull: atkResolved,
  defenderName: defenderActor?.name,
  defenderDamageTaken,
  defenderMitFlat
});
```

**Purpose:** Verify:
- `attackerDamageDealt` contains Power Attack bonus
- `atkResolved["system.modifiers.combat.damage.dealt"]` has proper total and entries

---

### File: [src/core/combat/damage/resolver/resolve.js](../../src/core/combat/damage/resolver/resolve.js)

**Location:** Before line ~166 (before applying AE bonus)

**Logs:**
```javascript
console.log("UESRPG | Raw Damage Calculation:", {
  rawDamageBefore,
  aeBonus: mods.attacker.damageDealt,
  attackerEffects: attackerActor?.effects?.map(e => ({
    name: e.name,
    disabled: e.disabled,
    key: e.flags?.uesrpg?.key,
    changes: e.changes
  }))
});
```

**Purpose:** Verify:
- Raw damage before AE application
- AE bonus from mods.attacker.damageDealt
- All attacker effects with their changes arrays

---

## Testing Procedure

### Setup
1. Create a test actor (PC or NPC)
2. Set Endurance attribute high enough to have SP (END 30+ for 3 SP)
3. Optional: Add Killing Blow talent to test 3× multiplier

### Test Cases

#### Test 1: Basic Power Attack (2 SP, no talent)
1. Open Stamina Dialog (click green SP bar)
2. Select "Power Attack"
3. Set amount to 2 SP
4. Click "Spend"
5. **Check console logs:**
   - Creating Power Attack effect: damageBonus should be 4, changes array should have value "4"
6. Make an attack (melee or ranged)
7. Roll damage
8. **Check console logs:**
   - Modifier Evaluator: Should show stamina-power-attack in effects list
   - AE Damage Modifiers: attackerDamageDealt should be 4
   - Raw Damage Calculation: aeBonus should be 4, rawDamageBefore + 4 = final
9. **Check chat card:** Should show +4 damage applied, "Power Attack consumed!" message

#### Test 2: Power Attack with Killing Blow (3 SP, talent)
1. Repeat Test 1 but with Killing Blow talent
2. Spend 3 SP for Power Attack
3. **Expected damageBonus:** 9 (3 SP × 3 multiplier)

#### Test 3: Physical Exertion (comparison)
1. Spend 1 SP on Physical Exertion
2. Make a STR or END based skill test
3. **Expected:** +20 bonus applied to roll
4. **Purpose:** Verify other stamina effects work correctly

---

## Expected Failure Modes

### Scenario A: Effect not created with changes array
**Symptoms:**
- "Creating Power Attack effect" log shows empty changes array
- No "Power Attack consumed!" message in chat

**Root cause:** Logic error in stamina-dialog.js lines 316-329

### Scenario B: Effect created but not collected
**Symptoms:**
- "Creating Power Attack effect" log shows correct data
- "Modifier Evaluator" log does NOT show stamina-power-attack effect

**Root cause:** _collectApplicableEffects filtering issue OR effect disabled flag set

### Scenario C: Effect collected but not evaluated
**Symptoms:**
- "Modifier Evaluator" log shows stamina-power-attack effect with changes
- "AE Damage Modifiers" log shows attackerDamageDealt = 0

**Root cause:** evaluateAEModifierKeys not processing changes properly (mode/value issue)

### Scenario D: Bonus calculated but not applied
**Symptoms:**
- "AE Damage Modifiers" log shows attackerDamageDealt > 0
- "Raw Damage Calculation" log shows aeBonus > 0
- Final damage in chat does NOT reflect bonus

**Root cause:** Issue in damage calculation formula or display

### Scenario E: Bonus applied but not displayed
**Symptoms:**
- Damage IS higher by expected amount
- No "Power Attack consumed!" message
- No AE breakdown shown in damage chat card

**Root cause:** Chat card rendering issue in apply.js

---

## Next Steps

1. **User runs tests** with console open (F12)
2. **Copy console logs** for each test case
3. **Compare actual vs expected** using failure mode scenarios above
4. **Identify root cause** from log patterns
5. **Implement targeted fix** based on findings

---

## Cleanup

Once issue is identified and fixed, **REMOVE** all debug logging:
- stamina-dialog.js line ~340-348
- modifier-evaluator.js line ~105-120
- ae-mods.js line ~63-73
- resolve.js line ~165-178

Replace with normal code flow (no console.log statements).

---

## Alternative: Enable Built-in Debug Settings

Instead of custom logging, can enable:
```javascript
game.settings.get("uesrpg-3ev4", "aeLifecycleDebug")  // Active Effect lifecycle
```

But this does NOT cover modifier-evaluator.js or damage resolver, so custom logging is needed.

---

## Related Files

- [src/core/stamina/stamina-dialog.js](../../src/core/stamina/stamina-dialog.js) - Effect creation
- [src/core/stamina/stamina-integration-hooks.js](../../src/core/stamina/stamina-integration-hooks.js) - Legacy manual consumption (not used for Power Attack currently)
- [src/core/active-effects/modifier-evaluator.js](../../src/core/active-effects/modifier-evaluator.js) - AE aggregation
- [src/core/combat/damage/resolver/ae-mods.js](../../src/core/combat/damage/resolver/ae-mods.js) - Damage modifier extraction
- [src/core/combat/damage/resolver/resolve.js](../../src/core/combat/damage/resolver/resolve.js) - Damage application & effect consumption
- [src/core/combat/damage/apply.js](../../src/core/combat/damage/apply.js) - Chat card rendering (aeBreakdown display)
- [docs/Core/Chapter 1 - Getting Started.md](../Core/Chapter%201%20-%20Getting%20Started.md#stamina) - RAW rules for Power Attack
- [docs/Coding/STAMINA_SYSTEM_ANALYSIS.md](STAMINA_SYSTEM_ANALYSIS.md) - Complete stamina system documentation

---

## RAW Reference

**Power Attack** (Chapter 1, Stamina section):
> Spend 1-3 SP before damage roll. Increase damage by twice the stamina points spent to a maximum of 3 for +6 damage.

**Killing Blow Talent** (Chapter 5):
> When spending SP for Power Attack, multiply by 3 instead of 2 (max +9 damage).
