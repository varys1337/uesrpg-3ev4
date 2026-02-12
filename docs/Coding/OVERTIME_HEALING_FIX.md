# OverTime Healing Spell Fix

**Date:** 2026-02-08  
**Issue:** Healing spells with `hasOverTime: true` never created Active Effects, causing overtime ticks to find 0 effects  
**Status:** ✅ Fixed

---

## Problem Summary

Healing spells with overtime effects (e.g., Regeneration) were completely non-functional:

1. ✅ Spell cast succeeded, Origin AE created
2. ✅ Initial healing applied correctly
3. ❌ **No target AE created** - `applySpellEffectsToTarget()` never called
4. ❌ Overtime engine found 0 effects to process (`scanned 0 effects on 27 actors`)

**Root Cause:** Three outcome resolution functions applied immediate healing then returned early, bypassing the `applySpellEffectsToTarget()` call that creates tracker AEs with overTime flags.

---

## Code Analysis

### Damaging Spells (Working Correctly)

```javascript
// src/core/magic/opposed/outcome-resolution.js (lines 159-165)
const damageResult = await applyMagicDamage(effectiveTarget, ...);

if (!damageResult?.spellAbsorbed && spellNeedsEffectApplication(spell)) {
  // ✅ Creates tracker AE with overTime flags
  await applySpellEffectsToTarget(attacker, effectiveTarget, spell, { ... });
}
```

### Healing Spells (Broken - Early Return)

```javascript
// BEFORE FIX (lines 113-125)
const healResult = await applyMagicHealing(effectiveTarget, healValue, spell, { ... });

if (healResult?.spellAbsorbed) {
  outcome.healingApplied = null;
  outcome.spellAbsorbed = true;
}

// ❌ Missing: applySpellEffectsToTarget() call
// ❌ Early return - never creates AEs!
markResolutionPhase(data);
await _updateCard(message, data);
return;
```

---

## Fix Applied

Added `applySpellEffectsToTarget()` call to all three healing resolution paths, matching the pattern used for damaging spells:

### AFTER FIX

```javascript
const healResult = await applyMagicHealing(effectiveTarget, healValue, spell, { ... });

if (healResult?.spellAbsorbed) {
  // Spell absorbed - no effects
  outcome.healingApplied = null;
  outcome.spellAbsorbed = true;
} else {
  // ✅ Apply spell effects (Upkeep, overTime, embedded AEs, buffs) if healing was not absorbed
  if (spellNeedsEffectApplication(spell)) {
    await applySpellEffectsToTarget(attacker, effectiveTarget, spell, { 
      actualCost: Number(data.attacker?.mpSpent ?? spell.system?.cost ?? 0), 
      originalCastTime: Number(data.context?.originalCastWorldTime ?? game.time?.worldTime ?? 0) || 0 
    });
  }
}

markResolutionPhase(data);
await _updateCard(message, data);
return;
```

---

## Files Modified

**src/core/magic/opposed/outcome-resolution.js** - 3 functions patched:

1. **`resolveDirectUndefendable()`** (lines 113-136)  
   - Used for Direct/Undefendable spells like Regeneration
   - Added effect application after `applyMagicHealing()`, before early return

2. **`resolveDirectNoTest()`** (lines 264-285)  
   - Used for legacy direct spells (auto-success, no test)
   - Added effect application after `applyMagicHealing()`, before early return

3. **`resolveHealingDirect()`** (lines 414-430)  
   - Used for specialized healing-only direct casts
   - Added effect application after `applyMagicHealing()`, before final update
   - Also added missing `markResolutionPhase(data)` call

---

## Testing Validation

### Expected Behavior After Fix

**Regeneration Spell Cast:**
```
[UESRPG][OriginAE] Origin AE created {id: 'Xt4RUjww...', ...}
UESRPG | applyHealing CALLED {actor: 'Necromancer', healing: 2}

[UESRPG][SpellEffects] Creating tracker AE {spell: 'Regeneration', target: 'Necromancer'}
[UESRPG][SpellEffects] Injecting overTime flags {trigger: 'turnStart', maxTicks: null}
[UESRPG][OriginAE] Registered 1 target AE {originId: 'Xt4RUjww...', linkedCount: 1}
```

