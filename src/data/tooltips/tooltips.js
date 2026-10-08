/**
 * Generic combat action tooltip data (Primary / Secondary lanes).
 *
 * This file is intentionally data-first so UI modules can render hover/help
 * text without hardcoding rule strings in templates or listeners.
 */

import {
  buildPlaceholderLongText,
  buildPlaceholderShortText,
  composeTooltipText,
} from "./shared-tooltips.js";
import { buildTooltipHeader, localizeTooltipEntry } from "./tooltip-i18n.js";

const DEFAULT_ACTION_TOOLTIP_POINTER = "See UESRPG Rules: Chapter 5 (Combat Actions).";

function _makeActionEntry(lane, id, { pointer = DEFAULT_ACTION_TOOLTIP_POINTER } = {}) {
  const raw = String(id ?? "").trim();
  const isNarrativeText = /\s/.test(raw) && raw.length > 24;
  return Object.freeze({
    lane,
    pointer,
    shortText: isNarrativeText ? raw : buildPlaceholderShortText({ domain: `${lane}Action`, id: raw }),
    helpText: isNarrativeText ? raw : buildPlaceholderLongText({ domain: `${lane}Action`, id: raw }),
  });
}

export const PRIMARY_ACTION_TOOLTIPS = Object.freeze({
  attack: _makeActionEntry("primary", "The character can make an attack with a melee or ranged weapon. A character may make no more than two total attacks in a single round. When attacking they can use one of three optional variations of this action. A player must declare if their character is choosing one of these variations before the attack test has been made."),
  castMagicPrimary: _makeActionEntry("primary", "The character channels magicka as their primary action to cast a spell."),
  disengage: _makeActionEntry("primary", "The character can use this action to retreat from combat with an enemy. If they move out of an enemy’s engagement range during this Turn then the attack of opportunity reaction or other delayed actions/reactions, may not be taken against them."),
  delay: _makeActionEntry("primary", "The character declares a set of circumstances in which they will act. The character then skips their Turn without spending AP and may insert their delayed Turn into the order as a free reaction if the conditions are met. If the delayed Turn is not taken before the character’s next Turn would occur, then the Action Points are lost entirely. "),
  "defensive-stance": _makeActionEntry("primary", "Using this action grants the character +10 on any defensive tests made until their next Turn. Taking this action reduces the character’s Attack limit to 0 until their next Turn."),
  defensivestance: _makeActionEntry("primary", "Using this action grants the character +10 on any defensive tests made until their next Turn. Taking this action reduces the character’s Attack limit to 0 until their next Turn."),
  specialAction: _makeActionEntry("primary", "Special Action"),
});

export const SECONDARY_ACTION_TOOLTIPS = Object.freeze({
  aim: _makeActionEntry("secondary", "A character can spend an Action Point to aim, gaining a +10 bonus to their next ranged attack, including spells with the Bolt form. This bonus can stack if the character takes this action multiple consecutive times before the next ranged or bolt attack, but only up to three times for a maximum bonus of +30. The “chain” of aim actions can stretch across rounds. This chain is broken and the bonus lost if the character makes an attack with another weapon or takes any actions or reactions other than to continue aiming or ﬁre the aimed weapon or spell. Once the aimed weapon is ﬁred, the bonuses from this action are reset to +0."),
  dash: _makeActionEntry("secondary", "The character can use this action in order to move up to their speed. If this is done on their Turn, this movement is added to their base movement for that Turn. This action can be used to allow a character to move several times their speed during a round."),
  hide: _makeActionEntry("secondary", "The character can use this action to attempt to hide from foes. If anyone might detect them while they do this, they must make a Stealth skill test opposed by the Observe of anyone who might spot them. On success, they gain the Hidden condition."),
  castMagicSecondary: _makeActionEntry("secondary", "The character casts an Instant spell as a secondary action when allowed by the spell."),
  "reload-weapon": _makeActionEntry("secondary", "The character reloads a weapon. Some missile weapons may require several AP to reload, in which case this action must be extended."),
  "use-item": _makeActionEntry("secondary", "The character may draw, sheath, withdraw or interact with an item. This action may also be used to drink a potion, assuming it is accessible to the character, but this costs 2 AP instead."),
  inClose: _makeActionEntry("secondary", "An aware combatant within 1m of a foe may choose to get In Close"),
});

