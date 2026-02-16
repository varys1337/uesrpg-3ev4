/**
 * @module magic/backfire
 *
 * src/core/magic/backfire.js

 *
 * Magical backfire detection and handling (RAW p.128 lines 225-233).
 * Backfire tables from Chapter 6 p.156-159.
 */

import { getMagicSkillLevel } from "./magicka-utils.js";
import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { actorHasTalent } from "./magic-modifiers.js";
import { confirmDialog } from "../../utils/dialog-v2-helper.js";

/**
 * Backfire tables from Chapter 6 p.156-159 (RAW verbatim).
 * Structure: { min, max, name, effect }
 * Formula: 1d4 + spellLevel (range 2-11)
 */
const BACKFIRE_TABLES = {
  "alteration": [
    { min: 1, max: 2, name: "Breeze", effect: "A light wind whips up within a few dozen meters of the caster." },
    { min: 3, max: 3, name: "Magicka Leak", effect: "The caster loses 2d8 magicka. Who knows where it went?" },
    { min: 4, max: 4, name: "Swap", effect: "The caster and another random character within 30 meters switch places instantly." },
    { min: 5, max: 5, name: "Crushing Weight", effect: "All characters within 30 meters (including the caster) feel weighed down. They suffer a -10 penalty to all tests for 1d4 rounds." },
    { min: 6, max: 6, name: "Lurch", effect: "The world seems to stretch for a few seconds before hurling people and objects to new locations. Each character within 10 meters (including the caster) is thrown 2d10 meters in a random horizontal direction." },
    { min: 7, max: 7, name: "Slip and Slide", effect: "The area within 20 meters of the caster becomes an extreme low friction zone for 1d4 rounds. Characters in the zone must make an Agility test each round to not fall prone." },
    { min: 8, max: 8, name: "Chronological Disturbance", effect: "For the next 1d4 minutes, all spells cast by the caster take effect 1d4 rounds after they are cast. A Perception test is required to notice the sudden appearance of a spell or else characters cannot react to them." },
    { min: 9, max: 9, name: "Uncontrollable Levitation", effect: "The caster suddenly hovers towards the sky. They levitate 1d12 meters above the ground and floats there for 1d4 rounds before falling. They are at a -20 penalty to all actions as they spin uncontrollably." },
    { min: 10, max: 10, name: "Gravity Unbound", effect: "All characters, the caster included, within 10 meters of the caster fall upwards 3d8 meters before falling down again." },
    { min: 11, max: Infinity, name: "Force", effect: "The caster must test Willpower or be killed instantly as incredible forces tear them apart." }
  ],
  "conjuration": [
    { min: 1, max: 2, name: "Otherworldly Voice", effect: "All characters within a few dozen meters of the caster hear strange voices whispering." },
    { min: 3, max: 3, name: "Magicka Leak", effect: "The caster loses 2d8 magicka. Who knows where it went?" },
    { min: 4, max: 4, name: "What's That?", effect: "An item of alien origin falls through a hole in reality nearby. The item can be any item of the GM's choosing, but it appears to be made of strange, otherworldly material. Whatever it is, it doesn't agree with Mundus and only survives 1d4 rounds before vanishing." },
    { min: 5, max: 7, name: "Unbound", effect: "If the spell would have summoned or bound an entity of some kind, it works but they enter the world without the Bound trait or quality (as appropriate), meaning they are free to do as they wish. If this does not apply, use Backlash: The entity the caster is attempting to contact mentally lashes out against them. They lose 3d10 magicka." },
    { min: 8, max: 8, name: "Mental Visitor", effect: "A strange entity slips into the mind of the caster unbidden. It remains there for 1d6 rounds, impeding their actions. They are at a -10 to all tests while it is present." },
    { min: 9, max: 9, name: "Suddenly Scamps!", effect: "There is a flash of light and 2d6 Scamps appear from a rift in reality. They instantly scatter, intent on causing as much mischief as possible." },
    { min: 10, max: 10, name: "Rift", effect: "A strange rift opens in reality at a random point within 10 meters of the caster. Gravity shifts, slowly pulling all characters within 2d8 meters towards the rift as if they were falling. Hanging onto a nearby object or the ground requires a successful Strength test. The rift persists for 1d4 rounds. Those who pass through are sent... somewhere else..." },
    { min: 11, max: Infinity, name: "Schloop!", effect: "The character must make a Willpower test or be sucked into another realm with a sudden squelching sound, never to be seen again." }
  ],
  "destruction": [
    { min: 1, max: 2, name: "Mysterious Pain", effect: "All characters within a few dozen meters feel a strange prickling pain." },
    { min: 3, max: 3, name: "Magicka Leak", effect: "The caster loses 2d8 magicka. Who knows where it went?" },
    { min: 4, max: 4, name: "Drained", effect: "The caster loses 1 Stamina point." },
    { min: 5, max: 5, name: "Energy Burst", effect: "A wave of energy issues from the caster, knocking everyone (not including the caster) within 20 meters prone unless they pass a Strength test." },
    { min: 6, max: 6, name: "Hoarfrost", effect: "In a sudden surge of cold, all non-living matter within 30 meters is covered in ice. Characters moving within the frozen area must make an Agility test or fall prone." },
    { min: 7, max: 7, name: "Weary", effect: "The caster loses 1d4 Stamina points." },
    { min: 8, max: 8, name: "Lightning Rod", effect: "Lightning strikes from above, hitting a random target within 10 meters of the caster (they are a viable target too) and dealing 2d8 shock damage to the body location." },
    { min: 9, max: 9, name: "Redirected", effect: "If the magic that backfired is a spell with a target, it is redirected and resolved against the caster. Otherwise, use Lightning Rod." },
    { min: 10, max: 10, name: "Power Overwhelming", effect: "Caster must make a Willpower test or die instantly as they burn up from force of the power they have summoned." },
    { min: 11, max: Infinity, name: "Boom!", effect: "The caster must test Willpower or explode killing them instantly and dealing 4d10 fire damage to all characters within 2d8 meters." }
  ],
  "illusion": [
    { min: 1, max: 2, name: "Ewww!", effect: "The magic does nothing except leave behind a terrible smell in the area." },
    { min: 3, max: 3, name: "That Totally Worked", effect: "The caster believes that they were successful in casting the spell, but in reality they were not." },
    { min: 4, max: 4, name: "Thick Tongue", effect: "The caster cannot speak for 1d4 rounds as their tongue feels thick and heavy in their mouth." },
    { min: 5, max: 5, name: "Darkness", effect: "All lights within 100 meters go out for the next 1d4 rounds." },
    { min: 6, max: 6, name: "Bang!", effect: "There is a flash of light, and the caster and all characters within 20 meters suffer from the Blinded and Deafened conditions for 1d4 rounds." },
    { min: 7, max: 7, name: "Scherioussshly I'am Soobear", effect: "The caster loses 2 SP. They feel extremely intoxicated for the next 1d12 minutes." },
    { min: 8, max: 8, name: "My Own Worst Enemy", effect: "Any character who makes eye contact with the caster will be seen by them as an enemy." },
    { min: 9, max: 9, name: "Seeing Double", effect: "A double of the caster appears in front of them and seeks to destroy them for 1d6 rounds before vanishing." },
    { min: 10, max: 10, name: "Mental Prison", effect: "The character is trapped within their own mind for 1d4 days. During this time they are unconscious and helpless." },
    { min: 11, max: Infinity, name: "Just Gone", effect: "Caster must make a Willpower test, or their mind becomes a \"blank slate.\" This character must be retired from play." }
  ],
  "necromancy": [
    { min: 1, max: 2, name: "Visions...", effect: "You see faint outlines of ghosts and other apparitions. They look at you and they whisper. A chill runs down your spine, then they disappear." },
    { min: 3, max: 3, name: "Too Much Death on the Mind", effect: "For a brief moment you feel the souls of those that have been affected by this dark magic tearing at your mind, trying to stop you from calling them. The caster loses 2d8 Magicka Points." },
    { min: 4, max: 4, name: "Accelerated Decay", effect: "The flesh of corpses wither to dust; only bones remain. All inanimate corpses within 10 meters of the target are stripped of their flesh and muscles leaving just the skeleton." },
    { min: 5, max: 5, name: "Body Rot", effect: "Your flesh darkens in spots. For the next 1d4 rounds, take 1d4 Magic damage at the start of your Turn. Healing received from either a potion or a spell ends the effect early." },
    { min: 6, max: 6, name: "...Of Grave Danger!", effect: "A Ghost appears and gives everyone chills. The Ghost appears in a random location (GM choice) within 10 meters and follows the caster, pulling pranks on the living. All characters in the encounter must test Panic at -10. The Ghost is non-hostile unless provoked and persists for 2d6 rounds before vanishing into thin air." },
    { min: 7, max: 7, name: "This Heals Me...Right?", effect: "The life around you starts to wither. Characters within 20 meters, including the caster takes 2d6 Magic damage." },
    { min: 8, max: 8, name: "Rigor Mortis Came a Little Late", effect: "All undead within 10 meters of the caster and target must make a Willpower test at -10 or be paralyzed for 2d4 rounds." },
    { min: 9, max: 9, name: "Necromancy at Its Finest...Sort Of", effect: "Any inanimate corpses, bones, or other materials that can be used for necromancy rituals within 10 meters are reanimated. They are unbound, are hostile to the living, and last for 1d4 rounds. What counts for materials and what is exactly created is up to GM discretion." },
    { min: 10, max: 10, name: "They Seem Angry...", effect: "The vengeful dead have broken their bonds and turned on their hated master. All undead within one of the following ranges receive the associated effects for 2d4 rounds: 10m: Unbound; 5m: Frenzied, only targeting living creatures; 2m: Frenzied, but specifically target the caster." },
    { min: 11, max: Infinity, name: "One of Us! One of Us!", effect: "You feel all of the energy start to sap from your body. The caster must make a Willpower test or be drained of their life and become an undead monstrosity using the character's profile. This character becomes an NPC controlled by the GM." }
  ],
  "mysticism": [
    { min: 1, max: 2, name: "Sight", effect: "All characters within a few dozen meters see glimpses of random events." },
    { min: 3, max: 3, name: "Magicka Siphon", effect: "The caster loses 1d8 magicka, and a random character within 30 meters gains the amount lost." },
    { min: 4, max: 4, name: "Forgetful", effect: "The next time the caster attempts to cast a spell within 1 minute, they find they have forgotten how to use it and cannot remember it until the duration is up." },
    { min: 5, max: 5, name: "Twister", effect: "The character perceives time in a non-linear fashion for 1d4 rounds and must make a Perception test to successfully take any actions." },
    { min: 6, max: 6, name: "Endless Sight", effect: "The caster can see multiple planes of reality and cannot process the information at once. They gain the blinded condition for 1d4 rounds." },
    { min: 7, max: 7, name: "Warp", effect: "The caster vanishes and reappears at a random location within 300 meters." },
    { min: 8, max: 8, name: "Involuntary Chat", effect: "The caster is telepathically linked with a random character within 100 meters. They can each hear the other's thoughts for the next 1d4 minutes. Each must make a Willpower test each round to act during this time as it is difficult to focus." },
    { min: 9, max: 9, name: "Spell Reversal", effect: "For the next 1d6 rounds, spells that the caster casts have the opposite of their usual effect. Exactly what this entails is left to the GM's imagination." },
    { min: 10, max: 10, name: "Anti-Magic Zone", effect: "Creates a zone of anti-magicka within 25 meters of the caster. All characters within lose all their current magicka, all constant enchantments stop working until they leave the zone, all other enchantments lose all charge, and all potions lose their effects permanently. The zone lasts for 1d4 minutes." },
    { min: 11, max: Infinity, name: "Soul Fire", effect: "The caster must make a Willpower test or their soul is destroyed, rent apart by magical forces. This kills them instantly." }
  ],
  "restoration": [
    { min: 1, max: 2, name: "Flinch", effect: "All characters within a few dozen meters twitch slightly." },
    { min: 3, max: 3, name: "Magicka Leak", effect: "The caster loses 2d8 magicka. Who knows where it went?" },
    { min: 4, max: 4, name: "Blight", effect: "Plants around the caster wither and die within 50 meters." },
    { min: 5, max: 5, name: "Out of Breath", effect: "The caster loses 1d4 SP." },
    { min: 6, max: 6, name: "Localized Aging", effect: "One of the caster's limbs, chosen at random, becomes crippled for 1d8 rounds." },
    { min: 7, max: 7, name: "Newfound Strength", effect: "For the next minute the character gains 50 Strength, but if they do anything except stand still, they must make an Agility test at a -40 penalty. On a failure, the character falls prone as they are unable to control their body." },
    { min: 8, max: 8, name: "Not Right...", effect: "The caster's characteristics are switched around as their body morphs and warps. Roll 1d10 for each characteristic once. On a six or higher, the characteristic score switches places with the next score that rolls a six or higher. This happens every hour for 1d4 hours, after which the character returns to normal." },
    { min: 9, max: 9, name: "Contortions", effect: "The caster's muscles begin to spasm uncontrollably; they are rendered entirely helpless for 1d4 rounds." },
    { min: 10, max: 10, name: "Overgrowth", effect: "One of the caster's limbs, chosen at random, begins to grow uncontrollably. The first round it becomes crippled for 1d4 minutes, and the character must make an Endurance test with a -20 penalty. If they fail, the limb is lost the next round as it explodes in a burst of gore, and they take 3d8 damage that ignores all armor and mitigation. After the duration it returns to normal." },
    { min: 11, max: Infinity, name: "Adrenaline", effect: "The caster's vital systems kick into overdrive, and they must make an Endurance test or die within seconds." }
  ]
};

