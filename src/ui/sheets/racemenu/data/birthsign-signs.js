/**
 * @file Birthsign definitions for the Birth Sign character creation menu.
 *
 * All mechanical values here track Chapter 2 RAW (Determine Birthsign, pp.26-27).
 * Items are either inline definitions (created directly) or compendium references
 * (looked up by pack + name at creation time).
 *
 * Inline item format:
 *   { name, type, img, desc, data?: { "system.field": value } }
 *
 * Compendium item format:
 *   { pack: "uesrpg-3ev4.signs", name: "Item Name" }
 */

const imgPath = "systems/uesrpg-3ev4/images/dialogue/signs";
const SIGNS_PACK = "uesrpg-3ev4.signs";
const POWERS_PACK = "uesrpg-3ev4.powers-revised";

// Common item icons
const pwIcon = "icons/magic/defensive/shield-barrier-glowing-blue.webp";
const weakIcon = "icons/magic/unholy/strike-beam-blood-red-purple.webp";

// ─── Warrior Constellation ───────────────────────────────────────────────────

const warrior = {
  name: "Warrior",
  img: `${imgPath}/sign-warrior.webp`,
  description:
    "The Warrior is the first Guardian Constellation and he protects his charges during their Seasons. His Charges are the Lady, the Steed, and the Lord. Those born under the sign of the Warrior are skilled with weapons of all kinds, but prone to short tempers.",
  traits: [
    "+1 SP Maximum",
    "Star-Cursed Warrior: As above, but also gain +5 Strength and lose 5 Willpower",
  ],
  items: [
    {
      name: "The Warrior",
      type: "trait",
      img: `${imgPath}/sign-warrior.webp`,
      desc: "Those born under the sign of the Warrior increase their SP maximum by 1.",
      data: { "system.spBonus": 1 },
    },
  ],
  starCursed: [
    {
      name: "The Star-Cursed Warrior",
      type: "trait",
      img: `${imgPath}/sign-warrior.webp`,
      desc: "Increase SP maximum by 1. Gain +5 Strength, lose 5 Willpower.",
      data: {
        "system.spBonus": 1,
        "system.characteristicBonus.strChaBonus": 5,
        "system.characteristicBonus.wpChaBonus": -5,
      },
    },
  ],
};

const lady = {
  name: "Lady",
  img: `${imgPath}/sign-lady.webp`,
  description:
    "The Lady is one of the Warrior's Charges and her Season is Heartfire. Those born under the sign of The Lady are kind and tolerant.",
  traits: [
    "+5 Personality",
    "Star-Cursed Lady: As above, but also gain +5 Endurance and lose 5 Strength",
  ],
  items: [
    {
      name: "The Lady",
      type: "trait",
      img: `${imgPath}/sign-lady.webp`,
      desc: "Those born under the sign of the Lady gain +5 Personality.",
      data: { "system.characteristicBonus.prsChaBonus": 5 },
    },
  ],
  starCursed: [
    {
      name: "The Star-Cursed Lady",
      type: "trait",
      img: `${imgPath}/sign-lady.webp`,
      desc: "Gain +5 Personality, +5 Endurance, and lose 5 Strength.",
      data: {
        "system.characteristicBonus.prsChaBonus": 5,
        "system.characteristicBonus.endChaBonus": 5,
        "system.characteristicBonus.strChaBonus": -5,
      },
    },
  ],
};

const steed = {
  name: "Steed",
  img: `${imgPath}/sign-steed.webp`,
  description:
    "The Steed is one of the Warrior's Charges, and her Season is Mid Year. Those born under the sign of the Steed are impatient and always hurrying from one place to another.",
  traits: [
    "+2 Speed",
    "Star-Cursed Steed: As above, but also gain +5 Agility and lose 5 Willpower or Perception",
  ],
  items: [
    {
      name: "The Steed",
      type: "trait",
      img: `${imgPath}/sign-steed.webp`,
      desc: "Those born under the sign of the Steed increase Speed by 2.",
      data: { "system.speedBonus": 2 },
    },
  ],
  starCursed: [
    {
      name: "The Star-Cursed Steed",
      type: "trait",
      img: `${imgPath}/sign-steed.webp`,
      desc: "Increase Speed by 2. Gain +5 Agility.",
      data: {
        "system.speedBonus": 2,
        "system.characteristicBonus.agiChaBonus": 5,
      },
    },
  ],
  starCursedChoices: {
    attributes: ["willpower", "perception"],
    modifier: -5,
  },
};

