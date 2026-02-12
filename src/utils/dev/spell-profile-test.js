/**
 * src/utils/dev/spell-profile-test.js
 *
 * Console test utility for validating SpellProfile API.
 * 
 * Usage from browser console:
 *   await game.uesrpg.testSpellProfile()
 *   await game.uesrpg.testSpellProfile("Fireball")
 *   await game.uesrpg.testSpellProfile("Fireball", "My Wizard")
 */

/**
 * Test the SpellProfile API with a spell.
 * 
 * @param {string} spellName - Name of spell to test (defaults to first spell found)
 * @param {string} actorName - Name of actor to test with (defaults to first PC)
 * @returns {Promise<void>}
 */
export async function testSpellProfile(spellName = null, actorName = null) {
  console.log("=== SpellProfile API Test ===\n");
  
  // Find actor
  let actor;
  if (actorName) {
    actor = game.actors.getName(actorName);
    if (!actor) {
      console.error(`Actor "${actorName}" not found.`);
      return;
    }
  } else {
    actor = game.actors.find(a => a.type === "Player Character");
    if (!actor) {
      actor = game.actors.contents[0];
    }
  }
  
  if (!actor) {
    console.error("No actor found to test with.");
    return;
  }
  
  console.log(`Using actor: ${actor.name} (${actor.uuid})`);
  
  // Find spell
  let spell;
  if (spellName) {
    spell = actor.items.getName(spellName);
    if (!spell) {
      // Try to find in all actors
      for (const a of game.actors) {
        spell = a.items.getName(spellName);
        if (spell) break;
      }
    }
    if (!spell) {
      console.error(`Spell "${spellName}" not found.`);
      return;
    }
  } else {
    spell = actor.items.find(i => i.type === "spell");
    if (!spell) {
      console.error(`No spells found on actor ${actor.name}.`);
      return;
    }
  }
  
  console.log(`Using spell: ${spell.name} (${spell.uuid})\n`);
  
  // Test 1: Basic profile
  console.log("--- Test 1: Basic Profile ---");
  const profile1 = game.uesrpg.magic.resolveProfile(spell, actor);
  console.log(profile1);
  console.log("Summary:", game.uesrpg.magic.summarizeProfile(profile1));
  console.log("");
  
  // Test 2: Restrained casting
  console.log("--- Test 2: Restrained Casting ---");
  const profile2 = game.uesrpg.magic.resolveProfile(spell, actor, { isRestrained: true });
  console.log("Cost breakdown:");
  console.log(`  Base cost: ${profile2.cost.base} MP`);
  console.log(`  Attempt cost: ${profile2.cost.attempt} MP`);
  console.log(`  Restrain reduction: ${profile2.cost.restrained.reduction} MP`);
  console.log(`  Final cost (on success): ${profile2.cost.final} MP`);
  console.log("Summary:", game.uesrpg.magic.summarizeProfile(profile2));
  console.log("");
  
  // Test 3: Overloaded casting (if spell supports it)
  if (profile1.classification.hasOverload) {
    console.log("--- Test 3: Overloaded Casting ---");
    const profile3 = game.uesrpg.magic.resolveProfile(spell, actor, { isOverloaded: true });
    console.log("Cost breakdown:");
    console.log(`  Base cost: ${profile3.cost.base} MP`);
    console.log(`  Overload multiplier: ×${profile3.cost.overload.multiplier}`);
    console.log(`  Attempt cost: ${profile3.cost.attempt} MP`);
    console.log(`  Overload bonus damage: ${profile3.damage.overloadBonusFormula || "none"}`);
    console.log("Summary:", game.uesrpg.magic.summarizeProfile(profile3));
    console.log("");
  }
  
  // Test 4: Classification flags
  console.log("--- Test 4: Classification & Routing ---");
  console.log("Classification flags:");
  Object.entries(profile1.classification).forEach(([key, value]) => {
    if (value) console.log(`  ✓ ${key}`);
  });
  console.log("Computed flags:");
  Object.entries(profile1.computed).forEach(([key, value]) => {
    if (value) console.log(`  ✓ ${key}`);
  });
  console.log("");
  
  // Test 5: Range & AoE
  console.log("--- Test 5: Range & AoE ---");
  console.log(`Range type: ${profile1.range.type}`);
  if (profile1.range.maxMeters) {
    console.log(`Max range: ${profile1.range.maxMeters}m`);
  }
  if (profile1.aoe.isAoE) {
    console.log(`AoE shape: ${profile1.aoe.shape}`);
    console.log(`AoE size: ${profile1.aoe.size}m`);
    if (profile1.aoe.width) console.log(`AoE width: ${profile1.aoe.width}m`);
    console.log(`Include caster: ${profile1.aoe.includeCaster}`);
    console.log(`Pulse: ${profile1.aoe.pulse}`);
  }
  console.log("");
  
  // Test 6: Duration & Upkeep
  console.log("--- Test 6: Duration & Upkeep ---");
  console.log(`Duration: ${profile1.duration.value} ${profile1.duration.unit}`);
  console.log(`  Instant: ${profile1.duration.isInstant}`);
  console.log(`  Finite: ${profile1.duration.isFinite}`);
  console.log(`  Permanent: ${profile1.duration.isPermanent}`);
  if (profile1.classification.hasUpkeep) {
    console.log(`  ⚠️  Has Upkeep`);
    if (profile1.computed.blocksOtherCasts) {
      console.log(`  ⚠️  Blocks other casts (no listed duration)`);
    }
  }
  console.log("");
  
  // Test 7: Active Effect cost modifiers (if any)
  if (profile1.cost.aeModifier !== 0) {
    console.log("--- Test 7: Active Effect Cost Modifiers ---");
    console.log(`Total AE modifier: ${profile1.cost.aeModifier > 0 ? "+" : ""}${profile1.cost.aeModifier} MP`);
    console.log("Breakdown:");
    profile1.cost.aeBreakdown.forEach(ae => {
      console.log(`  ${ae.label}: ${ae.value > 0 ? "+" : ""}${ae.value}`);
    });
    console.log("");
  }
  
  // Test 8: Scaling (if present)
  if (profile1.scaling.hasScaling) {
    console.log("--- Test 8: Scaling ---");
    console.log(`Scaling levels: ${profile1.scaling.levels.length}`);
    console.log("Current level entry:", profile1.scaling.currentLevel);
    console.log("");
  }
  
  console.log("=== SpellProfile API Test Complete ===");
  console.log(`\n✓ Profile resolution successful for "${spell.name}"`);
  console.log(`  Actor: ${actor.name}`);
  console.log(`  Spell: ${spell.name} (${spell.system.school} L${spell.system.level})`);
  console.log(`  Cost: ${profile1.cost.attempt} MP`);
  if (profile1.damage.formula && profile1.damage.formula !== "0") {
    console.log(`  Damage: ${profile1.damage.formula} ${profile1.damage.type}`);
  }
}

/**
 * Register test utility on game.uesrpg
 */
export function registerSpellProfileTest() {
  if (!game.uesrpg) game.uesrpg = {};
  game.uesrpg.testSpellProfile = testSpellProfile;
  console.log("SpellProfile test utility registered: game.uesrpg.testSpellProfile()");
}
