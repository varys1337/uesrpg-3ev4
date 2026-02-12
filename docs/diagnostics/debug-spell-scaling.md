# Spell Scaling Dropdown Debug Guide

## Issue
The "Cast at Level" dropdown only shows "Base" even though the spell has scaling levels configured in the item sheet.

## Diagnostic Steps

### Step 1: Enable Debug Logging

Open Debug Settings menu (GM-only gear icon on the Actor sheet) and enable:
- **Debug Logging: Master Enable** ✓
- **Spell Casting Debug** ✓

Then reload the world (F5).

### Step 2: Locate the Spell First

Open browser console (F12) and **find the spell** first:

```javascript
// STEP A: Search for the spell across all locations
console.log("=== SEARCHING FOR SPELL ===");

// Option 1: Search in world items
const worldSpell = game.items.contents.find(i => i.name.includes("Jack") && i.name.includes("Bolt"));
console.log("World Items:", worldSpell?.name ?? "NOT FOUND");

// Option 2: Search in actor items (most common for custom spells)
const actors = game.actors.contents;
let actorSpell = null;
let owningActor = null;

for (const actor of actors) {
  const found = actor.items.contents.find(i => i.name.includes("Jack") && i.name.includes("Bolt"));
  if (found) {
    actorSpell = found;
    owningActor = actor;
    break;
  }
}

console.log("Actor Items:", actorSpell?.name ?? "NOT FOUND");
if (owningActor) console.log("Owned by actor:", owningActor.name);

// Use whichever was found
const spell = worldSpell || actorSpell;

if (!spell) {
  console.error("SPELL NOT FOUND! List all spells with 'Bolt' in name:");
  game.items.contents.filter(i => i.name.includes("Bolt")).forEach(i => console.log(" -", i.name));
  actors.forEach(a => {
    const found = a.items.contents.filter(i => i.name.includes("Bolt"));
    if (found.length) {
      console.log(`Actor ${a.name}:`);
      found.forEach(i => console.log(" -", i.name));
    }
  });
} else {
  console.log("\n✅ SPELL FOUND:", spell.name);
  console.log("UUID:", spell.uuid);
}
```

Once you find the spell, **copy its exact name** from the console output.

### Step 3: Inspect Spell Data in Console

After locating the spell, inspect its scaling data:

```javascript
// Replace with exact spell name from Step 2
const spell = game.items.getName("EXACT NAME HERE") || 
              game.actors.contents.flatMap(a => a.items.contents).find(i => i.name.includes("Jack"));

console.log("\n=== SPELL DATA INSPECTION ===");
console.log("Spell:", spell?.name);
console.log("Type:", spell?.type);
console.log("Level:", spell?.system?.level);
console.log("Cost:", spell?.system?.cost);
console.log("Raw scaling object:", spell?.system?.scaling);
console.log("Raw scaling.levels:", spell?.system?.scaling?.levels);
console.log("Is Array?", Array.isArray(spell?.system?.scaling?.levels));
console.log("Length:", spell?.system?.scaling?.levels?.length);

// Test the canonical reader
const { getSpellScalingLevels } = await import("./systems/uesrpg-3ev4/src/core/magic/magicka-utils.js");
const scalingLevels = getSpellScalingLevels(spell);
console.log("\nCanonical reader result:", scalingLevels);
console.log("Count:", scalingLevels?.length);

// Show each entry
if (scalingLevels?.length) {
  scalingLevels.forEach((entry, idx) => {
    console.log(`Entry ${idx}:`, { 
      level: entry.level, 
      cost: entry.cost, 
      damage: entry.damageFormula,
      inferred: entry.__inferredLevel 
    });
  });
}
```

### Step 4: Expected vs Actual

