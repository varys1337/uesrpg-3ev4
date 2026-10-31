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
import { buildGenericAEData } from "../../active-effects/modifier-evaluator.js";
import { buildEffectDuration } from "../../time/effect-duration.js";
import { isFiniteDuration } from "../../active-effects/effect-duration-v14.js";
import { createChatOutcome } from "../../config/outcome-application-policy.js";
import { persistChatOutcomes } from "../../../application/combat/chat-outcome-application-service.js";
import { resolveActorFromUuidSync } from "../../../utils/uuid-cache.js";
import { createOrUpdateStatusEffect } from "../../active-effects/status-effect.js";
import { escapeHtml } from "../../../utils/html.js";
import { restoreOutcomeItem } from "../../../utils/item-outcome-snapshot.js";
import { getFlagValueWithFallback } from "../flags.js";
import { isActorCombatStepCurrent } from "../../combat/combat-scope.js";

export async function queueStatusEffect(actor, effect, { sourceActor = actor, message = null, afterWoundSuppression = false, onOutcome = null, instructions = null, durationAtApplication = null, requiredCombatStep = null } = {}) {
  const entry = createChatOutcome({ adapter: "ability.status", kind: "effect",
    sourceActorUuid: sourceActor.uuid, targetUuid: actor.uuid, label: effect.name,
    payload: { effect, afterWoundSuppression, durationAtApplication, ...(requiredCombatStep ? { requiredCombatStep } : {}) } });
  const saved = await persistChatOutcomes({ actor: sourceActor, message, entries: [entry],
    content: `<div class="uesrpg"><b>${escapeHtml(effect.name)}</b>${instructions ? `<p>${escapeHtml(instructions)}</p>` : ""}</div>` });
  onOutcome?.(saved);
  return saved;
}

export async function executeChatOutcome(outcome, context) {
  if (outcome.adapter === "ability.status") {
    if (getFlagValueWithFallback({ flags: outcome.payload.effect?.flags }, "key") === "talent:inspireHeroism") {
      throw Object.assign(new Error("This older Inspired outcome has an unsafe duration. Ask the GM to review it and any prior use, then track the next combat test bonus manually; do not repeat the activation."), { committed: false });
    }
    const needsCombatAuthority = outcome.payload.durationAtApplication === "oneRound"
      && outcome.payload.effect?.flags?.[SYSTEM_ID]?.key === "voidChanneler"
      && Boolean(game.combat?.started && game.combat?.combatant);
    return context.stage("statusEffect", async () => {
      const definition = outcome.payload.effect;
      if (!definition || typeof definition !== "object") throw Object.assign(new Error("The activation effect definition is unavailable."), { committed: false });
      if (getFlagValueWithFallback({ flags: definition.flags }, "key") === "hardTarget"
        && (!outcome.payload.requiredCombatStep || !isActorCombatStepCurrent(context.actor, outcome.payload.requiredCombatStep))) {
        throw Object.assign(new Error("The Hard Target combat step changed or was not recorded. Ask the GM to resolve the remaining benefit manually; review any cost already paid."), { committed: false });
      }
      const timedRound = outcome.payload.durationAtApplication === "oneRound";
      const activeCombat = Boolean(game.combat?.started && game.combat?.combatant);
      const managedRound = timedRound && activeCombat && definition.flags?.[SYSTEM_ID]?.key === "voidChanneler";
      if (managedRound && !game.user?.isGM) throw Object.assign(new Error("An active GM is required for combat-based Void Channeler expiry."), { committed: false });
      const start = timedRound ? CONFIG.ActiveEffect.documentClass.getEffectStart(activeCombat ? game.combat : null) : null;
      if (managedRound && (!start?.combat || !start.combatant || start.round == null || !Number.isFinite(Number(start.round)))) {
        throw Object.assign(new Error("The active combat step could not be recorded for Void Channeler."), { committed: false });
      }
      const effect = await createOrUpdateStatusEffect(context.actor, timedRound ? {
        ...definition,
        // The initiative step is tracked by identity, even if the target is not
        // in the tracker or the combat order is subsequently rearranged.
        duration: managedRound ? { value: null, units: "rounds", expiry: null }
          : buildEffectDuration({ actor: context.actor, rounds: 1,
            seconds: activeCombat ? null : getRoundTimeSecondsSafe(), preferCombat: activeCombat }),
        flags: { ...definition.flags, [SYSTEM_ID]: { ...definition.flags?.[SYSTEM_ID],
          voidChannelerAnchor: managedRound ? { combatId: start.combat, combatantId: start.combatant, round: start.round } : null } },
        refreshStart: true,
        start,
      } : definition);
      if (!effect) throw new Error("The activation effect was not saved.");
      if (outcome.payload.afterWoundSuppression) {
        const { ensureWoundedPassiveEffect } = await import("../../wounds/engine/apply.js");
        await ensureWoundedPassiveEffect(context.actor);
      }
      return { ok: true, effectsApplied: true };
    }, { requiresGM: needsCombatAuthority });
  }
  const actor = resolveActorFromUuidSync(outcome.sourceActorUuid);
  if (!actor || !outcome.payload.itemSnapshot) throw Object.assign(new Error("The activation source is unavailable."), { committed: false });
  const item = restoreOutcomeItem(outcome.payload.itemSnapshot, outcome.payload.itemSnapshotContext);
  return context.stage("activationEffects", async () => {
    const result = await applyFeatureEffectsToTargets(actor, item, [context.actor], {
      featureConfig: outcome.payload.featureConfig,
    });
    if (result.failed.length) throw Object.assign(new Error(`Activation effects were not fully applied: ${result.failed.join(", ")}.`), {
      committed: result.applied > 0 || result.removed > 0, uncertain: true,
    });
    return { ...result, ok: true, effectsApplied: result.applied > 0 };
  });
}

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
  if (!Number.isFinite(value) || value <= 0 || !unitRaw || unitRaw === "permanent" || unitRaw === "none") return null;

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
    case "minutes": seconds = value * 60; rounds = seconds / rt; break;
    case "hours":   seconds = value * 3600; rounds = seconds / rt; break;
    case "days":    seconds = value * 86400; rounds = seconds / rt; break;
    default:        return null;
  }

  return { rounds, seconds };
}

