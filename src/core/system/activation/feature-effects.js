/**
 * @module system/activation/feature-effects
 * @description Transfers Active Effects from Talents, Traits, and Powers to targeted actors.
 *
 * Modelled after the spell pipeline in src/core/magic/effects/spell-effects.js
 * but intentionally simpler:
 *  - No upkeep, no OverTime, no opposing-effect removal.
 *  - Duration can be permanent (manual removal) or timed (from activation config).
 *  - Uses authority-proxy for permission-safe mutations.
 *  - No stacking: existing effects from the same item origin are replaced.
 */

import { getFeatureConfig } from "../../traits/features/feature-config.js";
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { createSeverityDebugLogger } from "../../../utils/debug.js";
import { SYSTEM_ID } from "../system-id.js";
import { getRoundTimeSecondsSafe } from "../time/round-time.js";
import { getEffectChanges } from "../../../utils/compat.js";

const _featureEffectsDebug = createSeverityDebugLogger("activationDebug", "", "debug");

/* ── Duration helpers ────────────────────────────────────────────────── */


/**
 * Compute duration from the item's activation config.
 * If no duration fields are present, returns null (permanent).
 *
 * @param {Item} item
 * @returns {{ rounds: number, seconds: number } | null}
 */
function computeFeatureEffectDuration(item) {
  const dur = item?.system?.activation?.duration ?? {};
  const value = Number(dur.value ?? 0);
  const unitRaw = String(dur.unit || "").toLowerCase().trim();
  if (!value || value <= 0 || !unitRaw || unitRaw === "permanent" || unitRaw === "none") return null;

  const unit = (unitRaw === "round") ? "rounds"
    : (unitRaw === "minute") ? "minutes"
    : (unitRaw === "hour") ? "hours"
    : (unitRaw === "day") ? "days"
    : unitRaw;

  const rt = getRoundTimeSecondsSafe();
  let rounds = 0;
  let seconds = 0;

  switch (unit) {
    case "rounds":  rounds = value; seconds = value * rt; break;
    case "minutes": rounds = value * 10; seconds = value * 60; break;
    case "hours":   rounds = value * 600; seconds = value * 3600; break;
    case "days":    rounds = value * 14400; seconds = value * 86400; break;
    default:        return null;
  }

  return { rounds, seconds };
}

/**
 * Build a Foundry ActiveEffect duration object.
 *
 * @param {"permanent"|"timed"} mode
 * @param {{ rounds: number, seconds: number } | null} computed
 * @returns {object}
 */
function _buildDuration(mode, computed) {
  const nowTime = Number(game?.time?.worldTime ?? 0) || 0;

  if (mode !== "timed" || !computed) {
    // Permanent — no automatic expiry
    return { startTime: nowTime, seconds: null, rounds: null, turns: 0, combat: null };
  }

  // Timed — choose combat vs time tracking
  const isCombat = Boolean(game?.combat?.started);
  if (isCombat) {
    return {
      combat: game.combat.id ?? null,
      startTime: nowTime,
      startRound: Number(game.combat.round ?? 0),
      startTurn: Number(game.combat.turn ?? 0),
      rounds: computed.rounds,
      seconds: computed.seconds,
      turns: 0,
    };
  }
  return {
    combat: null,
    startTime: nowTime,
    seconds: computed.seconds,
    rounds: 0,
    turns: 0,
  };
}

/* ── Public API ──────────────────────────────────────────────────────── */

/**
 * Determine whether an item can transfer its AEs to targets on activation.
 *
 * Returns true when:
 *  1. The item is a talent, trait, or power.
 *  2. The item has at least one non-disabled **activation** Active Effect
 *     (i.e. `transfer === false`).
 *
 * The `transfer` property on AEs is used to distinguish passive vs active effects:
 *  - `transfer: true`  → **Passive**: applies to the owning actor automatically
 *                         via Foundry's built-in transfer mechanism. NOT cloned
 *                         to targets on activation.
 *  - `transfer: false` → **Active (Activation)**: does NOT apply to the owning
 *                         actor. IS cloned to targeted actors when the feature
 *                         is activated.
 *
 * New AEs created on feature items default to `transfer: false` (activation mode).
 * Users can toggle `transfer: true` in the AE editor to make them passive.
 *
 * @param {Item} item - A talent, trait, or power Item document.
 * @returns {boolean}
 */
