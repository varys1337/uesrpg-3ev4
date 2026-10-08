/**
 * @module magic/services/drain-service
 *
 * src/core/magic/drain-service.js
 *
 * Runtime automation for Drain Magicka / Drain Health spells.
 *
 * RAW Behavior:
 *   - Drain Magicka: reduces the target's CURRENT magicka by the resolved
 *     drain amount. Does NOT reduce maximum magicka. No ActiveEffect needed.
 *   - Drain Health: reduces the target's CURRENT health pool. No ActiveEffect needed.
 *   - Drain Characteristic / Drain Skill: KEEPS existing ActiveEffect-based
 *     tracking (handled by paired-ae.js and the standard spell-effects pipeline).
 *
 * Implementation:
 *   1. Hook `uesrpg.spell.effectApplied` for spells with `engine.drain.enabled`.
 *   2. For resource drains (magicka, health), apply a direct current-value
 *      update and strip any max-reducing AEs that were incorrectly created.
 *   3. For characteristic/skill drains, do nothing — existing AE pipeline handles them.
 *
 * Target: Foundry VTT v14.368+
 */

import { adjustCurrentResource } from "../../system/resource-updates.js";
import { _num, _str, createDebugLogger } from "../_primitives.js";
import { getEffectChanges } from "../../../utils/compat.js";
import { resolveMagicCastContext } from "../opposed/cast-context.js";


const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][DrainService]");

/* ═══════════════════════════════════════════════════════════════════════════
 *  Core Drain Logic
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Drain current magicka from a target actor.
 *
 * @param {Actor} targetActor  - The actor to drain
 * @param {number} amount      - Amount to drain
 * @param {object} [opts]      - Optional context
 * @param {Actor} [opts.caster]     - The caster (for chat / absorb transfer)
 * @param {Item}  [opts.spell]      - The spell
 * @param {boolean} [opts.transferToCaster] - If true, caster gains the drained amount
 * @returns {Promise<{drained: number, remainingMP: number}|null>}
 */
async function drainResource(targetActor, amount, resource, opts) {
  amount = Math.max(0, Math.floor(_num(amount, 0)));
  if (!targetActor || amount <= 0) return null;
  const change = await adjustCurrentResource(targetActor, resource, -amount);
  if (!change) return null;
  const drained = Math.max(0, -change.delta);
  let status = 'applied';
  if (opts.transferToCaster && opts.caster && drained > 0) {
    if (!await adjustCurrentResource(opts.caster, resource, drained)) status = 'partial';
  }
  return { drained, remaining: change.value, execution: { status, committed: true } };
}

export async function drainMagicka(targetActor, amount, opts = {}) {
  const result = await drainResource(targetActor, amount, 'magicka', opts);
  return result ? { ...result, remainingMP: result.remaining } : null;
}

export async function drainHealth(targetActor, amount, opts = {}) {
  const result = await drainResource(targetActor, amount, 'hp', opts);
  return result ? { ...result, remainingHP: result.remaining } : null;
}

/**
 * Resolve drain amount from spell data.
 * Drain spells use Spell Strength as their resolved drain amount.
 *
 * @param {Item} spell
 * @param {Actor|null} [caster]
 * @returns {Promise<number>}
 */
