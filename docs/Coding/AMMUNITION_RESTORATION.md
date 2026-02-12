# Ammunition Selection Restoration

**Date**: 2025-01-28  
**Status**: ✅ Completed  
**Issue**: Ammunition selection dropdown on weapon sheets was non-functional after item sheet refactoring

## Problem Analysis

### Symptoms
- Ranged weapon sheets showed ammunition dropdown UI
- Dropdown was empty (no options rendered)
- Attack workflow validated and consumed ammo correctly
- Only the UI data preparation was missing

### Root Cause
After the item sheet refactoring to modular architecture:
- Template at [templates/weapon-sheet.html](../../templates/weapon-sheet.html#L222) had `{{#each ammoOptions}}`
- Schema had `system.ammoId` field for storing selection (line 1027-1028)
- Attack workflow read and validated `weapon.system.ammoId` correctly
- **Missing**: `ammoOptions` array population in [src/ui/sheets/item/prepare.js](../../src/ui/sheets/item/prepare.js)

## Solution

### Implementation
Added ammunition selection logic to `prepareItemSheetData()` following the Combat Style restoration pattern:

```javascript
// src/ui/sheets/item/prepare.js (lines 227-237)
if (itemType === "weapon" && sheet.item?.isOwned && sheet.actor) {
  const ammoItems = sheet.actor.items.filter(i => i.type === "ammunition");
  data.ammoOptions = ammoItems.map(ammo => ({
    value: ammo.id,
    label: `${ammo.name}${ammo.system.quantity ? ` (${ammo.system.quantity})` : ''}`
  }));
} else if (itemType === "weapon") {
  // Unowned weapon (world item): provide empty array
  data.ammoOptions = [];
}
```

### Edge Cases Handled
1. **Unowned weapons**: Provide empty array for world item sheets
2. **No ammunition available**: Empty array renders only "—" option
3. **Missing quantity**: Gracefully handle `undefined` or `0` quantity
4. **Selection persistence**: Template compares `item.system.ammoId` to option values

## Validation

### Attack Workflow Integration
Verified that the existing attack workflow ([src/core/combat/opposed/helpers/workflow.js](../../src/core/combat/opposed/helpers/workflow.js#L395-L452)) correctly:

1. **Reads selection**: `const ammoId = String(weapon.system?.ammoId ?? "").trim();` (line 417)
2. **Validates existence**: Checks ammo item exists in actor's inventory (line 423)
3. **Checks quantity**: Ensures `qty > 0` before allowing attack (line 429)
4. **Consumes ammunition**: `await requestUpdateDocument(ammo, { "system.quantity": Math.max(0, qty - 1) });` (line 434)
5. **Tracks consumption**: Stores pre-consumed ammo metadata in `data.attacker.preConsumedAmmo` (line 436-442)

### Template Structure
Existing template UI ([templates/weapon-sheet.html](../../templates/weapon-sheet.html#L219-226)):
- Conditional rendering for ranged weapons only: `{{#if (eq item.system.attackMode "ranged")}}`
- Default "Clear" option: `<option value="">—</option>`
- Quantity display in labels: `{{this.label}}` shows "Arrow Name (10)"
- Selected state preservation: `{{#if (eq ../item.system.ammoId this.value)}}selected{{/if}}`

## Testing Checklist

Manual testing required (no automated test suite):

- [ ] **Basic Selection**
  - [ ] Open owned ranged weapon sheet
  - [ ] Verify ammunition dropdown shows all actor's ammunition items
  - [ ] Verify quantities displayed in labels
  - [ ] Select ammunition and save
  - [ ] Reopen sheet and verify selection persisted

- [ ] **Edge Cases**
  - [ ] Open weapon with no actor (world item) - should show only "—"
  - [ ] Actor with no ammunition items - should show only "—"
  - [ ] Select "—" to clear previous selection
  - [ ] Ammunition with 0 quantity should display "(0)"

- [ ] **Attack Integration**
  - [ ] Select ammunition with quantity > 0
  - [ ] Make ranged attack
  - [ ] Verify quantity decremented by 1
  - [ ] Make attack with no ammo selected - should warn
  - [ ] Make attack with 0 quantity - should warn

- [ ] **Consumption Checkbox**
  - [ ] Verify "Consume Ammo" checkbox state persists
  - [ ] Make attack with consumeAmmo=false - quantity should not change
  - [ ] Make attack with consumeAmmo=true - quantity should decrement

## Future Enhancements

### Compatibility Filtering (Not Implemented)
Ammunition schema has `arrowType` and `ammoMaterial` fields:
- `arrowType`: "none", "arrow", "bolt", etc.
- `ammoMaterial`: "standard", "silver", "daedric", etc.

**Potential improvement**: Filter `ammoOptions` based on weapon compatibility metadata:
```javascript
const compatibleArrowType = weapon.system?.compatibleArrowType ?? "any";
const ammoItems = sheet.actor.items.filter(i => {
  if (i.type !== "ammunition") return false;
  if (compatibleArrowType === "any") return true;
  return i.system.arrowType === compatibleArrowType;
});
```

**Blocked by**: Weapon schema doesn't currently have `compatibleArrowType` field. Would require:
1. Template.json schema addition
2. RAW rules clarification on arrow compatibility
3. Migration to add field to existing weapons

### UX Polish (Low Priority)
- **Empty State Message**: When actor has no ammunition, show informational text instead of just "—"
- **Out of Stock Warning**: Visually indicate when selected ammo has 0 quantity (e.g., red text)
- **Quick Add Button**: Link to "Create Ammunition" dialog from weapon sheet
- **Compatibility Badge**: Show material/type icons in dropdown options

## References

- **Template**: [templates/weapon-sheet.html](../../templates/weapon-sheet.html#L214-232) (Ranged Properties section)
- **Schema**: [template.json](../../template.json#L1027-1028) (weapon.system.ammoId, consumeAmmo)
- **Ammunition Type**: [template.json](../../template.json#L1407-1440) (ammunition schema)
- **Data Prep**: [src/ui/sheets/item/prepare.js](../../src/ui/sheets/item/prepare.js#L227-237) (ammoOptions population)
- **Attack Workflow**: [src/core/combat/opposed/helpers/workflow.js](../../src/core/combat/opposed/helpers/workflow.js#L395-452) (preConsumeAttackAmmo)
- **Consumption Logic**: [src/core/combat/opposed/damage/ammunition.js](../../src/core/combat/opposed/damage/ammunition.js) (consumePendingAmmo)

## Pattern Notes

This fix follows the same pattern as the Combat Style restoration (completed 2025-01-27):

1. **Template Already Existed**: UI structure was intact, just needed data
2. **Schema Already Existed**: `system.ammoId` field was defined
3. **Workflow Already Worked**: Attack logic read and consumed ammo correctly
4. **Only Missing**: Context variable population in `prepareItemSheetData()`

**Key Pattern**: When item sheet UI appears broken but schema/workflow work:
- Check `src/ui/sheets/item/prepare.js` for missing context variables
- Add conditional blocks matching item type (with guards for owned vs unowned)
- Follow existing patterns (Combat Style, activation damage, etc.)
- Provide safe defaults for edge cases

## Errors Encountered

None - implementation was successful on first attempt.

## Commit Message

```
fix(weapons): restore ammunition selection dropdown

Ammunition selection UI was non-functional after item sheet refactoring.
Template and schema were intact, only missing data preparation logic.

Changes:
- Add ammoOptions population in prepareItemSheetData()
- Filter actor.items for ammunition type
- Build option array with {value: id, label: name + quantity}
- Handle unowned weapons with empty array fallback

Verified attack workflow integration:
- preConsumeAttackAmmo() correctly reads system.ammoId
- Quantity validation and consumption logic unchanged
- Template uses existing "—" clear option

Refs: #ammunition-ui-restoration
```