**Turn Advance:**
```
[UESRPG][OverTime] Collection Phase: Looking for effects with trigger="turnStart"
[UESRPG][OverTime]   └─ Scanning world actors (27)
[UESRPG][OverTime]     ✓ Eligible: "Regeneration" on Necromancer
[UESRPG][OverTime]   Collection Summary: 1 eligible | scanned 1 effects on 27 actors

[UESRPG][OverTime] Processing: "Regeneration" {payload: "healing", formula: "2"}
UESRPG | applyHealing CALLED {actor: 'Necromancer', healing: 2, source: 'Regeneration overtime'}
[UESRPG][OverTime]   ✓ Healing applied successfully
```

### Test Cases

1. **Regeneration (hasOverTime: true, hasUpkeep: true)**
   - Initial healing: 2 HP ✅
   - Tracker AE created with overTime flags ✅
   - Overtime ticks every turn applying 2 HP healing ✅
   - Upkeep prompt when spell expires ✅

2. **Fast Healing (hasOverTime: true, no Upkeep)**
   - Initial healing applied ✅
   - Tracker AE created ✅
   - Overtime ticks apply healing ✅
   - Effect expires cleanly when duration ends ✅

3. **Spell Absorption Interaction**
   - If `applyMagicHealing()` returns `spellAbsorbed: true`
   - NO Active Effects created (correct behavior) ✅
   - Overtime engine finds 0 effects (expected) ✅

---

## Related Systems

- **spell-effects.js** (lines 145-240): Injects overTime flags into tracker AEs
- **overtime-engine.js**: Collection phase now finds AEs created by fixed healing paths
- **spell-tick-engine.js**: Dispatcher unchanged - continues working correctly
- **damage-application.js**: `applyMagicHealing()` unchanged - returns `spellAbsorbed` flag

---

## Architecture Notes

### Why `spellNeedsEffectApplication(spell)` Check?

From **src/core/magic/opposed/spell-helpers.js** (line 33):

```javascript
export function spellNeedsEffectApplication(spell) {
  if (!spell) return false;
  if (Boolean(spell.system?.hasUpkeep)) return true;
  if ((spell.effects?.size ?? 0) > 0) return true;
  return spellHasFiniteDuration(spell);
}
```

Returns `true` when spell has:
- Upkeep requirement (`system.hasUpkeep`)
- Embedded Active Effects (`effects.size > 0`)
- Finite duration (`duration.rounds`, `duration.seconds`, etc.)

**Regeneration** returns `true` because it has `hasUpkeep: true`.

### Permission-Safe Mutations

The `applySpellEffectsToTarget()` function uses authority proxy helpers internally:

```javascript
// spell-effects.js (lines 267-268)
if (targetActor.isOwner) 
  createdEffects = await targetActor.createEmbeddedDocuments("ActiveEffect", toCreate);
else 
  createdEffects = await requestCreateEmbeddedDocuments(targetActor, "ActiveEffect", toCreate);
```

This ensures non-owner casters (e.g., GM casting on player token) properly route mutations through the authority proxy to the owning client or GM.

---

## Historical Context

This bug was introduced when healing paths were refactored to call `applyMagicHealing()` instead of directly applying damage-like effects. The damage paths correctly retained the `applySpellEffectsToTarget()` call, but healing paths omitted it, assuming healing was purely immediate.

**Oversight:** The assumption "healing = immediate only" broke when overtime healing spells (Regeneration, Fast Healing) were introduced, which require tracker AEs to carry the overTime configuration.

---

## Prevention

**Future Refactoring Checklist:**
- [ ] When modifying outcome resolution paths, verify ALL branches call `applySpellEffectsToTarget()` when `spellNeedsEffectApplication(spell) === true`
- [ ] Test with spells that have:
  - `hasUpkeep: true`
  - `hasOverTime: true`
  - Embedded Active Effects
  - Finite duration
- [ ] Verify Origin AE `linkedCount > 0` in debug logs after casting

---

## Compatibility

- **Foundry VTT:** v13.351 only
- **Breaking Changes:** None - pure bug fix
- **Migration Required:** No
- **Backward Compatible:** Yes - existing spells work as before, healing spells now work correctly

---

## See Also

- [Active Effect Wiki](../Active%20Effect%20Wiki.md) - Complete modifier keys reference
- [timekeeping.md](../timekeeping.md) - Time service API for spell durations
- [docs/architecture/spells-framework-final.md](../architecture/spells-framework-final.md) - Spell framework architecture
- [COMBAT_WORKFLOW_REFACTOR_FIXES.md](./COMBAT_WORKFLOW_REFACTOR_FIXES.md) - Related combat workflow fixes
