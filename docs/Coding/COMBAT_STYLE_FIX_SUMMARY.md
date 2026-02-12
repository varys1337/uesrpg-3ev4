# Combat Style Restoration — Implementation Summary

## Root Cause

Post-refactor regression: The item sheet data preparation helper (`src/ui/sheets/item/prepare.js`) did not provide Combat Style-specific context variables (`isActiveCombatStyle`, `specialActionsRegistry`) that the template expected.

## Files Changed

### 1. `src/ui/sheets/item/prepare.js`
**Added**: Combat Style data preparation in `prepareItemSheetData()`
- Import `SPECIAL_ACTIONS` from config
- Populate `data.isActiveCombatStyle` flag (compares active style ID with current item ID)
- Populate `data.specialActionsRegistry` array for template rendering

**Lines added**: ~15 lines

### 2. `templates/combatStyle-sheet.html`
**Modified**: Active style control button (line ~77-85)
- Changed from disabled button to conditional toggle button
- Shows "Deactivate" when style is active
- Shows "Set as Active" when style is inactive

**Lines changed**: ~7 lines

### 3. `src/ui/sheets/item/listeners/index.js`
**Added**: Deactivate button click handler
- Mirrors existing "Set as Active" handler
- Calls `actor.unsetFlag("uesrpg-3ev4", "activeCombatStyleId")`
- Re-renders both actor sheet and item sheet

**Lines added**: ~12 lines

## What Was Already Working

✅ **Active style storage** - `flags.uesrpg-3ev4.activeCombatStyleId`  
✅ **Set active listener** - Already wired in listeners/index.js  
✅ **Special advantages auto-save** - Checkbox change handler working  
✅ **Combat TN integration** - Correctly reads active style from flag  
✅ **Special Actions resolution** - `getKnownSpecialActionIdsFromActiveStyle()` correctly reads `system.specialAdvantages`  
✅ **Single-active enforcement** - `setFlag()` overwrites, ensuring only one active style

## What Was Fixed

🔧 **Missing `isActiveCombatStyle` flag** - Now populated in getData()  
🔧 **Missing `specialActionsRegistry`** - Now populated in getData()  
🔧 **No deactivate control** - Added conditional toggle button  
🔧 **No deactivate listener** - Added unsetFlag() handler

## Testing Checklist

- [x] **Data prep**: `isActiveCombatStyle` and `specialActionsRegistry` populated in getData()
- [x] **Import**: `SPECIAL_ACTIONS` imported correctly
- [x] **Template**: Conditional button renders based on active state
- [x] **Listener**: Deactivate handler mirrors activate handler
- [x] **No errors**: `get_errors` returns clean
- [ ] **Manual test**: Activate Style A → shows "Deactivate" button
- [ ] **Manual test**: Activate Style B → Style A becomes inactive
- [ ] **Manual test**: Special Advantages checkboxes render (8 items)
- [ ] **Manual test**: Toggle advantages → persist correctly
- [ ] **Manual test**: Combat TN reflects active style
- [ ] **Manual test**: Special Actions known list updates with active style

## Unchanged (By Design)

- **TN computation pipeline** - No changes needed, already correct
- **Authority proxy** - Not needed (flag operations are owner-safe)
- **Schema** - No new fields added
- **Helpers** - Reused all existing utilities

## Edge Cases Handled

- **Item not owned**: Template guards with `{{#if item.isOwned}}`
- **No actor**: Data prep checks `sheet.item?.isOwned && sheet.actor`
- **Missing flag**: Returns `null`, comparison yields `false` correctly
- **Re-render stability**: `.off().on()` pattern prevents double-binding

## Next Steps (Manual Verification Required)

1. **Launch Foundry v13.351** with this system
2. **Create two Combat Style items** on a test Actor
3. **Verify activate/deactivate toggle** works correctly (single-active enforcement)
4. **Verify Special Advantages grid** renders 8 checkboxes
5. **Verify advantage toggles persist** after close/reopen
6. **Verify Combat TN** reflects active style value
7. **Verify Special Actions known list** updates when active style changes

## Documentation

- **Improved agent command**: [COMBAT_STYLE_RESTORATION.md](COMBAT_STYLE_RESTORATION.md)
- **RAW reference**: [docs/Core/Chapter 3 - Skills.md](../Core/Chapter%203%20-%20Skills.md#special-advantages)
- **Special Actions config**: [src/core/config/special-actions.js](../../src/core/config/special-actions.js)
- **Active style utils**: [src/core/combat/combat-style-utils.js](../../src/core/combat/combat-style-utils.js)
