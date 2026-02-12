# Combat Style Item Restoration — Improved Agent Command

## Problem Statement

**Post-refactor regression**: Combat Style items lost prior sheet functionality during the item sheet refactoring. The UI template exists but the necessary data preparation and functionality wiring is missing.

### Missing/Broken Features

1. **`isActiveCombatStyle` flag** - Template expects this flag in `getData()` to show active status and disable the "Set as Active" button when already active
2. **`specialActionsRegistry` array** - Template expects this to render the Special Advantages checkboxes grid
3. **Deactivate control** - No UI element exists to deactivate an active style (only "Set as Active" button)

### Working Features (Verified in Repository)

✅ **Active style storage** - Uses `actor.getFlag("uesrpg-3ev4", "activeCombatStyleId")` (see [combat-style-utils.js](../src/core/combat-style-utils.js))
✅ **Set active listener** - Working click handler in [listeners/index.js](../src/ui/sheets/item/listeners/index.js#L99)
✅ **Special advantages auto-save** - Working checkbox change handler in [listeners/index.js](../src/ui/sheets/item/listeners/index.js#L88)
✅ **Combat TN integration** - [tn.js](../src/core/combat/tn.js) reads combat styles correctly
✅ **Special Actions known resolution** - [combat-style-utils.js](../src/core/combat-style-utils.js#L50) `getKnownSpecialActionIdsFromActiveStyle()` correctly reads `item.system.specialAdvantages`

## Root Cause Analysis

The item sheet data preparation helper ([src/ui/sheets/item/prepare.js](../src/ui/sheets/item/prepare.js)) does **not** provide Combat Style-specific context variables to the template. The template references `{{isActiveCombatStyle}}` and `{{specialActionsRegistry}}` but these are never populated in `getData()`.

## Solution Design

### Step 1: Enhance Item Sheet Data Preparation

**File**: `src/ui/sheets/item/prepare.js`

Add Combat Style-specific data preparation:

```javascript
// After line ~217 (before return data)

// --------------------------------------------
// Combat Style: Active status + Special Actions registry
// --------------------------------------------
if (itemType === "combatStyle" && sheet.item?.isOwned && sheet.actor) {
  const activeStyleId = sheet.actor.getFlag("uesrpg-3ev4", "activeCombatStyleId");
  data.isActiveCombatStyle = (activeStyleId === sheet.item.id);
  data.specialActionsRegistry = SPECIAL_ACTIONS;
}
```

**Import required**: Add to top of file:
```javascript
import { SPECIAL_ACTIONS } from "../../../core/config/special-actions.js";
```

### Step 2: Add Deactivate Functionality (Optional Enhancement)

The current UI only allows "Set as Active". For completeness, add deactivate control.

#### Option A: Modify Existing Button (Recommended)

Change the button behavior to toggle:

**Template**: `templates/combatStyle-sheet.html` (line ~81)

```handlebars
{{#if isActiveCombatStyle}}
  <button type="button" class="uesrpg-deactivate-style">Deactivate</button>
{{else}}
  <button type="button" class="uesrpg-set-active-style">Set as Active</button>
{{/if}}
```

**Listener**: `src/ui/sheets/item/listeners/index.js` (after line ~110)

```javascript
html.find(".uesrpg-deactivate-style").off("click.uesrpg").on("click.uesrpg", async (ev) => {
  ev.preventDefault();
  try {
    await sheet.actor.unsetFlag("uesrpg-3ev4", "activeCombatStyleId");
    ui.notifications?.info?.("Combat style deactivated.");
    sheet.actor.sheet?.render?.(false);
    sheet.render(false);
  } catch (err) {
    console.error("UESRPG | Failed to deactivate combat style", err);
    ui.notifications?.error?.("Failed to deactivate combat style.");
  }
});
```

#### Option B: Keep Current UI (No Deactivate)

If deactivation is not required by RAW, skip Step 2. The current "Set as Active" button already enforces single-active by only being enabled when inactive.

### Step 3: Verify Single-Active Enforcement

**Current implementation** (already correct): The "Set as Active" listener in `listeners/index.js` calls:

```javascript
await sheet.actor.setFlag("uesrpg-3ev4", "activeCombatStyleId", sheet.item.id);
```

This **overwrites** the flag, so only one style can be active at a time. ✅ No additional enforcement needed.

### Step 4: Verify TN Integration

**Already working** ✅ - Confirmed via code inspection:

1. **Combat Attack TN** ([src/core/combat/tn.js](../src/core/combat/tn.js#L172)):
   - Reads combat styles via `listCombatStyles(actor)` 
   - Supports both item-based styles and NPC profession styles
   
2. **Special Actions Known** ([src/core/combat/combat-style-utils.js](../src/core/combat-style-utils.js#L50)):
   - `getKnownSpecialActionIdsFromActiveStyle(actor)` reads `specialAdvantages` from active style
   - Used by opposed workflow to filter advantage options

**No changes required in TN computation.**

## Implementation Checklist

- [ ] Add `isActiveCombatStyle` and `specialActionsRegistry` to `prepareItemSheetData()` in `src/ui/sheets/item/prepare.js`
- [ ] Import `SPECIAL_ACTIONS` in `src/ui/sheets/item/prepare.js`
- [ ] (Optional) Add deactivate button to `templates/combatStyle-sheet.html`
- [ ] (Optional) Add deactivate listener to `src/ui/sheets/item/listeners/index.js`
- [ ] Test: Activate Style A → shows "Yes" and button disabled (or shows Deactivate button)
- [ ] Test: Activate Style B → Style A becomes inactive, Style B shows active
- [ ] Test: Special Advantages checkboxes render and persist correctly
- [ ] Test: Combat attack TN reflects active style (no regression)
- [ ] Test: Special Actions known list updates when active style changes

## Files Changed Summary

### Required Changes
1. **src/ui/sheets/item/prepare.js** - Add Combat Style data preparation (~10 lines)

### Optional Changes (Deactivate Feature)
2. **templates/combatStyle-sheet.html** - Conditional deactivate button (~4 lines)
3. **src/ui/sheets/item/listeners/index.js** - Deactivate click handler (~12 lines)

## Why This is Minimal

- **No new helpers**: Reuses existing `SPECIAL_ACTIONS`, `getFlag()`, `setFlag()`, `unsetFlag()`
- **No schema changes**: Uses existing `flags.uesrpg-3ev4.activeCombatStyleId` and `system.specialAdvantages`
- **No TN changes**: Combat TN pipeline already works correctly
- **No duplicate code**: Data preparation follows existing pattern in `prepareItemSheetData()`

## Testing Notes

### Active Style Toggle
1. Create two Combat Style items on an Actor
2. Open Style A sheet → shows "Active Style: No", button enabled
3. Click "Set as Active" → shows "Active Style: Yes", button disabled (or shows "Deactivate")
4. Open Style B sheet → shows "Active Style: No"
5. Click "Set as Active" on Style B → Style B becomes active
6. Re-open Style A sheet → now shows "Active Style: No"

### Special Advantages
1. Open Combat Style sheet → Special Advantages grid renders 8 checkboxes (Arise, Bash, Blind Opponent, Disarm, Feint, Force Movement, Resist, Trip)
2. Check "Disarm", "Feint", "Trip" → close sheet
3. Re-open sheet → checked boxes persist
4. Verify in console: `actor.items.getName("Style Name").system.specialAdvantages` shows `{ disarm: true, feint: true, trip: true, ... }`

### Combat TN Integration
1. Set Style A as active
2. Perform opposed combat attack → TN includes Style A value
3. Switch to Style B (activate it)
4. Perform opposed combat attack → TN now includes Style B value
5. No reload required for TN update

### Special Actions Known
1. Style A: Enable "Disarm" and "Feint" advantages
2. Set Style A as active
3. Win advantage in opposed combat → only "Disarm" and "Feint" appear in advantage spend options
4. Switch to Style B with different advantages enabled → advantage options update to Style B's list

## Edge Cases Handled

- **Item not owned**: Template already guards with `{{#if item.isOwned}}`
- **No actor**: Data prep checks `sheet.item?.isOwned && sheet.actor`
- **Missing flag**: `getFlag()` returns `null`, comparison with `item.id` correctly yields `false`
- **Legacy data**: Missing `specialAdvantages` map handled by `lookup` helper returning `undefined` → checkbox unchecked
- **Re-render stability**: Listeners use `.off().on()` pattern to prevent double-binding

## Known Limitations (Out of Scope)

- **No validation**: System doesn't prevent activating an un-owned Combat Style (but template guards against showing button)
- **No hooks**: Activating/deactivating a style doesn't emit custom hooks for integrations
- **No multi-actor updates**: If multiple tokens share an actor, only the clicked sheet re-renders (this is standard Foundry behavior)

## References

- **RAW**: [docs/Core/Chapter 3 - Skills.md](../../docs/Core/Chapter%203%20-%20Skills.md#special-advantages) (page 69 in PDF)
- **SPECIAL_ACTIONS registry**: [src/core/config/special-actions.js](../../src/core/config/special-actions.js)
- **Active style resolution**: [src/core/combat/combat-style-utils.js](../../src/core/combat/combat-style-utils.js)
- **Combat TN computation**: [src/core/combat/tn.js](../../src/core/combat/tn.js)