const lord = {
  name: "Lord",
  img: `${imgPath}/sign-lord.webp`,
  description:
    "The Lord's Season is First Seed and he oversees all of Tamriel during the planting. Those born under the sign of the Lord are stronger and healthier than those born under other signs.",
  traits: [
    "Double natural healing rate",
    "Star-Cursed Lord: As above, but also gain +5 Endurance and the Weakness (Fire, 2) trait",
  ],
  items: [
    {
      name: "The Lord",
      type: "trait",
      img: `${imgPath}/sign-lord.webp`,
      desc: "Those born under the sign of the Lord double their natural healing rate.",
    },
  ],
  starCursed: [
    {
      name: "The Star-Cursed Lord",
      type: "trait",
      img: `${imgPath}/sign-lord.webp`,
      desc: "Double natural healing rate. Gain +5 Endurance.",
      data: { "system.characteristicBonus.endChaBonus": 5 },
    },
    {
      name: "Weakness (Fire, 2)",
      type: "trait",
      img: weakIcon,
      desc: "This character takes 2 additional incoming fire damage and gains -20 penalty to resist non-damaging fire effects.",
      data: { "system.fireR": -2 },
    },
  ],
};

// ─── Mage Constellation ─────────────────────────────────────────────────────

const mage = {
  name: "Mage",
  img: `${imgPath}/sign-mage.webp`,
  description:
    "The Mage is a Guardian Constellation whose Season is Rain's Hand when magicka was first used by men. His Charges are the Apprentice, the Golem, and the Ritual. Those born under the Mage have more magicka and talent for all kinds of spellcasting, but are often arrogant and absent-minded.",
  traits: [
    "Power Well (10)",
    "Star-Cursed Mage: Power Well (25) instead, but lose 5 Perception, Strength, or Personality",
  ],
  items: [
    {
      name: "The Mage",
      type: "trait",
      img: `${imgPath}/sign-mage.webp`,
      desc: "Those born under the sign of the Mage gain the Power Well (10) trait.",
    },
    {
      name: "Power Well (10)",
      type: "trait",
      img: pwIcon,
      desc: "The character increases their maximum Magicka Points by 10.",
      data: { "system.mpBonus": 10 },
    },
  ],
  starCursed: [
    {
      name: "The Star-Cursed Mage",
      type: "trait",
      img: `${imgPath}/sign-mage.webp`,
      desc: "Those born under the Star-Cursed Mage gain Power Well (25) but suffer an attribute penalty.",
    },
    {
      name: "Power Well (25)",
      type: "trait",
      img: pwIcon,
      desc: "The character increases their maximum Magicka Points by 25.",
      data: { "system.mpBonus": 25 },
    },
  ],
  starCursedChoices: {
    attributes: ["perception", "strength", "personality"],
    modifier: -5,
  },
};

const apprentice = {
  name: "Apprentice",
  img: `${imgPath}/sign-apprentice.webp`,
  description:
    "The Apprentice's Season is Sun's Height. Those born under the sign of the apprentice have a special affinity for magick of all kinds, but are more vulnerable to magick as well.",
  traits: [
    "Power Well (25) and Weakness (Magic, 2)",
    "Star-Cursed Apprentice: Power Well (50) and Weakness (Magic, 3) instead",
  ],
  items: [
    {
      name: "The Apprentice",
      type: "trait",
      img: `${imgPath}/sign-apprentice.webp`,
      desc: "Those born under the sign of the Apprentice have a special affinity for magick of all kinds.",
    },
    {
      name: "Power Well (25)",
      type: "trait",
      img: pwIcon,
      desc: "The character increases their maximum Magicka Points by 25.",
      data: { "system.mpBonus": 25 },
    },
    {
      name: "Weakness (Magic, 2)",
      type: "trait",
      img: weakIcon,
      desc: "This character takes 2 additional incoming magic damage and gains -20 penalty to resist non-damaging magic effects.",
      data: { "system.magicR": -2 },
    },
  ],
  starCursed: [
    {
      name: "The Star-Cursed Apprentice",
      type: "trait",
      img: `${imgPath}/sign-apprentice.webp`,
      desc: "Those born under the Star-Cursed Apprentice have especially deep but volatile magicka reserves.",
    },
    {
      name: "Power Well (50)",
      type: "trait",
      img: pwIcon,
      desc: "The character increases their maximum Magicka Points by 50.",
      data: { "system.mpBonus": 50 },
    },
    {
      name: "Weakness (Magic, 3)",
      type: "trait",
      img: weakIcon,
      desc: "This character takes 3 additional incoming magic damage and gains -30 penalty to resist non-damaging magic effects.",
      data: { "system.magicR": -3 },
    },
  ],
};

