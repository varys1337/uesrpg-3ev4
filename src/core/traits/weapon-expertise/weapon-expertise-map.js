/**
 * @module traits/weapon-expertise/weapon-expertise-map
 * @description Canonical definitions for Weapon Expertise talents (Chapter 4).
 * Each entry defines weapon requirements, trigger conditions, and effect metadata.
 *
 * This module is pure data — no side effects, no imports beyond constants.
 */

/**
 * Normalize a weapon name for matching purposes.
 * Strips punctuation/case/whitespace to enable fuzzy matching.
 * @param {string} name
 * @returns {string}
 */
export function normalizeWeaponName(name) {
  return String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .replace(/-+/g, "");
}

/**
 * Canonical weapon expertise talent definitions.
 *
 * Each key is the talent slug (matching TALENT_NAME_ALIASES in talents-api.js).
 * Properties:
 *  - weapons: array of normalized weapon names this talent applies to
 *  - attackMode: "melee"|"ranged"|"any" — required attack mode
 *  - trigger: description of when the talent fires
 *  - automation: what the system automates for this talent
 *  - passive: array of passive quality/property changes to note in chat
 */
export const WEAPON_EXPERTISE = {
  beardedwarrior: {
    slug: "beardedwarrior",
    label: "Bearded Warrior",
    weapons: ["battleaxe", "waraxe"],
    attackMode: "melee",
    trigger: "on-damage-after-mitigation",
    automation: "post-damage-move",
    passive: [],
    notes: [
      "On ≥1 damage after mitigation: may move target 1m (cannot increase distance).",
      "On opponent block: may spend 1 SP → opposed STR test → target drops shield."
    ]
  },

  beastofsteel: {
    slug: "beastofsteel",
    label: "Beast of Steel",
    weapons: ["flail", "greatflail"],
    attackMode: "melee",
    trigger: "momentum-system",
    automation: "informational",
    passive: ["Flails wielded gain the Concussive quality."],
    notes: [
      "Spend 1 AP or 1 SP to build Momentum (Free Action to maintain).",
      "With momentum: +1d4 (flail) or +1d6 (great flail) bonus damage.",
      "Momentum lost on non-attack/non-dash action, blocked attack, or GM discretion."
    ]
  },

  blademaster: {
    slug: "blademaster",
    label: "Blademaster",
    weapons: ["longsword"],
    attackMode: "melee",
    trigger: "pre-tn",
    automation: "quality-swap-and-defensive",
    passive: [
      "CS(STR) + 2H longsword: may replace Slashing with Crushing(1).",
      "CS(AGI) + 2H longsword: may use AGI bonus for Slashing instead of STR.",
      "Defensive Stance + 2H longsword: +10 to next parry before next Turn."
    ],
    notes: []
  },

  bruiser: {
    slug: "bruiser",
    label: "Bruiser",
    weapons: ["handaxe", "mace"],
    thrownWeapons: ["handaxe"],
    attackMode: "any",
    trigger: "on-damage",
    automation: "damage-modifier",
    passive: [
      "Maces wielded gain the Concussive quality.",
      "Drawing hand axes does not provoke attacks of opportunity.",
      "Throwing hand axes does not provoke attacks of opportunity.",
      "Thrown axes retrievable as Free Action."
    ],
    notes: [
      "Thrown axes: +STR bonus to damage (replaces AGI from Dart Thrower).",
      "All Out Attack with maces: target loses 1 SP if damage dealt after mitigation."
    ]
  },

  cleaverofmen: {
    slug: "cleaverofmen",
    label: "Cleaver of Men",
    weapons: ["greatsword"],
    attackMode: "melee",
    trigger: "on-all-out-attack",
    automation: "informational",
    passive: [
      "May replace Slashing with Crushing(2) when wielding a greatsword."
    ],
    notes: [
      "All Out Attack with greatsword: strike one additional target within 2m.",
      "Extra target defends normally, roll damage separately.",
      "Cannot win advantages. Stacks with Mighty Cleave."
    ]
  },

  daisho: {
    slug: "daisho",
    label: "Daisho",
    weapons: ["katana", "wakizashi"],
    attackMode: "melee",
    trigger: "passive",
    automation: "informational",
    passive: [
      "Katana wielded in two hands: damage → 1d10.",
      "Dual wielding Katana + Wakizashi: use two-handed damage values (Katana 1d8, Wakizashi 1d6)."
    ],
    notes: []
  },

  darthrower: {
    slug: "darthrower",
    label: "Dart Thrower",
    weapons: [], // all thrown weapons
    attackMode: "ranged",
    trigger: "on-thrown-attack",
    automation: "damage-modifier",
    passive: [],
    notes: [
      "+AGI bonus to damage with all thrown weapons.",
      "Thrown dagger/throwing star/dart: -10 penalty to cause two hits instead of one."
    ]
  },

  deathbyathousandcuts: {
    slug: "deathbyathousandcuts",
    label: "Death by a Thousand Cuts",
    weapons: ["katana", "wakizashi"],
    attackMode: "melee",
    trigger: "on-damage-after-mitigation",
    automation: "apply-bleeding",
    passive: [],
    notes: [
      "On ≥1 damage after mitigation with Katana/Wakizashi: apply Bleeding(1)."
    ]
  },

  executioner: {
    slug: "executioner",
    label: "Executioner",
    weapons: ["greataxe", "scimitar"],
    attackMode: "melee",
    trigger: "on-all-out-attack",
    automation: "damage-modifier",
    passive: [
      "Foes suffer -20 to Shock tests from wounds inflicted by greataxes and scimitars."
    ],
    notes: [
      "All Out Attack bonus → +30 (instead of +20).",
      "+1d4 added to STR bonus for Splitting/Slashing when All Out Attacking."
    ]
  },

  firingline: {
    slug: "firingline",
    label: "Firing Line",
    weapons: ["crossbow", "arbalest"],
    attackMode: "ranged",
    trigger: "on-aim-and-shot",
    automation: "informational",
    passive: [
      "Ranged attacks with crossbow/arbalest add Splitting Quality = 2× Aim Actions.",
      "Tower shield: set up as Secondary Action for cover.",
      "Behind set-up tower shield: free Aim action if no move/reload."
    ],
    notes: []
  },

  fromoblivionsheart: {
    slug: "fromoblivionsheart",
    label: "From Oblivion's Heart",
    weapons: ["trident"],
    attackMode: "any",
    trigger: "on-wound",
    automation: "apply-bleeding",
    passive: [
      "Trident gains Thrown(5/10/20).",
      "Thrown hit with trident counts as Entangling (can still be blocked, inflicts damage)."
    ],
    notes: [
      "If attack inflicts a wound: enemy gains Bleeding(1) regardless of shock test."
    ]
  },

  halberdier: {
    slug: "halberdier",
    label: "Halberdier",
    weapons: ["halberd"],
    attackMode: "melee",
    trigger: "on-hit-mounted",
    automation: "informational",
    passive: [
      "May replace Splitting with Crushing quality.",
      "Halberd range becomes 3m."
    ],
    notes: [
      "After successful attack vs mounted: spend 1 SP → force Ride test or dismount prone."
    ]
  },

  hammerblow: {
    slug: "hammerblow",
    label: "Hammerblow",
    weapons: ["warhammer", "maul"],
    attackMode: "melee",
    trigger: "on-hit",
    automation: "post-hit-sp-loss-and-dazed",
    passive: [],
    notes: [
      "On hit with warhammer/maul: target loses 1 SP.",
      "If All Out Attack: instead force END(+0) test or Dazed condition.",
      "Dazed removal: END(+10) test as Free Action each round."
    ]
  },

  kensai: {
    slug: "kensai",
    label: "Kensai",
    weapons: ["daikatana"],
    attackMode: "melee",
    trigger: "on-wound-aoo",
    automation: "informational",
    passive: [
      "Dai-katanas wielded gain the Impaling quality."
    ],
    notes: [
      "Wound via attack of opportunity against closing enemy → all witnesses must roll +10 Panic Test."
    ]
  },

  knifefighter: {
    slug: "knifefighter",
    label: "Knife Fighter",
    weapons: ["shortsword", "dagger", "tanto"],
    attackMode: "melee",
    trigger: "on-penetrate-armor",
    automation: "damage-modifier",
    passive: [
      "Draw shortswords free without provoking attacks of opportunity.",
      "Throwing daggers does not provoke attacks of opportunity.",
      "May use AGI bonus instead of STR bonus for Slashing with daggers/tantos/shortswords."
    ],
    notes: [
      "Penetrate Armor advantage with tanto/dagger/shortsword: +1d4 damage."
    ]
  },

  monsterhunter: {
    slug: "monsterhunter",
    label: "Monster Hunter",
    weapons: ["pike"],
    attackMode: "melee",
    trigger: "passive-and-wt",
    automation: "wt-modifier",
    passive: [
      "Pike loses Unwieldy quality and gains Splitting quality.",
      "Treat Large+ creatures as one size larger for Size To-Hit effects."
    ],
    notes: [
      "Treat target WT as one lower when wielding a pike."
    ]
  },

  pointblank: {
    slug: "pointblank",
    label: "Point Blank",
    weapons: ["shortbow"],
    attackMode: "ranged",
    trigger: "passive",
    automation: "informational",
    passive: [
      "Never provokes attacks of opportunity with shortbow in melee range.",
      "Can use shortbow to parry attacks.",
      "Shortbows wielded gain Exploit Weakness.",
      "Can gain advantage normally with shortbow at melee range."
    ],
    notes: []
  },

  powerdraw: {
    slug: "powerdraw",
    label: "Power Draw",
    weapons: ["longbow"],
    attackMode: "ranged",
    trigger: "on-stamina-spend",
    automation: "informational",
    passive: [
      "Longbows wielded gain Exploit Weakness.",
      "May use longbow as unwieldy wooden quarterstaff in melee."
    ],
    notes: [
      "Spend 1 SP before attack: if hit deals damage → target must make STR test or be knocked prone."
    ]
  },

  pugilist: {
    slug: "pugilist",
    label: "Pugilist",
    weapons: [], // natural weapons / hand-to-hand
    attackMode: "melee",
    trigger: "passive-damage",
    automation: "damage-modifier",
    passive: [
      "Upgrade Natural Weapon damage die by one step.",
      "No -10 penalty for open-hand actions from Hand to Hand Weapon Quality."
    ],
    notes: [
      "+1 to Slashing or Crushing value of Hand to Hand weapons."
    ]
  },

  redlegionthrow: {
    slug: "redlegionthrow",
    label: "Red Legion Throw",
    weapons: ["javelin"],
    attackMode: "ranged",
    trigger: "on-damage-after-mitigation",
    automation: "apply-crippled",
    passive: [],
    notes: [
      "Successful javelin damage after mitigation: target location is Speared (treated as crippled until removed).",
      "Spear removal: Free Action → Bleeding(1), or Secondary Action STR test.",
      "If blocked: shield is Speared (1 SP to attempt further blocks).",
      "Shield spear removal: STR test as Secondary Action."
    ]
  },

  riposte: {
    slug: "riposte",
    label: "Riposte",
    weapons: [], // any weapon with Dueling Weapon quality
    attackMode: "melee",
    trigger: "on-counter-attack",
    automation: "informational",
    passive: [],
    notes: [
      "First Counter-Attack with a Dueling Weapon does not count toward max attacks per round."
    ]
  },

  ripandtear: {
    slug: "ripandtear",
    label: "Rip and Tear",
    weapons: ["hooksword"],
    attackMode: "melee",
    trigger: "passive",
    automation: "informational",
    passive: [
      "Hook Swords: replace Slashing(1) with Slashing quality.",
      "Hooked trait penalties increased to -20."
    ],
    notes: []
  },

  simpleyeteffective: {
    slug: "simpleyeteffective",
    label: "Simple, Yet Effective",
    weapons: ["broadsword"],
    attackMode: "melee",
    trigger: "on-failed-cs-test",
    automation: "informational",
    passive: [],
    notes: [
      "May reroll failed Combat Style tests with broadsword, once per test."
    ]
  },

  slingerswail: {
    slug: "slingerswail",
    label: "Slinger's Wail",
    weapons: ["sling"],
    attackMode: "ranged",
    trigger: "on-hidden-attack",
    automation: "informational",
    passive: [],
    notes: [
      "Attack with sling while Hidden: characters within short range must make +0 Panic test."
    ]
  },

  staffmastery: {
    slug: "staffmastery",
    label: "Staff Mastery",
    weapons: ["quarterstaff"],
    attackMode: "melee",
    trigger: "on-defensive-stance",
    automation: "informational",
    passive: [
      "Quarterstaffs wielded gain Crushing quality.",
      "Defensive Stance: next defensive reaction is a Free Action."
    ],
    notes: []
  },

  viperseye: {
    slug: "viperseye",
    label: "Viper's Eye",
    weapons: ["spear"],
    attackMode: "melee",
    trigger: "pre-tn",
    automation: "pre-tn-modifier",
    passive: [
      "Spears wielded gain Slashing quality.",
      "Two-handed spear: loses Unwieldy, range is 3m."
    ],
    notes: [
      "Precision Strike with spear: replace Slashing with Crushing, only -10 penalty (instead of -20)."
    ]
  },

  whirlingschool: {
    slug: "whirlingschool",
    label: "The Whirling School",
    weapons: ["bola"],
    attackMode: "ranged",
    trigger: "on-precision-strike",
    automation: "apply-condition-dialog",
    passive: [],
    notes: [
      "Special Precision Strike: wrap bola around target's neck or legs.",
      "Neck: target loses 1 SP/round (does not stack).",
      "Legs: target gains Immobilized condition.",
      "Either effect ends when bola removed (target/ally within 1m, Primary Action, +0 STR test)."
    ]
  }
};

/**
 * Get all weapon expertise talent slugs.
 * @returns {string[]}
 */
export function getWeaponExpertiseSlugs() {
  return Object.keys(WEAPON_EXPERTISE);
}
