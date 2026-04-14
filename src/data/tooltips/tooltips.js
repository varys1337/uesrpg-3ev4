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

function _makeActionEntry(lane, id) {
  const raw = String(id ?? "").trim();
  const isNarrativeText = /\s/.test(raw) && raw.length > 24;
  return Object.freeze({
    lane,
    pointer: DEFAULT_ACTION_TOOLTIP_POINTER,
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
