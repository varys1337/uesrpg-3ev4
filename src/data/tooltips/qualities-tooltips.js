/**
 * Centralized tooltip pointer entries for qualities/traits.
 *
 * Keep text here data-driven so sheet bindings stay thin and future
 * chapter/section updates do not require UI logic edits.
 */

import {
  buildPlaceholderLongText,
  buildPlaceholderShortText,
  composeTooltipText,
} from "./shared-tooltips.js";
import { buildTooltipHeader, localizeTooltipEntry } from "./tooltip-i18n.js";

export const DEFAULT_QUALITY_TOOLTIP_POINTER = "See UESRPG Rules: Chapter 7 (Weapon/Armor Qualities).";

function _makeQualityEntry(key) {
  const raw = String(key ?? "").trim();
  const isNarrativeText = /\s/.test(raw) && raw.length > 24;
  return Object.freeze({
    pointer: DEFAULT_QUALITY_TOOLTIP_POINTER,
    shortText: isNarrativeText ? raw : buildPlaceholderShortText({ domain: "quality", id: raw }),
    helpText: isNarrativeText ? raw : buildPlaceholderLongText({ domain: "quality", id: raw }),
  });
}

export const QUALITY_TOOLTIP_ENTRIES = Object.freeze({
  // Core structured qualities
  slashing: _makeQualityEntry("Weapons with this quality tear ﬂesh with ease, dealing bonus damage equal to the wielder’s Strength bonus (or X, if another value is given) against unarmored hit locations."),
  splitting: _makeQualityEntry("Weapons with this quality can deal savage wounds when properly brought to bear. They deal bonus damage equal to the wielder’s Strength bonus (or X, if another value is given), but only if the initial damage result causes the target to lose 1 or more HP."),
  crushing: _makeQualityEntry("Weapons with this quality can crush metal and bone alike. They deal bonus damage equal to the wielder’s Strength bonus (or X, if another value is given), capped at the AR of the hit location or BR of a shield used to block it."),
  magicWeapon: _makeQualityEntry("Weapons with this quality are able to harm targets that would otherwise resist or be impervious to damage from normal weap-ons, such as ghosts."),
  silver: _makeQualityEntry("Gains Magic, counts as silver for damage purposes."),
  primitive: _makeQualityEntry("Roll twice and use the lower value for this weapon’s damage."),
  proven: _makeQualityEntry("Roll twice and use the higher value for this weapon’s damage."),
  reload: _makeQualityEntry("After attacking with this weapon, characters must spend X AP using a Ready Secondary Action in order to reload this weapon before they can attack with it again."),
  damagedWeapon: _makeQualityEntry("Weapons with this quality deal X less damage. If this would ever render a character incapable of dealing damage with the weapon, even with the maximum possible roll, then the weapon is destroyed. Natural Weapons cannot receive this Quality. All instances of this quality stack."),

  // Weapon traits
  concussive: _makeQualityEntry("The weapon causes heavy impacts and can send opponents sprawling. When a character triggers the bash Special Action after gaining advantage with this weapon, they gain a +20 bonus to the opposed test."),
  complex: _makeQualityEntry("A character cannot move on a Turn that they are reloading this weapon."),
  dueling: _makeQualityEntry("Weapons with this quality add an additional degree of success to successful tests made to parry or Counter-Attack with them."),
  entangling: _makeQualityEntry("Attacks with this weapon cannot be parried or blocked. Instead of dealing damage, a successful attack with this weapon forces the opponent to make a Strength or Agility test. If they fail, they gain the Entangled condition. They can spend 1 AP as a Secondary Action to repeat the test, freeing themselves and removing the condition on a success.If this eﬀect was applied by a melee attack, then should the target character leave the melee range of the Entangling weapon, the character wielding the weapon must choose to either let go of their weapon (maintaining the eﬀect on the target) or keep their weapon (removing the eﬀect from the target)."),
  exploitWeakness: _makeQualityEntry("These weapons are small and able to slip into gaps in a target’s defenses. Attacks with this weapon treat full armor as partial armor and partial armor as unarmored (but do not actually reduce the location’s AR). This can be used to trigger eﬀects, such as Slashing, that interact with the level of armor the target is wearing."),
  flail: _makeQualityEntry("Weapons of this type are able to strike unpredictably. These weapons cannot be parried or countered, but cannot be used to parry or Counter-Attack either. If an attacker with this weapon and a defender blocking with a shield both pass their respective tests and the attacker’s degrees of success exceed those of the defender, then the defender does not block the attack as they normally would, and the attack is resolved as if the attacker had won. If a character critically fails an attack with a ﬂail they hit themselves."),
  focus: _makeQualityEntry("Character treats the hand holding the weapon as a free hand for the purposes of casting spells. The weapon does not increase the range of any spell as a result of its reach."),
  handToHand: _makeQualityEntry("This weapon can be used with Unarmed Combat Style and counts as Unarmed for the purposes of resolving damage. Additionally, the wielder can perform actions that require an open hand while wielding these weapons at a -10 penalty."),
  hooked: _makeQualityEntry("This weapon has a hook that can be used to trip and yank opponents and their weapons. Attempts to defend against the character’s Disarm, Take Weapon & Trip Special Actions is done at a -10 penalty."),
  impaling: _makeQualityEntry("If this weapon is used to make an attack of opportunity against a character who is approaching the wielder, and that attack causes the target to lose HP, the target does not advance and instead halts their movement for the Turn."),
  mounted: _makeQualityEntry("Weapons with this quality can only be used while mounted due to their weight and balance and only if the character moves."),
  shieldSplitter: _makeQualityEntry("Attacks from this weapon halve the BR of shields used to block them (round up)."),
  sling: _makeQualityEntry("This weapon does not use conventional ammunition; instead, it uses small rocks and other similarly-sized and shaped objects. Ammunition can be speciﬁcally purchased or crafted for this weapon but the material’s damage bonus is not applied."),
  small: _makeQualityEntry("This weapon cannot be used to Parry or Counter attacks from 2 handed weapons. Readying it does not cost an AP. The wielder may make a Subterfuge skill test to conceal the weapon. Enemies with normal weapons can make opportunity attacks against characters with this weapon who enter their range."),
  snare: _makeQualityEntry("This weapon can be used to perform the Bash and Trip Special Actions while ignoring the 2 meter range limitation. Doing so always uses the attacker’s Combat Style skill against the defender’s Athletics or Evade skill."),
  thrown: _makeQualityEntry("This weapon can be thrown as a ranged attack against a target  within X/Y/Z meters. Resolve this like a normal ranged attack (though Strength can be a base for the test), dealing the weapon’s normal damage and ignoring Slashing/Crushing/Splitting."),
  unwieldy: _makeQualityEntry("Attempts to parry or Counter-Attack using this weapon suﬀer a -20 penalty. "),

  // Armor traits
  magicArmor: _makeQualityEntry("Armor with this quality is magical and provides protection against certain attacks, such as those of incorporeal beings. Shields with this quality can be used to block such attacks."),
  damagedArmor: _makeQualityEntry("A piece of Armor or a shield with this quality has its all of its Armor Ratings (AR, MR, etc) or BR reduced by X. If this would reduce AR or BR to 0, then the item is destroyed. Natural Armor cannot receive this Quality. All instances of this quality stack."),
  towerShield: _makeQualityEntry("Tower shields are 1 weight class heavier (to a maximum of super-heavy) than a normal shield of their type, have 1 higher ENC, and cost 25% more. Tower shields grant the wielder a +10 bonus to tests made to block attacks, but carrying one reduces a character’s Speed by 1."),
  targeShield: _makeQualityEntry("Targes are 1 weight class lower than normal shields of their type and cost 25% less. Targes halve their BR (rounding up) and count as a free hand, but only for wielding Small weapons or when grappling."),
  bucklerShield: _makeQualityEntry("Bucklers are 1 weight class lower than a normal shield of their type, have 1 lower ENC, and cost 25% less. Bucklers can not block. Instead, they add an extra degree of success to all successful Parry tests. Additionally, when the defender wins an opposed Parry test they always gain Advantage, but they must pay the AP cost if picking the Special Action Advantage."),
});

