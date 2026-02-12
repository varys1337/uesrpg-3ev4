# Frenzied SP Cost Investigation Summary

## Investigation Results

### RAW Documentation (Chapter 4 - Talents & Traits)

**Baseline Frenzied Condition** (Chapter 5):
- When frenzied condition ends: **Lose 2 SP** (cannot kill)

**Berserker** (Novice, Willpower):
> "The character may take a Primary Action to gain the Frenzied condition. They only attack enemies as long as the condition was entered voluntarily. **When the character loses the frenzied condition, they only lose 1 SP instead of the usual 2.**"

**Controlled Anger** (Adept, Willpower, Requires Berserker):
> "Once per Short Rest, the character may remove the Frenzied condition as a Free Action. They can also roll a +0 Willpower test to take control of any involuntarily applied Frenzied condition. **The character no longer loses SP as part of losing the Frenzied condition**, but cannot retain SP over their max SP. They also halve any skill test penalties associated with the Frenzied condition."

**Keen Intuition** (Expert, Perception):
> "The character has a powerful intuition developed through experience and rarely misses important details. When the character passes an Observe skill test they can choose to take the number of degrees of success that they rolled or take a number equal to their Observe skill rank instead."

**NOTE**: Keen Intuition has **NOTHING** to do with Frenzied SP loss! It's an Observe skill talent.

### Current Code Implementation

**File**: `src/core/conditions/frenzied.js`

**Lines 207-220** - `_getTalentModifiers(actor)`:
```javascript
// Base values
let wtBonus = 3;
let sbBonus = 1;
let spBonus = 1;
let skillPenalty = -20;
let spLossOnEnd = 2;  // ✅ BASELINE: 2 SP (CORRECT)

// Controlled Anger: halve skill penalty, no SP loss
if (hasControlled) {
  skillPenalty = -10;
  spLossOnEnd = 0;  // ✅ Controlled Anger: 0 SP (CORRECT)
} else if (hasBerserker) {
  // Berserker (without Controlled): SP loss 2 → 1
  spLossOnEnd = 1;  // ✅ Berserker: 1 SP (CORRECT)
}
```

**Line 778** - `_applyFrenziedEndEffects`:
```javascript
const spLoss = applySPLoss ? Math.max(0, Number(mods.spLossOnEnd ?? 0) || 0) : 0;
```

**Line 780** - Cannot kill them behavior:
```javascript
const newSP = spLoss > 0 ? Math.max(1, currentSP - spLoss) : currentSP;
```
This ensures SP never drops below 1 (cannot kill via Frenzied end).

### Conclusion

**The current implementation is CORRECT and matches RAW**:

| Scenario | RAW SP Loss | Code SP Loss | Status |
|----------|-------------|--------------|--------|
| No talents | 2 SP | 2 SP | ✅ CORRECT |
| Berserker | 1 SP | 1 SP | ✅ CORRECT |
| Controlled Anger | 0 SP | 0 SP | ✅ CORRECT |
| Keen Intuition | N/A (unrelated) | N/A | ✅ CORRECT |

### User's Task Description Issues

The task description contains factual errors:

1. ❌ Claims baseline is "1 SP" - **RAW and code both specify 2 SP**
2. ❌ Claims "Keen Intuition" reduces SP loss - **Keen Intuition is an Observe talent, has nothing to do with Frenzied**
3. ❌ The talent that reduces SP loss to 1 is **Berserker**, not Keen Intuition

### Possible Explanations for User's Confusion

1. **Testing with Berserker**: User may have tested with a character that has Berserker talent, which correctly reduces SP loss to 1, and mistakenly thought this was the baseline
2. **Talent Name Confusion**: User confused "Keen Intuition" with "Berserker"
3. **Old Documentation**: User may be referring to outdated/homebrew rules not matching this system's RAW implementation

### Recommendation

**NO CODE CHANGES NEEDED** - The implementation is correct and matches RAW documentation.

If the user insists they are seeing 1 SP baseline in their runtime environment, they should:
1. Verify their character doesn't have Berserker talent
2. Check console logs for the SP loss application (includes talent modifiers)
3. Verify they are running the latest code from this repository

### Testing Verification

To manually verify the correct behavior:

1. **Create test character WITHOUT any Berserker/Controlled Anger talents**
2. **Apply Frenzied condition**: `game.uesrpg.conditions.frenzied.apply(actor)`
3. **Remove Frenzied condition**: `game.uesrpg.conditions.frenzied.remove(actor)`
4. **Check chat message**: Should show "Spent 2 Stamina Points"
5. **Check SP value**: Should be `original - 2`, clamped to minimum 1

With **Berserker** talent:
- Should show "Spent 1 Stamina Point" (with "Berserker (SP loss 1)" modifier label)

With **Controlled Anger** talent:
- Should show "No Stamina spent" (with "Controlled Anger (SP loss 0)" modifier label)

