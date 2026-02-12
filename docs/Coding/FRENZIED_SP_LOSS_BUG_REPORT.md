# Frenzied Condition SP Loss Bug - Investigation Report

## Bug Summary
When the Frenzied active effect is **disabled** (toggled off via Token HUD or Actor sheet), only the +1 SP bonus is removed, resulting in a net SP change of 0 instead of the expected -1 SP (baseline: +1 on enter, -2 on exit = net -1).

For characters without talents, the observed behavior is:
- **Expected**: Start with X SP → Apply Frenzied (X+1 SP) → Disable Frenzied (X-1 SP)  [net -1 SP]
- **Actual**: Start with X SP → Apply Frenzied (X+1 SP) → Disable Frenzied (X SP)  [net 0 SP, missing -2 SP penalty]

## Root Cause
**File**: [src/core/conditions/frenzied.js](../../../src/core/conditions/frenzied.js)  
**Line**: 336-397 (the `updateActiveEffect` hook handler)

The `updateActiveEffect` hook is registered to repair missing changes, but it **does NOT detect when the effect is being disabled** (`data.disabled === true`).

### Code Flow Analysis

#### When Frenzied is Applied ([applyFrenzied](../../../src/core/conditions/frenzied.js#L600))
1. Creates ActiveEffect with changes (WT, SB, skill penalty, immunities)
2. **Line 749**: Directly updates actor: `{ "system.stamina.value": currentSP + mods.spBonus }`
   - This is a **document mutation**, NOT an Active Effect change
   - Default: +1 SP (or +2 with Rage-fueled Frenzy talent)

#### When Frenzied is Deleted ([removeFrenzied](../../../src/core/conditions/frenzied.js#L834) or deleteActiveEffect hook)
1. **Line 841**: Calls `_applyFrenziedEndEffects(actor, { effectId: effect.id, applySPLoss: true, reason: "removed" })`
2. **Line 778**: Calculates `spLoss = Math.max(0, Number(mods.spLossOnEnd ?? 0) || 0)`
   - Baseline (no talents): `spLossOnEnd = 2`
   - Berserker talent: `spLossOnEnd = 1`
   - Controlled Anger talent: `spLossOnEnd = 0`
3. **Line 780**: Calculates `newSP = Math.max(1, currentSP - spLoss)`
4. **Line 795**: Updates actor: `{ "system.stamina.value": newSP }`
5. Deletes the effect

**Net SP change (baseline)**: +1 (on apply) -2 (on delete) = **-1 SP** ✅ CORRECT

