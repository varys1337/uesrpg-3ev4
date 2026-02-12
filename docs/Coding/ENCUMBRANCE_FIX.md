# Encumbrance Calculation Fix

## Problem Statement
After item sheet refactoring (item-sheet.js reduced from 1331 to 278 lines), items no longer contributed to actor encumbrance calculations. Actors showed 0 ENC regardless of inventory contents.

## Root Cause
**Scenario B: Items Missing `enc` Field Values**

The encumbrance calculation logic was structurally intact:
- ✅ `aggregateItemStats()` correctly reads `item.system.enc`
- ✅ Form templates have `name="system.enc"` inputs
- ✅ `_updateObject()` passes all formData to super (no filtering)

**However**: Some items (especially older items or items imported from compendia) lacked `system.enc` field values, causing them to default to 0 and not contribute to encumbrance.

## Solution Implemented
Added enc field initialization to the existing item normalization pipeline in [src/core/migrations/items.js](../../src/core/migrations/items.js):

### Changes Made
1. **`_normalizeItemSystem()` function**: Added enc field initialization for all physical item types
   ```javascript
   // ENC field initialization (fix for encumbrance calculation breakage after item sheet refactoring)
   // All physical items (weapon, armor, container, ammunition, item) should have enc field.
   // This ensures items contribute to actor encumbrance calculations.
   const physicalTypes = ["weapon", "armor", "container", "ammunition", "item"];
   if (physicalTypes.includes(type)) {
     if (!Object.prototype.hasOwnProperty.call(system, "enc") || system.enc == null) {
       system.enc = 0;  // Default to 0; users can set actual weights in item sheets
       changed = true;
     }
   }
   ```

2. **`_normalizeWorldItems()` function**: Expanded filter to include all physical item types
   - Before: `["weapon", "armor", "ammunition"]`
   - After: `["weapon", "armor", "ammunition", "container", "item"]`

3. **`_normalizeActorItems()` function**: Same filter expansion

### Migration Behavior
- Runs automatically on world load (`ready` hook in src/system.js)
- Only initializes missing `enc` fields (preserves existing values)
- Defaults to `enc: 0` (users can edit in item sheets)
- Logs migration activity to console: `"UESRPG | Normalizing N world item(s)"`

## Validation

### Pre-Fix Diagnostic Commands (Foundry Console)
Use these to diagnose the issue before applying the fix:

```javascript
// Test 1: Check if items have enc field
const actor = game.actors.contents[0];
if (actor) {
  const noEnc = actor.items.filter(i => i.system.enc == null || i.system.enc === undefined);
  console.log(`Items missing 'enc' field: ${noEnc.length} / ${actor.items.size}`);
  if (noEnc.length > 0) {
    console.log("Examples:", noEnc.slice(0, 5).map(i => ({ name: i.name, type: i.type, enc: i.system.enc })));
  }
}
```

```javascript
// Test 2: Check current encumbrance calculation
const actor = game.actors.contents[0];
if (actor) {
  console.log("=== ENCUMBRANCE DIAGNOSTIC ===");
  console.log("Actor:", actor.name);
  console.log("Items:", actor.items.size);
  
  const sample = actor.items.contents.slice(0, 5);
  for (const item of sample) {
    console.log(`Item: ${item.name} | Type: ${item.type} | ENC: ${item.system.enc} | Qty: ${item.system.quantity}`);
  }
  
  console.log("\n=== CARRY RATING ===");
  console.log("Current ENC:", actor.system.carry_rating.current);
  console.log("Max ENC:", actor.system.carry_rating.max);
}
```

### Post-Fix Validation
After applying the fix, reload the world and verify:

1. **Check console logs**: Should see `"UESRPG | Normalizing N world item(s)"` (if items were updated)

2. **Verify enc fields exist**:
   ```javascript
   const actor = game.actors.contents[0];
   const noEnc = actor.items.filter(i => i.system.enc == null);
   console.log(`Items still missing enc: ${noEnc.length}`); // Should be 0
   ```

