/**
 * src/core/skills/opposed-workflow/context.js
 *
 * Stage 06 modular boundary: context and special-action legality helpers.
 *
 * NOTE: This module is intentionally dependency-light and contains only
 * deterministic helpers used by the opposed workflow UI.
 */

import { buildSpecialActionTestChoicesForActor } from "../../combat/combat-style-utils.js";

/**
 * Determine default governing characteristic selection for a given skill UUID.
 * @param {Array<object>} skills
 * @param {string} skillUuid
 * @returns {string}
 */
export function _defaultSelectedCharacteristicForSkill(skills, skillUuid) {
  const selected = Array.isArray(skills)
    ? skills.find(s => String(s?.uuid ?? "") === String(skillUuid ?? ""))
    : null;

  const opts = Array.isArray(selected?.governingChaOptions) ? selected.governingChaOptions : [];
  const selectedCha = String(selected?.selectedCha ?? "").trim().toLowerCase();
  return selectedCha || (opts[0]?.key ? String(opts[0].key).toLowerCase() : "");
}

/**
 * Normalize Special Action context from either the new context object or legacy id.
 * @param {object} data
 * @returns {{id:string,source:string,attackerStyleUuid:string|null,defenderStyleUuid:string|null}|null}
 */
export function _getSpecialActionContext(data) {
  const ctx = data?.specialActionContext;
  if (ctx && typeof ctx === "object" && String(ctx.id ?? "").trim()) {
    return {
      id: String(ctx.id).trim(),
      source: String(ctx.source ?? "unknown"),
      attackerStyleUuid: String(ctx.attackerStyleUuid ?? "").trim() || null,
      defenderStyleUuid: String(ctx.defenderStyleUuid ?? "").trim() || null
    };
  }
  return null;
}

/**
 * Build legality constraints for a special action lane.
 * @param {object} data
 * @param {Actor} actor
 * @param {"attacker"|"defender"} side
 * @returns {{context:object,choices:Array<object>,allowedSet:Set<string>}|null}
 */
export function _getSpecialActionLegalityForSide(data, actor, side) {
  const context = _getSpecialActionContext(data);
  if (!context || !actor) return null;

  const lane = String(side ?? "").toLowerCase() === "defender" ? "defender" : "attacker";
  const preferredStyleUuid = lane === "attacker" ? context.attackerStyleUuid : context.defenderStyleUuid;

  const choices = buildSpecialActionTestChoicesForActor(actor, {
    specialActionId: context.id,
    side: lane,
    preferredStyleUuid
  });

  const allowedSet = new Set(
    choices
      .map(c => String(c?.skillUuid ?? "").trim())
      .filter(Boolean)
  );

  return { context, choices, allowedSet };
}

/**
 * Filter a skill list down to only those legal for the special action.
 * @param {Array<object>} skills
 * @param {object|null} legality
 * @returns {Array<object>}
 */
export function _filterSkillsForSpecialAction(skills, legality) {
  if (!legality) return Array.isArray(skills) ? skills : [];
  const allowed = legality.allowedSet;
  if (!(allowed instanceof Set) || allowed.size === 0) return [];
  return (Array.isArray(skills) ? skills : []).filter(s => allowed.has(String(s?.uuid ?? "").trim()));
}

/**
 * Validate a declaration against special action legality.
 * @param {object} decl
 * @param {object|null} legality
 * @returns {boolean}
 */
export function _isSpecialActionSelectionLegal(decl, legality) {
  if (!legality) return true;
  const selectedUuid = String(decl?.skillUuid ?? "").trim();
  return Boolean(selectedUuid && legality.allowedSet.has(selectedUuid));
}