export const REACTION_ACTION_TOOLTIPS = Object.freeze({
  "attack-of-opportunity": _makeActionEntry("reaction", "The character makes a reaction attack against an enemy that provokes one."),
  "extinguish-burning": _makeActionEntry("reaction", "The character attempts to extinguish active burning effects as a reaction when allowed."),
});

export const COMBAT_ACTION_TOOLTIPS = Object.freeze({
  ...PRIMARY_ACTION_TOOLTIPS,
  ...SECONDARY_ACTION_TOOLTIPS,
  ...REACTION_ACTION_TOOLTIPS,
});

// Short dialog rules share the sheets' catalog/localization and tooltip builders.
// Sources: Core chapters 4 (Talents), 5 (Combat), and 6 (Magic).
export const COMBAT_OPTION_TOOLTIPS = Object.freeze({
  attack: PRIMARY_ACTION_TOOLTIPS.attack,
  allOut: _makeActionEntry("option", "Melee only. Gain +20 on the attack test by spending 1 additional AP; declare this variation before rolling."),
  precisionAttack: _makeActionEntry("option", "Take -20 on the attack test to choose the hit location on a successful hit. Declare this variation before rolling."),
  coup: _makeActionEntry("option", "A killing blow against a helpless target: unconscious, restrained and prone, or otherwise unable to defend. The GM decides whether the target can be killed this way; choose the supported lethal or non-lethal result below."),
  evade: _makeActionEntry("option", "Use Evade (Agility) to avoid the attack. A successful Evade negates the attack and allows a free 1m move without provoking attacks of opportunity; against an area attack, that move must take you out of its area."),
  parry: _makeActionEntry("option", "Use Combat Style (Strength or Agility) with a melee weapon or shield to parry. A successful Parry negates the attack; attack qualities and ranged or spell restrictions may make it unavailable."),
  block: _makeActionEntry("option", "Use Combat Style (Strength) with a shield to block melee or ranged attacks. Damage exceeding BR hits the shield arm; otherwise it is stopped. Against magic, use half BR rounded up unless the shield has magic BR; area damage is halved rounded up."),
  counter: _makeActionEntry("option", "Attack while attempting to parry with your melee weapon. Both participants attack: the higher successful degree total lands the hit; equal degrees resolve neither attack. Spell attacks cannot be countered."),
  precisionStrike: _makeActionEntry("option", "Spend an offensive Advantage to choose the hit location of this attack. This is the post-roll Advantage option, not the -20 attack variation."),
  penetrateArmor: _makeActionEntry("option", "Spend an offensive Advantage to treat full armor coverage as partial and partial coverage as unarmored for this attack. The location's Armor Rating is unchanged."),
  forcefulImpact: _makeActionEntry("option", "Spend an offensive Advantage to apply Damaged (1) to one armor piece or shield covering the hit location."),
  pressAdvantage: _makeActionEntry("option", "Spend an offensive Advantage for +10 on your next melee attack against this opponent within 1 round."),
  overextend: _makeActionEntry("option", "Spend a defensive Advantage after Evade, Parry, or Block. The opponent's next attack within 1 round suffers -10."),
  overwhelm: _makeActionEntry("option", "Spend a defensive Advantage after Evade, Parry, or Block. The opponent cannot make attacks of opportunity until your next Turn."),
  blinded: _makeActionEntry("option", "Apply the Blinded penalty only when this test benefits from sight. Existing sensory adjustments still apply; clear this choice when sight is irrelevant."),
  deafened: _makeActionEntry("option", "Apply the Deafened penalty only when this test benefits from hearing. Existing sensory adjustments still apply; clear this choice when hearing is irrelevant."),
  eyeOfNight: _makeActionEntry("option", "Your first attack while Hidden at night or in total darkness can be a free Precision Strike. Select Precision Strike to use this option without its normal -20 penalty.", { pointer: "Core Chapter 4: Eye of Night." }),
  thunderCharge: _makeActionEntry("option", "After a Dash on your Turn, an All Out Attack costs 1 AP instead of 2 if you moved at least half your base Speed toward a foe and entered melee range with someone outside your reach at the start of the Turn.", { pointer: "Core Chapter 4: Thunder Charge." }),
  gladiator: _makeActionEntry("option", "When targeted by a melee attack while within melee range of two or more opponents, Gladiator makes the Evade reaction free. The selected system talent mode determines this dialog's available free-defense option.", { pointer: "Core Chapter 4: Gladiator." }),
  restraint: _makeActionEntry("option", "On a successful cast, reduce the Magicka cost by your Willpower bonus, to a minimum of 1 MP. A critical success with a non-damaging spell doubles this reduction; applicable talents adjust it.", { pointer: "Core Chapter 6: Spell Restraint." }),
  overload: _makeActionEntry("option", "A spell with the Overload attribute gains its specified extra effect when cast without Restraint. Master of Magicka permits Overload and Restraint together.", { pointer: "Core Chapter 6: Overload; Chapter 4: Master of Magicka." }),
  overcharge: _makeActionEntry("option", "Double the spell's cost after Restraint to roll its damage twice and use the higher result. Requires the Overcharge talent and an eligible damaging spell.", { pointer: "Core Chapter 4: Overcharge." }),
  magickaCycling: _makeActionEntry("option", "Increase your Willpower bonus by 2 for Spell Restraint purposes. The displayed saving includes this bonus when applicable.", { pointer: "Core Chapter 4: Magicka Cycling." }),
  ward: _makeActionEntry("option", "Use the active Ward as a magical shield with BR equal to its Spell Strength. Power Block cannot be used with it; existing Ward payment and block resolution still apply.", { pointer: "Core Chapter 6: Ward." }),
});

