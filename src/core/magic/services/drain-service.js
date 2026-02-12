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
 * Target: Foundry VTT v13.351
 */

import { _num, _str, createDebugLogger } from "../_primitives.js";

const _FLAG_NS = "uesrpg-3ev4";

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
export async function drainMagicka(targetActor, amount, opts = {}) {
  if (!targetActor) return null;
  amount = Math.max(0, Math.floor(_num(amount, 0)));
  if (amount <= 0) return null;

  const { requestUpdateDocument } = await import("../../../utils/authority-proxy.js");

  const currentMP = _num(targetActor.system?.magicka?.value, 0);
  const actualDrain = Math.min(amount, currentMP);
  const newMP = Math.max(0, currentMP - actualDrain);

  try {
    await requestUpdateDocument(targetActor, { "system.magicka.value": newMP });
    _debug("drainMagicka:", {
      target: targetActor.name,
      amount,
      actualDrain,
      oldMP: currentMP,
      newMP
    });
  } catch (err) {
    console.error("[UESRPG][DrainService] drainMagicka failed", err);
    return null;
  }

  // Transfer drained amount to caster if requested (Absorb Magicka)
  if (opts.transferToCaster && opts.caster && actualDrain > 0) {
    const casterMP = _num(opts.caster.system?.magicka?.value, 0);
    const casterMaxMP = _num(opts.caster.system?.magicka?.max, casterMP);
    const newCasterMP = Math.min(casterMaxMP, casterMP + actualDrain);
    try {
      await requestUpdateDocument(opts.caster, { "system.magicka.value": newCasterMP });
      _debug("drainMagicka: transferred to caster", {
        caster: opts.caster.name,
        transferred: actualDrain,
        newCasterMP
      });
    } catch (err) {
      console.warn("[UESRPG][DrainService] Transfer to caster failed", err);
    }
  }

  return { drained: actualDrain, remainingMP: newMP };
}

/**
 * Drain current health from a target actor.
 *
 * @param {Actor} targetActor  - The actor to drain
 * @param {number} amount      - Amount to drain
 * @param {object} [opts]      - Optional context
 * @param {Actor} [opts.caster]     - The caster
 * @param {Item}  [opts.spell]      - The spell
 * @param {boolean} [opts.transferToCaster] - If true, caster gains the drained amount as healing
 * @returns {Promise<{drained: number, remainingHP: number}|null>}
 */
export async function drainHealth(targetActor, amount, opts = {}) {
  if (!targetActor) return null;
  amount = Math.max(0, Math.floor(_num(amount, 0)));
  if (amount <= 0) return null;

  const { requestUpdateDocument } = await import("../../../utils/authority-proxy.js");

  const currentHP = _num(targetActor.system?.hp?.value, 0);
  const actualDrain = Math.min(amount, currentHP);
  const newHP = Math.max(0, currentHP - actualDrain);

  try {
    await requestUpdateDocument(targetActor, { "system.hp.value": newHP });
    _debug("drainHealth:", {
      target: targetActor.name,
      amount,
      actualDrain,
      oldHP: currentHP,
      newHP
    });
  } catch (err) {
    console.error("[UESRPG][DrainService] drainHealth failed", err);
    return null;
  }

  // Transfer to caster as healing
  if (opts.transferToCaster && opts.caster && actualDrain > 0) {
    const casterHP = _num(opts.caster.system?.hp?.value, 0);
    const casterMaxHP = _num(opts.caster.system?.hp?.max, casterHP);
    const newCasterHP = Math.min(casterMaxHP, casterHP + actualDrain);
    try {
      await requestUpdateDocument(opts.caster, { "system.hp.value": newCasterHP });
      _debug("drainHealth: healed caster", {
        caster: opts.caster.name,
        healed: actualDrain,
        newCasterHP
      });
    } catch (err) {
      console.warn("[UESRPG][DrainService] Healing transfer to caster failed", err);
    }
  }

  return { drained: actualDrain, remainingHP: newHP };
}

/**
 * Resolve drain amount from spell data.
 * For Drain spells, the SS/drain amount is stored in damageFormula or scaling.
 *
 * @param {Item} spell
 * @returns {Promise<number>}
 */
