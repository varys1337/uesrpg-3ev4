/**
 * Quick console verification for spell scaling data
 * Paste this into the browser console (F12) to verify spell data is correct
 */

// Find the spell
const spell = game.actors.getName("Scotty")?.items.getName("Destruction: [Jack] Bolt");

if (!spell) {
  console.error("❌ Spell not found!");
} else {
  console.log("\n" + "=".repeat(70));
  console.log("✅ SPELL FOUND:", spell.name);
  console.log("=".repeat(70));
  
  console.log("\n📊 Basic Info:");
  console.log("  UUID:", spell.uuid);
  console.log("  Type:", spell.type);
  console.log("  Base Level:", spell.system?.level);
  console.log("  Base Cost:", spell.system?.cost, "MP");
  console.log("  Damage:", spell.system?.damageFormula);
  
  console.log("\n📈 Raw Scaling Data:");
  console.log("  spell.system.scaling:", spell.system?.scaling);
  console.log("  spell.system.scaling.levels:", spell.system?.scaling?.levels);
  console.log("  Is Array?", Array.isArray(spell.system?.scaling?.levels));
  console.log("  Length:", spell.system?.scaling?.levels?.length ?? 0);
  
  if (spell.system?.scaling?.levels) {
    console.log("\n📋 Scaling Levels Detail:");
    spell.system.scaling.levels.forEach((entry, idx) => {
      console.log(`  [${idx}] Level ${entry.level}: Cost ${entry.cost} MP, Damage ${entry.damageFormula}`);
    });
  }
  
  // Test the canonical reader
  const { getSpellScalingLevels } = await import("./systems/uesrpg-3ev4/src/core/magic/magicka-utils.js");
  const normalized = getSpellScalingLevels(spell);
  
  console.log("\n🔧 Normalized Scaling Levels (from getSpellScalingLevels):");
  console.log("  Count:", normalized?.length ?? 0);
  if (normalized?.length) {
    normalized.forEach((entry, idx) => {
      console.log(`  [${idx}] Level ${entry.level}: Cost ${entry.cost} MP, Damage ${entry.damageFormula || 'N/A'}, Inferred: ${entry.__inferredLevel ? 'YES' : 'NO'}`);
    });
  }
  
  console.log("\n" + "=".repeat(70));
  
  if (normalized?.length > 0) {
    console.log("✅ RESULT: Spell scaling data is valid and ready");
    console.log("   Expected: Dropdown should show Base + " + normalized.length + " scaling level(s)");
  } else {
    console.log("⚠️ WARNING: No scaling levels found!");
    console.log("   Expected: Dropdown will only show Base option");
  }
  console.log("=".repeat(70) + "\n");
}
