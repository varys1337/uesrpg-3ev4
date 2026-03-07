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
  arise: _makeSpecialActionEntry("Allows the character to use a momentary opening to roll back up to their feet, removing the prone condition without granting opponents the ability to make an attack of opportunity."),
  bash: _makeSpecialActionEntry("Character makes an Athletics or unarmed Combat Style test which their opponent may oppose with their Athletics, unarmed Combat Style, or Evade skill. If they win, their opponent is knocked back 1 meter, loses an AP, and must make an Acrobatics test to avoid falling prone. Target character cannot be of larger size and must be within 2 meters. "),
  blindOpponent: _makeSpecialActionEntry("Character makes a Combat Style test which their opponent may oppose with their Evade or Combat Style (if wielding a shield). If the target loses, they become blinded for 1 round. The character must reasonably have access to some way to blind their opponent (thrown sand or rocks, for example)."),
  disarm: _makeSpecialActionEntry("Character makes an Athletics or unarmed Combat Style test which their opponent may oppose with their unarmed Combat Style or Athletics skill. If the target of the disarm attempt loses,  the character may choose to either take the target’s weapon if they have a free hand or ﬂing the target’s weapon 1d4 meters in a random direction. Target cannot be of larger size and must be within 2 meters. Cannot disarm natural weapons."),
  feint: _makeSpecialActionEntry("Character attempts a Combat Style or Deceive test against an opponent’s Observe or Combat Style within a 2m range. If successful, they treat their next melee attack against the target as if they were Hidden. This eﬀect only applies if the attack occurs before the end of the character’s current Turn."),
  forceMovement: _makeSpecialActionEntry("Character makes a Combat Style test which their opponent may oppose with their Combat Style or Athletics skill. If they win, they may move themself and their opponent up to three meters in any direction (they must both move in the same direction and the same amount) as the character shifts the location of the ﬁght. Target character must be within melee range."),
  resist: _makeSpecialActionEntry("Character makes an Athletics or unarmed Combat Style test which their opponent may oppose with their Athletics or unarmed Combat Style skill. If they win, they may escape being restrained, grappled, or blinded."),
  trip: _makeSpecialActionEntry("Character makes an Athletics or unarmed Combat Style test which their opponent may oppose with their Athletics, unarmed Combat Style, or Evade skill. If they win, their opponent falls prone. Target character cannot be of larger size and must be within 2 meters. "),
  inClose: _makeSpecialActionEntry("Character makes an Athletics or unarmed Combat Style test which their opponent may oppose with their Athletics, unarmed Combat Style, or Evade skill. If they win then can either enter In Close (provided you are within 1m at the end of the exchange) range or leave it. If they fail - this action triggers an Attack of Opportunity."),
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