async function _resolveDrainAmount(spell, caster = null, payload = {}) {
  const context = await resolveMagicCastContext({ castContext: payload.castContext }, spell, {
    actor: caster, message: payload.message, parentMessageId: payload.parentMessageId,
  });
  return Math.max(0, Math.floor(context.spellStrengthValue));
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Hook Handlers
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Remove any max-reducing AEs that were incorrectly created by the standard
 * spell-effects pipeline for resource drain spells.
 *
 * @param {Actor} targetActor
 * @param {ActiveEffect[]} effects - The AEs just created on the target
 * @param {string} drainType - "magicka" or "health"
 * @returns {Promise<void>}
 */
async function _stripMaxReducingEffects(targetActor, effects, drainType, { strict = false } = {}) {
  if (!Array.isArray(effects) || !effects.length) return;

  const keysToStrip = drainType === "magicka"
    ? ["system.modifiers.magicka.max", "system.magicka.max"]
    : ["system.modifiers.hp.max", "system.hp.max", "system.modifiers.health.max"];

  const idsToRemove = [];

  for (const ae of effects) {
    const live = targetActor.effects.get(ae.id ?? ae._id);
    if (!live) continue;

    const changes = getEffectChanges(live);
    const hasMaxReduction = changes.some(c => keysToStrip.includes(c.key));
    if (hasMaxReduction) {
      idsToRemove.push(live.id);
    }
  }

  if (idsToRemove.length) {
    const { requestDeleteEmbeddedDocuments } = await import("../../../utils/authority-proxy.js");
    try {
      if (!await requestDeleteEmbeddedDocuments(targetActor, "ActiveEffect", idsToRemove)) throw new Error("Drain effect cleanup was not confirmed.");
      _debug("Stripped max-reducing AEs for", drainType, "drain:", idsToRemove);
    } catch (err) {
      if (strict) throw err;
      console.warn("[UESRPG][DrainService] Failed to strip max-reducing AEs", err);
    }
  }
}

/**
 * Handle `uesrpg.spell.effectApplied` — if the spell has engine.drain config,
 * apply the direct resource drain and remove any incorrectly created max-reducing AEs.
 *
 * @param {object} payload - { caster, target, spell, effects, originEffect }
 * @returns {Promise<void>}
 */
export async function applyDrainConsequences(payload, { strict = false, hit = false } = {}) {
  const { caster, target, spell, effects } = payload;
  if (!caster || !target || !spell) return;

  const drainConfig = spell.system?.engine?.drain;
  if (!drainConfig?.enabled) return;

  // Only GM processes drain (document mutation requires authority)
  if (!game.user.isGM) {
    if (strict) throw new Error("GM authority is required for drain consequences.");
    return;
  }

  const drainType = _str(drainConfig.type).toLowerCase();
  if (!drainType || drainType === "none") return;

  // Only handle resource drains here; characteristic/skill drains use the AE pipeline
  if (drainType !== "magicka" && drainType !== "health") {
    _debug("Drain type", drainType, "handled by AE pipeline — skipping direct drain");
    return;
  }

  if (hit && ((spell.effects ?? []).some(effect => !effect.disabled) || payload.effectsApplied)) return;
  const drainAmount = await _resolveDrainAmount(spell, caster, payload);
  if (drainAmount <= 0) {
    _debug("Drain amount is 0 — skipping");
    return;
  }

  _debug("Drain triggered:", {
    spell: spell.name,
    target: target.name,
    drainType,
    drainAmount
  });

  // Strip any max-reducing AEs (the standard pipeline may have created them)
  await _stripMaxReducingEffects(target, effects, drainType, { strict });

  // Apply direct current-value drain
  let result = null;
  const transferToCaster = Boolean(drainConfig.transferToCaster);

  if (drainType === "magicka") {
    result = await drainMagicka(target, drainAmount, {
      caster,
      spell,
      transferToCaster
    });
  } else if (drainType === "health") {
    result = await drainHealth(target, drainAmount, {
      caster,
      spell,
      transferToCaster
    });
  }

  if (strict && (!result || result.execution?.status === "partial")) throw new Error("Resource drain was not fully confirmed.");
  // Chat notification
  if (result) {
    const poolLabel = drainType === "magicka" ? "Magicka" : "Health";
    const drainedText = `${result.drained} ${poolLabel}`;
    const transferText = transferToCaster
      ? ` <strong>${caster.name}</strong> absorbs ${result.drained} ${poolLabel}.`
      : "";

    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>${spell.name}</h3>
          <p><strong>${target.name}</strong> loses <strong>${drainedText}</strong>
          (remaining: ${drainType === "magicka" ? result.remainingMP : result.remainingHP}).${transferText}</p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: caster }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    } catch (_e) { if (strict) throw _e; }
  }
}

/**
 * Handle `uesrpg.spell.spellHitTarget` — for drain spells without embedded AEs.
 *
 * @param {object} payload - { caster, target, spell, hitLocation, defenseType }
 * @returns {Promise<void>}
 */
function _onEffectApplied(payload) {
  if (payload?.handledDomains?.includes("drain")) return;
  void applyDrainConsequences(payload).catch(error => console.error("UESRPG | Drain consequence failed", error));
}

function _onSpellHitTarget(payload) {
  if (payload?.handledDomains?.includes("drain")) return;
  void applyDrainConsequences(payload, { hit: true }).catch(error => console.error("UESRPG | Drain hit failed", error));
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Initialization
 * ═══════════════════════════════════════════════════════════════════════════ */

let _initialized = false;

/**
 * Register the drain service hook listeners. Call once during system ready.
 * Idempotent — safe to call multiple times.
 */
export function initializeDrainService() {
  if (_initialized) return;
  _initialized = true;

  Hooks.on("uesrpg.spell.effectApplied", _onEffectApplied);
  Hooks.on("uesrpg.spell.spellHitTarget", _onSpellHitTarget);

  _debug("Drain service hooks registered");
}