/**
 * Check if spell should trigger backfire on failure
 * RAW p.128 lines 225-233:
 *  - Always backfire on critical failure
 *  - Backfire on normal failure IF:
 *    - Spell is unconventional, OR
 *    - Spell level > caster's spellcasting level
 *
 * @param {Item} spell - The spell that failed
 * @param {Actor} actor - The caster
 * @param {boolean} isCriticalFailure - Whether the roll was a critical failure
 * @param {boolean} isFailure - Whether the roll failed
 * @returns {boolean} - True if backfire should occur
 */
export function shouldBackfire(spell, actor, isCriticalFailure, isFailure) {
  // Always backfire on critical failure
  if (isCriticalFailure) return true;
  
  // No backfire if spell succeeded
  if (!isFailure) return false;
  
  const spellLevel = Number(spell.system?.level ?? 1);
  const spellcastingLevel = getMagicSkillLevel(actor, spell.system?.school);
  const isUnconventional = String(spell.system?.spellType ?? "").toLowerCase() === "unconventional";
  
  // Backfire on normal failure if unconventional OR spell level exceeds caster level
  return isUnconventional || (spellLevel > spellcastingLevel);
}

/**
 * Look up backfire effect from table
 * @private
 * @param {string} school - School of magic
 * @param {number} rollResult - 1d4 + spellLevel result
 * @returns {Object|null} - { name, effect } or null if table not found
 */