export function featureNeedsEffectTransfer(item) {
  if (!item) return false;
  const type = String(item.type ?? "").toLowerCase();
  if (type !== "talent" && type !== "trait" && type !== "power") return false;

  // Must have at least one non-disabled ACTIVATION AE (transfer !== true).
  // Passive AEs (transfer: true) are handled by Foundry's built-in transfer
  // and are NOT candidates for activation transfer to targets.
  const effects = Array.from(item.effects ?? []);
  return effects.some(e => !e.disabled && !e.transfer);
}

/**
 * Apply an item's Active Effects to one or more target actors.
 * Existing effects from the same item origin on each target are replaced
 * (no stacking).
 *
 * @param {Actor} activatorActor - The actor who activated the item.
 * @param {Item}  item           - The talent / trait / power being activated.
 * @param {Actor[]} targetActors - Resolved target actors to receive effects.
 * @param {object} [options]     - Additional options.
 * @param {object} [options.featureConfig] - Pre-resolved feature config (avoids re-read).
 * @returns {Promise<{ applied: number, targets: string[] }>}
 */
export async function applyFeatureEffectsToTargets(activatorActor, item, targetActors, options = {}) {

  const cfg = options.featureConfig ?? getFeatureConfig(item);
  const durationMode = cfg.effectDuration ?? "permanent";
  const computed = durationMode === "timed" ? computeFeatureEffectDuration(item) : null;
  const itemUuid = item.uuid;
  const itemType = String(item.type ?? "");

  // Collect the item's non-disabled ACTIVATION AEs (transfer !== true).
  // Passive AEs (transfer: true) are handled by Foundry's built-in transfer
  // to the owning actor and should NOT be cloned to targets.
  const sourceEffects = Array.from(item.effects ?? []).filter(e => !e.disabled && !e.transfer);
  if (!sourceEffects.length) {
    _featureEffectsDebug(`${SYSTEM_ID} | feature-effects: no enabled AEs on "${item.name}", skipping transfer`);
    return { applied: 0, targets: [] };
  }

  const appliedTargets = [];
  let totalCreated = 0;

  for (const targetActor of targetActors) {
    if (!targetActor) continue;

    // ── Remove existing effects from the same item origin (no stacking) ──
    const existing = targetActor.effects.filter(e => {
      if (e.origin !== itemUuid) return false;
      if (!e.flags?.[SYSTEM_ID]?.featureEffect) return false;
      return true;
    });
    if (existing.length) {
      const ids = existing.map(e => e.id);
      try {
        await requestDeleteEmbeddedDocuments(targetActor, "ActiveEffect", ids);
      } catch (err) {
        console.warn(`${SYSTEM_ID} | feature-effects: failed to remove existing effects on ${targetActor.name}`, err);
      }
    }

    // ── Build effect data array ──────────────────────────────────────────
    const toCreate = [];
    for (const ef of sourceEffects) {
      const effectKey = ef.name || ef.id || String(toCreate.length);
      const effectGroup = `feature.effect.${item.id || itemUuid}.${effectKey}`;

      const effectData = {
        name: ef.name || item.name,
        img: ef.img || item.img,
        origin: itemUuid,
        disabled: false,
        duration: _buildDuration(durationMode, computed),
        changes: foundry.utils.deepClone(getEffectChanges(ef)),
        flags: {
          [SYSTEM_ID]: {
            featureEffect: true,
            sourceItemUuid: itemUuid,
            sourceItemName: item.name,
            sourceItemType: itemType,
            activatorUuid: activatorActor.uuid,
            owner: "system",
            effectGroup,
            stackRule: "override",
            source: "feature",
          },
        },
      };
      toCreate.push(effectData);
    }

    if (!toCreate.length) continue;

    // ── Create on target (permission-safe) ───────────────────────────────
    try {
      const created = await requestCreateEmbeddedDocuments(targetActor, "ActiveEffect", toCreate);
      const count = Array.isArray(created) ? created.length : 0;
      totalCreated += count;
      if (count) appliedTargets.push(targetActor.name);

      _featureEffectsDebug(`${SYSTEM_ID} | feature-effects: applied ${count} AE(s) from "${item.name}" to ${targetActor.name}`);
    } catch (err) {
      console.error(`${SYSTEM_ID} | feature-effects: failed to create AEs on ${targetActor.name}`, err);
    }
  }

  return { applied: totalCreated, targets: appliedTargets };
}