#### When Frenzied is Disabled (Bug Path)
1. User clicks toggle icon on Actor sheet or uses core Foundry toggle in Token HUD
2. **Line 448** ([actor-sheet.js](../../../src/ui/sheets/actor-sheet.js#L448)): Calls `effect.update({ disabled: !effect.disabled })`
3. Foundry fires `updateActiveEffect` hook with `data = { disabled: true }`
4. **Line 336-397** ([frenzied.js](../../../src/core/conditions/frenzied.js#L336-L397)): Hook handler runs but:
   - **Line 339**: Checks if effect is Frenzied ✅
   - **Line 343**: Checks if changes are missing/empty for REPAIR ONLY ❌
   - **MISSING**: No check for `data.disabled === true`
   - **RESULT**: Hook returns early without calling `_applyFrenziedEndEffects`
5. The effect is disabled, its changes no longer apply, but:
   - The +1 SP from creation persists (it was a direct document update)
   - No -2 SP penalty is applied
6. **Net SP change**: +1 (on apply) -0 (on disable) = **+1 SP** ❌ BUG

## Why 1 SP is Lost (User's Observation Explained)
The user may be observing the removal of the **Strength Bonus** effect, which can indirectly affect derived stats and create the appearance of SP loss, OR they may be seeing the +1 SP bonus removal when the effect disables (bringing them back to their original SP value, which FEELS like a loss of 1 compared to the boosted state).

However, the actual bug is that the **-2 SP penalty is NOT applied** when the effect is disabled.

## Comparison: Delete vs Disable

| Event | Hook | SP Bonus Applied | SP Penalty Applied | Net Change (Baseline) |
|-------|------|------------------|--------------------|-----------------------|
| **Apply** | `createActiveEffect` | +1 SP (direct update) | N/A | +1 SP |
| **Delete** | `deleteActiveEffect` | Removed (effect deleted) | -2 SP via `_applyFrenziedEndEffects` | -1 SP (from start) |
| **Disable** | `updateActiveEffect` | Removed (effect disabled) | **MISSING** ❌ | +1 SP (from start) ❌ BUG |

## Missing Hook Logic
The `updateActiveEffect` hook in [frenzied.js](../../../src/core/conditions/frenzied.js#L336) needs to detect when `data.disabled === true` and call `_applyFrenziedEndEffects` to apply the SP penalty.

### Proposed Fix Location
**File**: `src/core/conditions/frenzied.js`  
**Function**: `_registerFrenziedRepairHook()` → `Hooks.on("updateActiveEffect", ...)`  
**Line**: 336-397

Add check after line 342:
```javascript
Hooks.on("updateActiveEffect", async (effect, data, options, userId) => {
  try {
    // Only process Frenzied effects
    const isFrenzied = effect?.flags?.[FLAG_SCOPE]?.condition?.key === CONDITION_KEY ||
                       effect?.flags?.core?.statusId === CONDITION_KEY;
    if (!isFrenzied) return;

    // NEW: Check if effect is being disabled (turned off)
    if (data.hasOwnProperty("disabled") && data.disabled === true && effect.disabled === false) {
      // Effect is being disabled; apply end effects
      const actor = effect.parent;
      if (!actor || actor.documentName !== "Actor") return;
      
      // Determine who should handle this (GM or active user)
      const activeGM = game.users?.activeGM ?? null;
      if (activeGM) {
        if (game.user.id !== activeGM.id) return;
      } else if (game.user.id !== userId) {
        return;
      }

      await _applyFrenziedEndEffects(actor, { effectId: effect.id, reason: "disabled" });
      return; // Don't continue to repair logic
    }

    // EXISTING: Check if changes are missing or empty (repair logic)
    const currentChanges = Array.isArray(effect.changes) ? effect.changes : [];
    if (_needsFrenziedChangesRepair(currentChanges)) {
      // ... existing repair logic ...
    }
  } catch (err) {
    _dbg("UESRPG | Frenzied | updateActiveEffect hook error", err);
  }
});
```

## Alternative: Check if Being Re-enabled
If the effect is being **re-enabled** (`data.disabled === false` and `effect.disabled === true`), the system should re-apply the +1 SP bonus. However, this creates complexity because:
- The talent modifiers may have changed since the effect was first created
- The effect's changes would already re-apply when enabled
- This could lead to double-application bugs

**Recommendation**: For now, only handle the **disable → end Frenzied** case. If a user re-enables the effect, treat it as a new application (delete the old effect and create a new one via the Token HUD/condition engine).

## Additional Discovery: Token HUD Uses Custom Handler
The Token HUD has a custom Frenzied handler in [status-hud.js](../../../src/core/conditions/status-hud.js#L347):
```javascript
} else if (statusId === "frenzied") {
  // Frenzied: requires custom application for talent-based dynamic changes
  const active = hasCondition(actor, statusId);
  if (active) {
    await removeFrenzied(actor);
  } else {
    await applyFrenzied(actor, { source: "Token HUD", voluntary: true });
  }
}
```

This means:
- **Token HUD click**: Correctly calls `removeFrenzied()` → applies SP penalty ✅
- **Actor sheet toggle**: Calls `effect.update({ disabled: !effect.disabled })` → MISSING SP penalty ❌
- **Core Foundry toggle (if used)**: Same as Actor sheet toggle → MISSING SP penalty ❌

## Scope of Impact
This bug affects:
1. **Actor sheet**: Clicking the "pause" icon on the Frenzied effect
2. **Effects sidebar**: Any toggle mechanism that uses `effect.update({ disabled })`
3. **Macros/API**: Any code that disables the effect without calling `removeFrenzied()`

It does **NOT** affect:
- Token HUD clicks (uses custom `removeFrenzied()` path)
- Direct deletion of the effect (uses `deleteActiveEffect` hook)
- The `removeFrenzied()` API function

## Recommended Fix Priority
**HIGH** - This is a rules violation (RAW states -2 SP penalty on exit) and creates an exploit where players can repeatedly disable/enable Frenzied to gain SP without paying the penalty.

## Testing Checklist
After fix is implemented, verify:
1. ✅ Character with no talents: Apply Frenzied → Disable via Actor sheet → Net -1 SP
2. ✅ Character with Berserker: Apply Frenzied → Disable via Actor sheet → Net 0 SP  
3. ✅ Character with Controlled Anger: Apply Frenzied → Disable via Actor sheet → Net +1 SP
4. ✅ Token HUD toggle still works correctly (should already work)
5. ✅ Delete effect still works correctly (should already work)
6. ✅ Re-enabling the effect doesn't cause double-application
7. ✅ Chat message appears with correct SP loss values

---

**Investigation completed**: February 4, 2026  
**Investigator**: GitHub Copilot (Claude Sonnet 4.5)
