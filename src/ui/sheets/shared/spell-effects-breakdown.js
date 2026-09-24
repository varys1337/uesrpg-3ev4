/**
 * src/ui/sheets/shared/spell-effects-breakdown.js
 *
 * Prepare spell effects breakdown data for the actor sheet.
 * Collects all Origin AEs on an actor and builds a display-ready summary
 * of active spell effects, including modified keys, duration/upkeep status,
 * and a permission-gated cancel action.
 *
 * Target: Foundry VTT v14 runtime
 */

import { getOriginAEs } from "../../../core/magic/effects/origin-effect.js";
import { getEffectChanges, normalizeEffectChangeMode } from "../../../utils/compat.js";

const _FLAG_NS = "uesrpg-3ev4";

/**
 * @typedef {object} SpellEffectSummary
 * @property {string} id — Origin AE ID
 * @property {string} name — Spell name
 * @property {string} img — Spell icon
 * @property {string} school — Spell school
 * @property {number} level — Spell level
 * @property {string} casterName — Caster name
 * @property {boolean} isSelf — Whether the actor is also the caster
 * @property {boolean} hasUpkeep — Whether the spell has upkeep
 * @property {number} refreshCount — Number of upkeep refreshes
 * @property {number} costPaid — MP cost originally paid
 * @property {string} durationLabel — Human-readable duration remaining
 * @property {Array<{key: string, label: string, value: string}>} modifiedKeys — AE change keys and values
 * @property {number} linkedCount — Number of linked entities (targets, templates, summons)
 * @property {boolean} canCancel — Whether the current user can cancel this spell
 */

/**
 * Build the spell effects breakdown for display on the actor sheet.
 *
 * @param {Actor} actor
 * @returns {SpellEffectSummary[]}
 */
export function prepareSpellEffectsBreakdown(actor) {
  if (!actor) return [];

  const originAEs = getOriginAEs(actor);
  if (!originAEs.length) return [];

  /** @type {SpellEffectSummary[]} */
  const results = [];

  for (const ae of originAEs) {
    const f = ae.flags?.[_FLAG_NS];
    if (!f?.isOriginAE) continue;

    const spellName = f.spellName || ae.name?.replace("[Origin] ", "") || "Unknown";
    const school = f.spellSchool || "";
    const level = Number(f.spellLevel ?? 1);
    const casterUuid = f.casterUuid || "";
    const isSelf = casterUuid === actor.uuid;

    // Resolve caster name
    let casterName = isSelf ? actor.name : "Unknown Caster";
    if (!isSelf && casterUuid) {
      try {
        const casterDoc = fromUuidSync(casterUuid);
        const casterActor = casterDoc?.documentName === "Actor" ? casterDoc : casterDoc?.actor;
        if (casterActor) casterName = casterActor.name;
      } catch (_e) { /* no-op */ }
    }

    // Upkeep info
    const hasUpkeep = Boolean(f.hasUpkeep);
    const upkeep = f.upkeep ?? {};
    const refreshCount = Number(upkeep.refreshCount ?? 0);
    const costPaid = Number(f.costPaid ?? upkeep.originalCost ?? 0);

    // Duration label
    const durationLabel = _formatDuration(ae);

    // Collect AE change keys from linked target AEs
    const modifiedKeys = _collectModifiedKeys(actor, ae);

    // Linked entities count
    const linked = Array.isArray(f.linkedEntities) ? f.linkedEntities : [];
    const linkedCount = linked.length;

    // Permission: can cancel if user owns the actor (caster)
    const canCancel = isSelf && (actor.isOwner || game.user?.isGM);

    results.push({
      id: ae.id,
      name: spellName,
      img: ae.img || "icons/svg/aura.svg",
      school,
      level,
      casterName,
      isSelf,
      hasUpkeep,
      refreshCount,
      costPaid,
      durationLabel,
      modifiedKeys,
      linkedCount,
      canCancel
    });
  }

  return results;
}

/**
 * Format the remaining duration of an Origin AE.
 * @param {ActiveEffect} ae
 * @returns {string}
 */
function _formatDuration(ae) {
  const dur = ae.duration ?? {};
  const value = dur.value;
  if (value == null && dur.expiry == null) return "Permanent";
  if (!(Number(value) > 0)) return "Instant / No duration";
  if (dur.expired === true) return "Expired";

  const label = String(dur.label ?? "").trim();
  if (label) return label;

  const remaining = Number(dur.remaining);
  const units = String(dur.units ?? "").trim();
  if (Number.isFinite(remaining)) {
    if (remaining <= 0) return "Expired";
    const singular = units.endsWith("s") ? units.slice(0, -1) : units;
    const unitLabel = remaining === 1 ? singular : units;
    return `${remaining} ${unitLabel} remaining`;
  }
  return "Active";
}

/**
 * Collect modified keys from the target AEs linked to this Origin AE.
 * Also checks actor-local effects that reference this origin.
 * @param {Actor} actor
 * @param {ActiveEffect} originAE
 * @returns {Array<{key: string, label: string, value: string}>}
 */
function _collectModifiedKeys(actor, originAE) {
  const f = originAE.flags?.[_FLAG_NS];
  const spellUuid = f?.spellUuid;
  const casterUuid = f?.casterUuid;
  if (!spellUuid) return [];

  /** @type {Array<{key: string, label: string, value: string}>} */
  const keys = [];
  const seen = new Set();

  // Check all effects on the actor that reference this spell
  for (const ef of (actor.effects ?? [])) {
    if (ef.id === originAE.id) continue; // Skip the origin itself
    const ef_f = ef.flags?.[_FLAG_NS];
    if (!ef_f?.spellEffect) continue;
    if (ef_f.spellUuid !== spellUuid) continue;
    if (ef_f.casterUuid !== casterUuid) continue;

    for (const ch of getEffectChanges(ef)) {
      if (!ch?.key || seen.has(ch.key)) continue;
      seen.add(ch.key);
      const modeStr = _modeLabel(ch.type);
      keys.push({
        key: ch.key,
        label: _humanizeKey(ch.key),
        value: `${modeStr} ${ch.value ?? 0}`
      });
    }
  }

  return keys;
}

function _modeLabel(mode) {
  const normalized = normalizeEffectChangeMode(mode);
  if (normalized === "add") return "+";
  if (normalized === "override") return "=";
  return "?";
}

function _humanizeKey(key) {
  // Strip common prefixes for readability
  return String(key || "")
    .replace(/^system\.modifiers\./, "")
    .replace(/^system\./, "")
    .replace(/\./g, " › ");
}