const atronach = {
  name: "Atronach",
  img: `${imgPath}/sign-atronach.webp`,
  description:
    "The Atronach (often called the Golem) is one of the Mage's Charges. Its season is Sun's Dusk. Those born under this sign are natural sorcerers with deep reserves of magicka, but they cannot generate magicka of their own.",
  traits: [
    "Power Well (50), Spell Absorption (5), and Stunted Magicka",
    "Star-Cursed Atronach: Power Well (75) instead, and lose 5 Agility or Endurance",
  ],
  items: [
    {
      name: "The Atronach",
      type: "trait",
      img: `${imgPath}/sign-atronach.webp`,
      desc: "Those born under the sign of the Atronach are natural sorcerers with deep reserves of magicka, but they cannot generate magicka of their own.",
    },
    {
      name: "Power Well (50)",
      type: "trait",
      img: pwIcon,
      desc: "The character increases their maximum Magicka Points by 50.",
      data: { "system.mpBonus": 50 },
    },
    { pack: SIGNS_PACK, name: "Spell Absorption (5)" },
    { pack: SIGNS_PACK, name: "Stunted Magicka" },
  ],
  starCursed: [
    {
      name: "The Star-Cursed Atronach",
      type: "trait",
      img: `${imgPath}/sign-atronach.webp`,
      desc: "Those born under the Star-Cursed Atronach gain deeper magicka reserves but suffer an attribute penalty.",
    },
    {
      name: "Power Well (75)",
      type: "trait",
      img: pwIcon,
      desc: "The character increases their maximum Magicka Points by 75.",
      data: { "system.mpBonus": 75 },
    },
    { pack: SIGNS_PACK, name: "Spell Absorption (5)" },
    { pack: SIGNS_PACK, name: "Stunted Magicka" },
  ],
  starCursedChoices: {
    attributes: ["agility", "endurance"],
    modifier: -5,
  },
};

const ritual = {
  name: "Ritual",
  img: `${imgPath}/sign-ritual.webp`,
  description:
    "The Ritual is one of the Mage's Charges and its Season is Morning Star. Those born under this sign have a variety of abilities depending on the aspects of the moons and the Divines.",
  traits: [
    "Choose one daily power: Blessed Touch, Blessed Word, or Mara's Gift (lasts until next long rest)",
    "Star-Cursed Ritual: Gain all three powers permanently, but lose 5 Luck",
  ],
  items: [
    {
      name: "The Ritual",
      type: "trait",
      img: `${imgPath}/sign-ritual.webp`,
      desc: "Choose one of the following powers at the beginning of each day: Blessed Touch, Blessed Word, or Mara's Gift. This power lasts until your next long rest, when you may choose again.",
    },
    { pack: SIGNS_PACK, name: "Mara's Gift" },
    { pack: POWERS_PACK, name: "Blessed Touch" },
    { pack: POWERS_PACK, name: "Blessed Word" },
  ],
  starCursed: [
    {
      name: "The Star-Cursed Ritual",
      type: "trait",
      img: `${imgPath}/sign-ritual.webp`,
      desc: "Gain all three powers permanently (Blessed Touch, Blessed Word, Mara's Gift), but lose 5 Luck.",
      data: { "system.characteristicBonus.lckChaBonus": -5 },
    },
    { pack: SIGNS_PACK, name: "Mara's Gift" },
    { pack: POWERS_PACK, name: "Blessed Touch" },
    { pack: POWERS_PACK, name: "Blessed Word" },
  ],
};

// ─── Thief Constellation ────────────────────────────────────────────────────

const thief = {
  name: "Thief",
  img: `${imgPath}/sign-thief.webp`,
  description:
    "The Thief is the last Guardian Constellation, and her Season is the darkest month of Evening Star. Those born under the sign of the Thief are not typically thieves, though they take risks more often and only rarely come to harm. They will run out of luck eventually, however, and rarely live as long as those born under other signs.",
  traits: [
    "Extra permanent lucky number (never lost regardless of Luck score)",
    "Star-Cursed Thief: As above, but Luck becomes 50. Gain Akaviri Danger-Sense and Running Out of Luck. Cannot spend Luck to choose this sign.",
  ],
  items: [
    {
      name: "The Thief",
      type: "trait",
      img: `${imgPath}/sign-thief.webp`,
      desc: "Those born under the sign of the Thief roll an extra lucky number that they never lose regardless of their Luck score.",
    },
  ],
  starCursed: [
    {
      name: "The Star-Cursed Thief",
      type: "trait",
      img: `${imgPath}/sign-thief.webp`,
      desc: "Extra permanent lucky number. Replace Luck score with 50. Gain Akaviri Danger-Sense and Running Out of Luck.",
    },
    { pack: SIGNS_PACK, name: "Akaviri Danger-Sense" },
    { pack: SIGNS_PACK, name: "Running Out of Luck" },
  ],
  // Special: Star-Cursed Thief sets Luck base to 50 — handled in onBirthSignMenu callback.
};