async function _resolveDrainAmount(spell) {
  const formula = _str(spell.system?.damageFormula || spell.system?.spell_str || spell.system?.damage);
  if (!formula) return 0;

  // Try as simple number first
  const simple = Number(formula);
  if (Number.isFinite(simple) && simple > 0) return Math.floor(simple);

  // Try as dice formula
  try {
    const roll = new Roll(formula);
    await roll.evaluate();
    return Math.max(0, Math.floor(roll.total));
  } catch (_e) {
    return 0;
  }
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
async function _stripMaxReducingEffects(targetActor, effects, drainType) {
  if (!Array.isArray(effects) || !effects.length) return;

  const keysToStrip = drainType === "magicka"
    ? ["system.modifiers.magicka.max", "system.magicka.max"]
    : ["system.modifiers.hp.max", "system.hp.max", "system.modifiers.health.max"];

  const idsToRemove = [];

  for (const ae of effects) {
    const live = targetActor.effects.get(ae.id ?? ae._id);
    if (!live) continue;

    const changes = live.changes ?? [];
    const hasMaxReduction = changes.some(c => keysToStrip.includes(c.key));
    if (hasMaxReduction) {
      idsToRemove.push(live.id);
    }
  }

  if (idsToRemove.length) {
    const { requestDeleteEmbeddedDocuments } = await import("../../../utils/authority-proxy.js");
    try {
      await requestDeleteEmbeddedDocuments(targetActor, "ActiveEffect", idsToRemove);
      _debug("Stripped max-reducing AEs for", drainType, "drain:", idsToRemove);
    } catch (err) {
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
async function _onEffectApplied(payload) {
  const { caster, target, spell, effects } = payload;
  if (!caster || !target || !spell) return;

  const drainConfig = spell.system?.engine?.drain;
  if (!drainConfig?.enabled) return;

  // Only GM processes drain (document mutation requires authority)
  if (!game.user.isGM) return;

  const drainType = _str(drainConfig.type).toLowerCase();
  if (!drainType || drainType === "none") return;

  // Only handle resource drains here; characteristic/skill drains use the AE pipeline
  if (drainType !== "magicka" && drainType !== "health") {
    _debug("Drain type", drainType, "handled by AE pipeline — skipping direct drain");
    return;
  }

  const drainAmount = await _resolveDrainAmount(spell);
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
  await _stripMaxReducingEffects(target, effects, drainType);

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
    } catch (_e) { /* non-blocking */ }
  }
}

/**
 * Handle `uesrpg.spell.spellHitTarget` — for drain spells without embedded AEs.
 *
 * @param {object} payload - { caster, target, spell, hitLocation, defenseType }
 * @returns {Promise<void>}
 */
async function _onSpellHitTarget(payload) {
  const { caster, target, spell } = payload;
  if (!caster || !target || !spell) return;

  const drainConfig = spell.system?.engine?.drain;
  if (!drainConfig?.enabled) return;

  // Only GM processes
  if (!game.user.isGM) return;

  const drainType = _str(drainConfig.type).toLowerCase();
  if (drainType !== "magicka" && drainType !== "health") return;

  // If the spell has enabled AEs, effectApplied will handle it
  const hasEnabledEffects = (spell.effects ?? []).some(e => !e.disabled);
  if (hasEnabledEffects) return;

  const drainAmount = await _resolveDrainAmount(spell);
  if (drainAmount <= 0) return;

  _debug("Drain (via spellHitTarget):", {
    spell: spell.name,
    target: target.name,
    drainType,
    drainAmount
  });

  const transferToCaster = Boolean(drainConfig.transferToCaster);
  let result = null;

  if (drainType === "magicka") {
    result = await drainMagicka(target, drainAmount, { caster, spell, transferToCaster });
  } else if (drainType === "health") {
    result = await drainHealth(target, drainAmount, { caster, spell, transferToCaster });
  }

  if (result) {
    const poolLabel = drainType === "magicka" ? "Magicka" : "Health";
    const transferText = transferToCaster
      ? ` <strong>${caster.name}</strong> absorbs ${result.drained} ${poolLabel}.`
      : "";

    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><h3>${spell.name}</h3>
          <p><strong>${target.name}</strong> loses <strong>${result.drained} ${poolLabel}</strong>
          (remaining: ${drainType === "magicka" ? result.remainingMP : result.remainingHP}).${transferText}</p></div>`,
        speaker: ChatMessage.getSpeaker({ actor: caster }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    } catch (_e) { /* non-blocking */ }
  }
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
