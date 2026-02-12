/**
 * src/ui/sheets/shared/spell-effects-breakdown.js
 *
 * Prepare spell effects breakdown data for the actor sheet.
 * Collects all Origin AEs on an actor and builds a display-ready summary
 * of active spell effects, including modified keys, duration/upkeep status,
 * and a permission-gated cancel action.
 *
 * Target: Foundry VTT v13.351
 */

import { getOriginAEs } from "../../../core/magic/effects/origin-effect.js";

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
  const seconds = Number(dur.seconds ?? 0);
  const rounds = Number(dur.rounds ?? 0);
  const startTime = Number(dur.startTime ?? 0);
  const startRound = Number(dur.startRound ?? 0);

  if (seconds === Infinity || rounds === Infinity) return "Permanent";
  if (seconds <= 0 && rounds <= 0) return "Instant / No duration";

  // Combat-based
  if (dur.combat && game?.combat?.id === dur.combat) {
    const currentRound = Number(game.combat.round ?? 0);
    const elapsed = currentRound - startRound;
    const remaining = Math.max(0, rounds - elapsed);
    return `${remaining} round${remaining !== 1 ? "s" : ""} remaining`;
  }

  // Time-based
  if (seconds > 0 && startTime > 0) {
    const now = Number(game.time?.worldTime ?? 0);
    const elapsed = Math.max(0, now - startTime);
    const remaining = Math.max(0, seconds - elapsed);

    if (remaining <= 0) return "Expired";
    if (remaining < 60) return `${Math.ceil(remaining)}s remaining`;
    if (remaining < 3600) return `${Math.ceil(remaining / 60)}min remaining`;
    if (remaining < 86400) return `${Math.round(remaining / 3600 * 10) / 10}hr remaining`;
    return `${Math.round(remaining / 86400 * 10) / 10} days remaining`;
  }

  if (rounds > 0) return `${rounds} round${rounds !== 1 ? "s" : ""}`;
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

    for (const ch of (ef.changes ?? [])) {
      if (!ch?.key || seen.has(ch.key)) continue;
      seen.add(ch.key);
      const modeStr = _modeLabel(ch.mode);
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
  if (mode === 2 || mode === "ADD") return "+";
  if (mode === 5 || mode === "OVERRIDE") return "=";
  return "?";
}

function _humanizeKey(key) {
  // Strip common prefixes for readability
  return String(key || "")
    .replace(/^system\.modifiers\./, "")
    .replace(/^system\./, "")
    .replace(/\./g, " › ");
}