**Expected Output:**
```
Raw scaling.levels: Array(2)
  0: {level: 2, cost: 8, damageFormula: "1d8", duration: 0, description: "Effect at this level"}
  1: {level: 3, cost: 12, damageFormula: "1d10", duration: 0, description: "Effect at this level"}
Is Array? true
Canonical reader result: Array(2)
Count: 2
```

**If you see:**
- `Raw scaling.levels: undefined` → Data not saved
- `Raw scaling.levels: {}` → Saved as object instead of array (legacy format)
- `Is Array? false` → Wrong data type
- `Canonical reader result: Array(0)` → Filter is excluding entries

### Step 5: Fix Data Structure

If scaling levels aren't saving, check:

1. **Item Sheet Validation:** Open spell sheet, go to "Attributes" tab, scroll to "Scaling Levels" section. Do you see Level 2 and Level 3 rows?

2. **Force Save:** Click each field in the scaling levels section, make a tiny edit (add/remove a space), then click outside the field to trigger save. Check console for "Spell scaling input change" logs.

3. **Manual Fix (if needed):**
```javascript
// Use the spell variable from Step 3
await spell.update({
  "system.scaling.levels": [
    {
      level: 2,
      cost: 8,
      damageFormula: "1d8",
      duration: { value: 0, unit: "instant" },
      description: "Effect at this level"
    },
    {
      level: 3,
      cost: 12,
      damageFormula: "1d10",
      duration: { value: 0, unit: "instant" },
      description: "Effect at this level"
    }
  ]
});

console.log("✅ Scaling data updated! Try casting the spell now.");
```

### Step 6: Test Dialog with Debug

After fixing data, cast the spell and watch console logs:

**Expected logs:**
```
UESRPG | Spell Options Dialog | START
📊 Spell Data Inspection:
  Base Level: 1
  Base Cost: 4
  scaling.levels (raw): Array(2)
  Is Array? true
  Array Length: 2

📈 Scaling Level Filtering Results:
  🔍 Checking scaling entry: {rawLevel: 2, parsedLevel: 2, isValid: true, ...}
  🔍 Checking scaling entry: {rawLevel: 3, parsedLevel: 3, isValid: true, ...}
  Filtered count: 2
  hasScaling: true
```

### Step 7: Common Issues

#### Issue: "Scaling levels show in item sheet but not in dialog"
**Cause:** Data saved as object `{0: {...}, 1: {...}}` instead of array.
**Fix:** The canonical reader handles this automatically. If it's still not working, run the manual fix from Step 4.

#### Issue: "Dialog shows 'Base' but dropdown is hidden"
**Cause:** `castLevelGroup.style.display` is set to "none".
**Fix:** Check if `hasScaling` is false. Add manual console check:
```javascript
const spell = game.items.getName("Destruction: [Jack] Bolt");
const levels = getSpellScalingLevels(spell);
console.log("hasScaling should be:", levels.length > 0);
```

#### Issue: "Dropdown shows but all options have same cost"
**Cause:** Scaling entries missing `cost` field, falling back to base.
**Fix:** Edit each scaling level row in item sheet and ensure Cost (MP) field is filled.

### Step 8: Verify Fix

1. Open casting dialog
2. Dropdown should show:
   - `Base (Level 1, 4 MP)`
   - `Level 2 (8 MP, 1d8)`
   - `Level 3 (12 MP, 1d10)`

3. Select Level 2, cast spell
4. Check chat card shows "Cast at Level 2"
5. Verify 8 MP was consumed (not 4 MP)

## Rollback (if needed)

If debug logs show unexpected errors:

```javascript
// Disable debug
game.settings.set("uesrpg-3ev4", "spellCastingDebug", false);
game.settings.set("uesrpg-3ev4", "debugEnabled", false);
```

## Report to Developer

If issue persists after all steps, capture:
1. Full console output from Step 2
2. Screenshot of spell item sheet "Scaling Levels" section
3. Screenshot of casting dialog with console logs visible

Post to #bug-reports with the tag `[scaling-dialog]`.