const lover = {
  name: "Lover",
  img: `${imgPath}/sign-lover.webp`,
  description:
    "The Lover is one of the Thief's Charges and her season is Sun's Dawn. Those born under the sign of the Lover are graceful and passionate.",
  traits: [
    "+5 Agility",
    "Star-Cursed Lover: As above, but also gain +5 Personality and lose 5 Willpower or Strength",
  ],
  items: [
    {
      name: "The Lover",
      type: "trait",
      img: `${imgPath}/sign-lover.webp`,
      desc: "Those born under the sign of the Lover gain +5 Agility.",
      data: { "system.characteristicBonus.agiChaBonus": 5 },
    },
  ],
  starCursed: [
    {
      name: "The Star-Cursed Lover",
      type: "trait",
      img: `${imgPath}/sign-lover.webp`,
      desc: "Gain +5 Agility and +5 Personality.",
      data: {
        "system.characteristicBonus.agiChaBonus": 5,
        "system.characteristicBonus.prsChaBonus": 5,
      },
    },
  ],
  starCursedChoices: {
    attributes: ["willpower", "strength"],
    modifier: -5,
  },
};

const shadow = {
  name: "Shadow",
  img: `${imgPath}/sign-shadow.webp`,
  description:
    "The Shadow's Season is Second Seed. The Shadow grants those born under her sign the ability to hide in shadows.",
  traits: [
    "Moonshadow Power",
    "Star-Cursed Shadow: As above, but also gain +5 Perception and lose 5 Personality or Strength",
  ],
  items: [
    {
      name: "The Shadow",
      type: "trait",
      img: `${imgPath}/sign-shadow.webp`,
      desc: "Those born under the sign of the Shadow gain the Moonshadow power.",
    },
    { pack: SIGNS_PACK, name: "Moonshadow" },
  ],
  starCursed: [
    {
      name: "The Star-Cursed Shadow",
      type: "trait",
      img: `${imgPath}/sign-shadow.webp`,
      desc: "Gain Moonshadow power and +5 Perception.",
      data: { "system.characteristicBonus.prcChaBonus": 5 },
    },
    { pack: SIGNS_PACK, name: "Moonshadow" },
  ],
  starCursedChoices: {
    attributes: ["personality", "strength"],
    modifier: -5,
  },
};

const tower = {
  name: "Tower",
  img: `${imgPath}/sign-tower.webp`,
  description:
    "The Tower is one of the Thief's Charges and its Season is Frostfall. Those born under the sign of the Tower have a knack for finding gold and can open locks of all kinds.",
  traits: [
    "Treasure Seeker Power and +5 Perception",
    "Star-Cursed Tower: As above, but also gain +5 Agility and lose 5 Willpower or Strength",
  ],
  items: [
    {
      name: "The Tower",
      type: "trait",
      img: `${imgPath}/sign-tower.webp`,
      desc: "Those born under the sign of the Tower gain the Treasure Seeker power and +5 Perception.",
      data: { "system.characteristicBonus.prcChaBonus": 5 },
    },
    { pack: SIGNS_PACK, name: "Treasure Seeker" },
  ],
  starCursed: [
    {
      name: "The Star-Cursed Tower",
      type: "trait",
      img: `${imgPath}/sign-tower.webp`,
      desc: "Gain Treasure Seeker power, +5 Perception, and +5 Agility.",
      data: {
        "system.characteristicBonus.prcChaBonus": 5,
        "system.characteristicBonus.agiChaBonus": 5,
      },
    },
    { pack: SIGNS_PACK, name: "Treasure Seeker" },
  ],
  starCursedChoices: {
    attributes: ["willpower", "strength"],
    modifier: -5,
  },
};

// ─── Exported signs map ─────────────────────────────────────────────────────

/**
 * All RAW birthsign definitions keyed by lowercase name.
 * Used by the birthsign selection dialog in character-menus.js.
 */
const birthsignSigns = {
  warrior,
  lady,
  steed,
  lord,
  mage,
  apprentice,
  atronach,
  ritual,
  thief,
  lover,
  shadow,
  tower,
};

export default birthsignSigns;