function _lookupBackfireEffect(school, rollResult) {
  const normalizedSchool = String(school ?? "").toLowerCase();
  const table = BACKFIRE_TABLES[normalizedSchool];
  
  if (!table) {
    console.warn(`uesrpg-3ev4 | Backfire table not found for school: ${school}`);
    return null;
  }
  
  // Find matching entry by range
  const entry = table.find(e => rollResult >= e.min && rollResult <= e.max);
  if (!entry) {
    console.warn(`uesrpg-3ev4 | No backfire entry found for roll ${rollResult} in ${school} table`);
    return null;
  }
  
  return { name: entry.name, effect: entry.effect };
}

/**
 * Trigger backfire with automated table lookup
 * RAW Chapter 6 p.156-159: Roll 1d4 + spellLevel on appropriate table
 *
 * @param {Actor} actor - The caster
 * @param {Item} spell - The spell that backfired
 * @returns {Promise<void>}
 */
export async function triggerBackfire(actor, spell) {
  const spellLevel = Number(spell.system?.level ?? 1);
  const school = String(spell.system?.school ?? "Unknown");
  
  // Talent (Chapter 4): Control — may test Willpower to negate a backfire.
  if (actorHasTalent(actor, "Control")) {
    const doAttempt = await confirmDialog({
      title: "Magical Backfire — Control",
      content: `<p>${actor.name} has <b>Control</b>. Attempt a Willpower test to negate the backfire?</p>`,
    });

    if (doAttempt) {
      const wpTN = Number(actor?.system?.characteristics?.wp?.total ?? 0) || 0;
      const res = await doTestRoll(actor, {
        target: wpTN,
        allowLucky: true,
        allowUnlucky: true
      });

      await res.roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `<b>${actor.name}</b> — Control (negate backfire)`
      });

      if (res.isSuccess) {
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div class="uesrpg-backfire" style="border: 2px solid #2d7; padding: 10px; background: rgba(0,128,0,0.08);">
              <h3 style="margin-top: 0;">Backfire Negated</h3>
              <p><strong>${actor.name}</strong> negated the backfire from <strong>${spell.name}</strong> using <strong>Control</strong>.</p>
            </div>`
        });
        return;
      }
    }
  }

  // Roll 1d4 + spellLevel (RAW Chapter 6 p.156)
  const roll = await new Roll("1d4 + @spellLevel", { spellLevel }).evaluate();
  const rollResult = roll.total;
  
  // Look up backfire effect
  const backfireEffect = _lookupBackfireEffect(school, rollResult);
  
  if (!backfireEffect) {
    // Fallback to manual prompt if table lookup fails
    ui.notifications.error(`Backfire table error for ${school}! GM must manually resolve.`);
    await ChatMessage.create({
      content: `<div class="uesrpg-backfire" style="border: 2px solid #cc0000; padding: 10px; background: #ffe0e0;">
          <h3 style="margin-top: 0; color: #cc0000;">⚠️ Magical Backfire!</h3>
          <p><strong>Caster:</strong> ${actor.name}</p>
          <p><strong>Spell:</strong> ${spell.name}</p>
          <p><strong>School:</strong> ${school} (Level ${spellLevel})</p>
          <p><strong>Roll:</strong> [[/r 1d4 + ${spellLevel}]] = ${rollResult}</p>
          <hr style="border-color: #cc0000;">
          <p style="color: #cc0000;"><strong>Table lookup failed!</strong> Manually consult ${school} backfire table (Chapter 6 p.156+).</p>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
    return;
  }
  
  // Display automated backfire result
  ui.notifications.warn(`Magical Backfire! ${backfireEffect.name}`);
  
  const content = `
    <div class="uesrpg-backfire" style="border: 2px solid #cc0000; padding: 10px; background: #ffe0e0;">
      <h3 style="margin-top: 0; color: #cc0000;">⚠️ Magical Backfire!</h3>
      <p><strong>Caster:</strong> ${actor.name}</p>
      <p><strong>Spell:</strong> ${spell.name} (${school}, Level ${spellLevel})</p>
      <p><strong>Roll:</strong> 1d4 + ${spellLevel} = <span style="font-size: 1.2em; font-weight: bold;">${rollResult}</span></p>
      <hr style="border-color: #cc0000;">
      <h4 style="margin: 10px 0 5px 0; color: #cc0000;">${backfireEffect.name}</h4>
      <p style="margin: 0 0 10px 0;">${backfireEffect.effect}</p>
      <p style="font-size: 0.85em; font-style: italic; margin: 10px 0 0 0; color: #666;">
        <strong>GM:</strong> Apply effect as appropriate. Some backfires require additional rolls or GM adjudication.
      </p>
    </div>
  `;
  
  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: game.users.filter(u => u.isGM).map(u => u.id)
  });
}