3. **Verify encumbrance calculates**:
   ```javascript
   const actor = game.actors.contents[0];
   console.log("Current ENC:", actor.system.carry_rating.current);
   // Should now show actual item weights (may be 0 if items weren't assigned weights yet)
   ```

4. **Test item weight editing**:
   - Open any physical item sheet
   - Set ENC to a non-zero value (e.g., 5)
   - Close sheet
   - Check actor sheet - encumbrance should increase
   - Reopen item - ENC value should persist

5. **Test container logic**:
   ```javascript
   const actor = game.actors.contents[0];
   // Create a container with enc=1
   await actor.createEmbeddedDocuments("Item", [{
     name: "Test Backpack",
     type: "container",
     system: { enc: 1, "container_enc.max": 10 }
   }]);
   
   // Create an item with enc=5
   const testItem = await actor.createEmbeddedDocuments("Item", [{
     name: "Heavy Sword",
     type: "weapon",
     system: { enc: 5 }
   }]);
   
   console.log("Before containment:", actor.system.carry_rating.current); // Should be 6 (1+5)
   
   // Put item in container
   const container = actor.items.getName("Test Backpack");
   await testItem[0].update({ "system.containerStats.contained": true, "system.containerId": container.id });
   
   console.log("After containment:", actor.system.carry_rating.current); // Should be 3.5 (1 + 5/2)
   ```

## Technical Notes

### Why Items Had Missing `enc` Fields
Possible causes:
1. **Legacy data**: Items created before enc field was added to schema
2. **Compendium imports**: Reference compendia may lack enc values
3. **Sheet refactoring side-effect**: While the refactoring didn't break form submission, it may have exposed a latent data quality issue

### Enc Calculation Flow
```
Item.system.enc (field) 
  ↓
aggregateItemStats() (reads enc from each item)
  ↓
agg.totalEnc (sum of all item weights, with container halving logic)
  ↓
prepareCharacterData() / prepareNPCData()
  ↓
carry_rating.current = totalEnc - (armorEnc / 2) - excludedEnc
  ↓
Actor sheet display
```

### Container Weight Logic (RAW)
- Items in containers contribute **half weight**
- Container itself contributes full weight
- Equipped armor **cannot** be in containers (it's worn)

### No Breaking Changes
- No schema changes
- No public API changes
- Existing enc values preserved
- Migration is idempotent (safe to run multiple times)

## Files Modified
- [src/core/migrations/items.js](../../src/core/migrations/items.js)
  - Added enc field initialization in `_normalizeItemSystem()`
  - Expanded item type filters in `_normalizeWorldItems()` and `_normalizeActorItems()`

## Related Code References
- **Encumbrance calculation**: [src/core/actors/rules/item-aggregation.js](../../src/core/actors/rules/item-aggregation.js#L46)
- **Character prep**: [src/core/actors/prepare/character.js](../../src/core/actors/prepare/character.js#L366)
- **NPC prep**: [src/core/actors/prepare/npc.js](../../src/core/actors/prepare/npc.js#L320)
- **Item sheet template**: [templates/item-sheet.html](../../templates/item-sheet.html#L23)

## Known Limitations
- **Default enc is 0**: Users must manually set realistic weights for items
- **Compendia not auto-migrated**: Reference compendia must be updated manually or re-imported
- **No automatic weight estimation**: Future enhancement could estimate weights based on item type/material

## Future Enhancements (Optional)
1. Create a migration to estimate realistic weights based on item type:
   - Weapons: 2-10 depending on type
   - Armor: 5-20 depending on weight class
   - Containers: 1-3 depending on size
   - Ammunition: 0.1 per unit
2. Add bulk weight assignment UI to item sheet (e.g., "Set typical weight for this weapon type")
3. Add warning in item sheet if enc=0 for physical items