/** Concise rule plus prepared availability/cost context; never evaluated on hover. */
export function buildCombatOptionTooltipText(optionId, context = "") {
  const id = String(optionId ?? "").trim();
  const entry = COMBAT_OPTION_TOOLTIPS[id];
  const localized = localizeTooltipEntry("Options", id, entry);
  return composeTooltipText({
    shortText: [localized.shortText, String(context ?? "").trim()].filter(Boolean).join(" "),
    pointer: localized.pointer,
  });
}

export function getCombatActionTooltipEntry(actionId) {
  const normalized = String(actionId ?? "").trim();
  if (!normalized) return null;
  if (COMBAT_ACTION_TOOLTIPS[normalized]) return COMBAT_ACTION_TOOLTIPS[normalized];
  const lowered = normalized.toLowerCase();
  const matchKey = Object.keys(COMBAT_ACTION_TOOLTIPS).find((k) => k.toLowerCase() === lowered);
  return matchKey ? COMBAT_ACTION_TOOLTIPS[matchKey] : null;
}

export function buildCombatActionTooltipText({ label, actionId }) {
  const normalizedId = String(actionId ?? "").trim();
  const normalizedLabel = String(label ?? "").trim() || normalizedId || "Action";
  const entry = getCombatActionTooltipEntry(normalizedId);
  const localized = localizeTooltipEntry("Actions", normalizedId || "unknown", entry, {
    label: normalizedLabel,
    pointerId: "Action",
  });
  const shortText = localized.shortText || buildPlaceholderShortText({ domain: "combatAction", id: normalizedId || "unknown" });
  return composeTooltipText({
    header: buildTooltipHeader("Action", {
      label: localized.label,
      key: normalizedId,
    }, `${localized.label} (${normalizedId}).`),
    shortText,
    pointer: localized.pointer || DEFAULT_ACTION_TOOLTIP_POINTER,
  });
}

export function buildCombatActionHelpText({ label, actionId }) {
  const normalizedId = String(actionId ?? "").trim();
  const normalizedLabel = String(label ?? "").trim() || normalizedId || "Action";
  const entry = getCombatActionTooltipEntry(normalizedId);
  const localized = localizeTooltipEntry("Actions", normalizedId || "unknown", entry, {
    label: normalizedLabel,
    pointerId: "Action",
  });
  const helpText = localized.helpText || buildPlaceholderLongText({ domain: "combatAction", id: normalizedId || "unknown" });
  const header = buildTooltipHeader("Action", {
    label: localized.label,
    key: normalizedId,
  }, `${localized.label} (${normalizedId}).`);
  return [header, helpText].filter(Boolean).join(" ");
}