function hasFiniteSourceDuration(effect) {
  const duration = effect?.duration;
  const units = new Set(["seconds", "minutes", "hours", "days", "months", "years", "rounds", "turns"]);
  return units.has(duration?.units) && isFiniteDuration(duration);
}

/**
 * Build a Foundry ActiveEffect duration object.
 *
 * @param {"permanent"|"timed"} mode
 * @param {{ rounds: number, seconds: number } | null} computed
 * @returns {object}
 */
function _buildDuration(mode, computed, actor, sourceEffect) {
  if (mode !== "timed") {
    // Permanent — no automatic expiry
    return buildEffectDuration({ actor });
  }

  if (!computed) {
    const duration = sourceEffect?.duration;
    if (!hasFiniteSourceDuration(sourceEffect)) return null;
    return { value: Number(duration.value), units: duration.units, expiry: duration.expiry ?? null };
  }

  // Timed — choose combat vs time tracking
  const isCombat = Boolean(game?.combat?.started);
  if (isCombat) {
    return buildEffectDuration({ actor, rounds: computed.rounds, seconds: computed.seconds, preferCombat: true });
  }
  return buildEffectDuration({ actor, seconds: computed.seconds, preferCombat: false });
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

/** Fail before spending activation costs if a timed effect has no duration. */
export function validateFeatureEffectConfiguration(item, featureConfig = null) {
  const cfg = featureConfig ?? getFeatureConfig(item);
  if (cfg.effectDuration !== "timed" || computeFeatureEffectDuration(item)) return { ok: true };
  const missing = Array.from(item?.effects ?? [])
    .filter(effect => !effect.disabled && !effect.transfer && !hasFiniteSourceDuration(effect));
  if (!missing.length) return { ok: true };
  return { ok: false, reason: `${item.name}: set a positive duration on each activation effect before using timed transfer (${missing.map(effect => effect.name || effect.id).join(", ")}).` };
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
 * @returns {Promise<{ applied: number, targets: string[], failed: string[] }>}
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
    return { applied: 0, targets: [], failed: [] };
  }
  const validation = validateFeatureEffectConfiguration(item, cfg);
  if (!validation.ok) return { applied: 0, removed: 0, targets: [], failed: [validation.reason] };

  const appliedTargets = [];
  const failed = [];
  let totalCreated = 0;
  let removed = 0;

  for (const targetActor of targetActors) {
    if (!targetActor) continue;

    // Replace only after the incoming effects are all confirmed.
    const existing = targetActor.effects.filter(e => {
      if (e.origin !== itemUuid) return false;
      if (!e.flags?.[SYSTEM_ID]?.featureEffect) return false;
      return true;
    });

    // ── Build effect data array ──────────────────────────────────────────
    const toCreate = [];
    for (const ef of sourceEffects) {
      const effectKey = ef.name || ef.id || String(toCreate.length);
      const effectGroup = `feature.effect.${item.id || itemUuid}.${effectKey}`;

      const effectData = buildGenericAEData({
        source: "feature",
        stack: {
          policy: "replace",
          group: effectGroup,
          max: null,
          strengthKey: null,
        },
        name: ef.name || item.name,
        img: ef.img || item.img,
        origin: itemUuid,
        disabled: false,
        duration: _buildDuration(durationMode, computed, targetActor, ef),
        flags: {
          [SYSTEM_ID]: {
            featureEffect: true,
            sourceItemUuid: itemUuid,
            sourceItemName: item.name,
            sourceItemType: itemType,
            activatorUuid: activatorActor.uuid,
            owner: "system",
            source: "feature",
          },
        },
        changes: foundry.utils.deepClone(getEffectChanges(ef)),
      });
      toCreate.push(effectData);
    }

    if (!toCreate.length) continue;

    // ── Create on target (permission-safe) ───────────────────────────────
    try {
      const created = await requestCreateEmbeddedDocuments(targetActor, "ActiveEffect", toCreate);
      const count = Array.isArray(created) ? created.length : 0;
      totalCreated += count;
      if (count) appliedTargets.push(targetActor.name);
      if (count !== toCreate.length) {
        failed.push(targetActor.name);
        continue;
      }
      if (existing.length) {
        if (!await requestDeleteEmbeddedDocuments(targetActor, "ActiveEffect", existing.map(effect => effect.id), { requireDeleted: true })) {
          failed.push(targetActor.name);
          continue;
        }
        removed += existing.length;
      }

      _featureEffectsDebug(`${SYSTEM_ID} | feature-effects: applied ${count} AE(s) from "${item.name}" to ${targetActor.name}`);
    } catch (err) {
      console.error(`${SYSTEM_ID} | feature-effects: failed to create AEs on ${targetActor.name}`, err);
      failed.push(targetActor.name);
    }
  }

  return { applied: totalCreated, removed, targets: appliedTargets, failed };
}
