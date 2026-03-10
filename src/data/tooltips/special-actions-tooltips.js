/**
 * Centralized tooltip pointer entries for combat style special actions.
 */

import {
  buildPlaceholderLongText,
  buildPlaceholderShortText,
  composeTooltipText,
} from "./shared-tooltips.js";

export const DEFAULT_SPECIAL_ACTION_TOOLTIP_POINTER = "See UESRPG Rules: Chapter 5 (Special Actions).";

function _makeSpecialActionEntry(id) {
  const raw = String(id ?? "").trim();
  const isNarrativeText = /\s/.test(raw) && raw.length > 24;
  return Object.freeze({
    pointer: DEFAULT_SPECIAL_ACTION_TOOLTIP_POINTER,
    shortText: isNarrativeText ? raw : buildPlaceholderShortText({ domain: "specialAction", id: raw }),
    helpText: isNarrativeText ? raw : buildPlaceholderLongText({ domain: "specialAction", id: raw }),
  });
}

export const SPECIAL_ACTION_TOOLTIP_ENTRIES = Object.freeze({
  arise: _makeSpecialActionEntry("Allows the character to stand up safely, removing Prone without provoking an attack of opportunity."),
  bash: _makeSpecialActionEntry("Athletics or unarmed Combat Style opposed by Athletics, unarmed Combat Style, or Evade. On success: knockback 1m, target loses 1 AP, then Acrobatics to avoid Prone."),
  blindOpponent: _makeSpecialActionEntry("Combat Style opposed by Evade or shield-enabled Combat Style. On success, target is Blinded for 1 round."),
  disarm: _makeSpecialActionEntry("Athletics or unarmed Combat Style opposed by unarmed Combat Style or Athletics. On success, take or fling the target weapon."),
  feint: _makeSpecialActionEntry("Combat Style or Deceive opposed by Observe or Combat Style. On success, next melee attack against that target is treated as Hidden."),
  forceMovement: _makeSpecialActionEntry("Combat Style opposed by Combat Style or Athletics. On success, attacker and target move up to 3m in the same direction."),
  grapple: _makeSpecialActionEntry("Combat Style (unarmed) opposed by Combat Style (unarmed), Athletics, or Evade. On success, target is Restrained; larger targets impose -30 and 2+ sizes larger are invalid."),
  resist: _makeSpecialActionEntry("Athletics or unarmed Combat Style opposed by Athletics or unarmed Combat Style. On success, escape Restrained, Grappled, or Blinded."),
  trip: _makeSpecialActionEntry("Athletics or unarmed Combat Style opposed by Athletics, unarmed Combat Style, or Evade. On success, target becomes Prone."),
  inClose: _makeSpecialActionEntry("Athletics or unarmed Combat Style opposed by Athletics, unarmed Combat Style, or Evade. On success, enter or leave In Close range."),
});

export function getSpecialActionTooltipEntry(id) {
  const normalized = String(id ?? "").trim();
  if (!normalized) return null;
  if (SPECIAL_ACTION_TOOLTIP_ENTRIES[normalized]) return SPECIAL_ACTION_TOOLTIP_ENTRIES[normalized];
  const lowered = normalized.toLowerCase();
  const matchKey = Object.keys(SPECIAL_ACTION_TOOLTIP_ENTRIES).find((k) => k.toLowerCase() === lowered);
  return matchKey ? SPECIAL_ACTION_TOOLTIP_ENTRIES[matchKey] : null;
}

export function buildSpecialActionTooltipText({ name, id, actionType }) {
  const normalizedId = String(id ?? "").trim();
  const normalizedName = String(name ?? "").trim() || normalizedId || "Unknown";
  const normalizedActionType = String(actionType ?? "primary/secondary").trim() || "primary/secondary";
  const entry = getSpecialActionTooltipEntry(normalizedId);
  const pointer = entry?.pointer ?? DEFAULT_SPECIAL_ACTION_TOOLTIP_POINTER;
  const shortText = entry?.shortText ?? buildPlaceholderShortText({ domain: "specialAction", id: normalizedId || "unknown" });
  return composeTooltipText({
    header: `Special Action: ${normalizedName} (${normalizedId}) - ${normalizedActionType}.`,
    shortText,
    pointer,
  });
}

export function buildSpecialActionHelpText({ name, id }) {
  const normalizedId = String(id ?? "").trim();
  const normalizedName = String(name ?? "").trim() || normalizedId || "Unknown";
  const entry = getSpecialActionTooltipEntry(normalizedId);
  const helpText = entry?.helpText ?? buildPlaceholderLongText({ domain: "specialAction", id: normalizedId || "unknown" });
  return `${normalizedName} (${normalizedId}): ${helpText}`;
}