export function getQualityTooltipEntry(key, { itemType = "" } = {}) {
  const normalized = String(key ?? "").trim();
  if (!normalized) return null;
  const type = String(itemType ?? "").trim().toLowerCase();
  const aliasByType = {
    weapon: {
      magic: "magicWeapon",
      damaged: "damagedWeapon",
    },
    armor: {
      magic: "magicArmor",
      damaged: "damagedArmor",
    },
  };
  const aliased = aliasByType[type]?.[normalized] ?? normalized;
  if (QUALITY_TOOLTIP_ENTRIES[aliased]) return QUALITY_TOOLTIP_ENTRIES[aliased];
  if (QUALITY_TOOLTIP_ENTRIES[normalized]) return QUALITY_TOOLTIP_ENTRIES[normalized];
  const lowered = normalized.toLowerCase();
  const matchKey = Object.keys(QUALITY_TOOLTIP_ENTRIES).find((k) => k.toLowerCase() === lowered || k.toLowerCase() === String(aliased).toLowerCase());
  return matchKey ? QUALITY_TOOLTIP_ENTRIES[matchKey] : null;
}

export function buildQualityTooltipText({ label, key, itemType = "" }) {
  const normalizedKey = String(key ?? "").trim();
  const normalizedLabel = String(label ?? "").trim() || normalizedKey || "Unknown";
  const entry = getQualityTooltipEntry(normalizedKey, { itemType });
  const localized = localizeTooltipEntry("Qualities", normalizedKey || "unknown", entry, {
    label: normalizedLabel,
    pointerId: "Quality",
  });
  const shortText = localized.shortText || buildPlaceholderShortText({ domain: "quality", id: normalizedKey || "unknown" });
  return composeTooltipText({
    header: buildTooltipHeader("Quality", {
      label: localized.label,
      key: normalizedKey,
    }, `Quality: ${localized.label} (${normalizedKey}).`),
    shortText,
    pointer: localized.pointer || DEFAULT_QUALITY_TOOLTIP_POINTER,
  });
}

export function buildQualityHelpText({ label, key, itemType = "" }) {
  const normalizedKey = String(key ?? "").trim();
  const normalizedLabel = String(label ?? "").trim() || normalizedKey || "Unknown";
  const entry = getQualityTooltipEntry(normalizedKey, { itemType });
  const localized = localizeTooltipEntry("Qualities", normalizedKey || "unknown", entry, {
    label: normalizedLabel,
    pointerId: "Quality",
  });
  const helpText = localized.helpText || buildPlaceholderLongText({ domain: "quality", id: normalizedKey || "unknown" });
  const header = buildTooltipHeader("Quality", {
    label: localized.label,
    key: normalizedKey,
  }, `Quality: ${localized.label} (${normalizedKey}).`);
  return [header, helpText].filter(Boolean).join(" ");
}
