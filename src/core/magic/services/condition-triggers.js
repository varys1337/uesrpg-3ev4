/**
 * @module magic/services/condition-triggers
 *
 * src/core/magic/condition-triggers.js
 *
 * Condition-triggered automation for spell conditions.
 *
 * RAW:
 * - **Invisibility**: "remarkably fragile — almost any vigorous activity will break the spell."
 *   Breaks when the actor makes an attack (weapon or spell) or casts an attack spell.
 * - **Silence**: Per-round Perception test awareness is not automated (left to GM discretion),
 *   but the -20 casting TN penalty is enforced in `computeMagicCastingTN()`.
 *
 * Hook-based. GM-only mutations to ensure single authority writer.
 * Registers exactly once via `initializeConditionTriggers()`.
 *
 * Target: Foundry VTT v13.351
 */

import { requestUpdateDocument, requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { createDebugLogger } from "../_primitives.js";

const _debug = createDebugLogger("aeLifecycleDebug", "[UESRPG][ConditionTriggers]");

// ─── Invisibility Break ──────────────────────────────────────────────────────

/**
 * Break the Invisibility condition on an actor.
 *
 * Removes:
 * 1. The `system.traits.condition.invisible` flag (set to false)
 * 2. Any Active Effects that set the invisible condition flag
 * 3. Origin AEs for the Invisibility spell (which cascades linked AE teardown)
 *
 * Permission-safe: uses authority proxy. GM-only execution.
 *
 * @param {Actor} actor - The actor losing invisibility
 * @param {string} [reason="attack"] - Reason for breaking (for chat message)
 * @returns {Promise<boolean>} true if invisibility was broken
 */
export async function breakInvisibility(actor, reason = "attack") {
  if (!actor) return false;
  if (!game.user?.isGM) return false;

  const isInvisible = Boolean(
    actor.system?.traits?.condition?.invisible
  );

  if (!isInvisible) return false;

  _debug(`Breaking invisibility on ${actor.name}: reason=${reason}`);

  // 1. Clear the condition flag
  try {
    await requestUpdateDocument(actor, {
      "system.traits.condition.invisible": false
    });
  } catch (err) {
    console.error("UESRPG | condition-triggers | Failed to clear invisible flag", err);
  }

  // 2. Remove spell-based invisibility effects
  const invisEffects = (actor.effects ?? []).filter(ef => {
    if (ef.disabled) return false;
    // Check if this effect sets the invisible condition
    for (const c of (ef.changes ?? [])) {
      if (c.key === "system.traits.condition.invisible") return true;
    }
    // Also check spell-effect flagged as Invisibility
    const flags = ef.flags?.["uesrpg-3ev4"];
    if (flags?.spellEffect && flags?.spellName === "Invisibility") return true;
    return false;
  });

  if (invisEffects.length) {
    const idsToDelete = invisEffects.map(ef => ef.id);
    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", idsToDelete);
    } catch (err) {
      console.error("UESRPG | condition-triggers | Failed to remove invisible effects", err);
    }
  }

  // 3. Remove Origin AEs for Invisibility (cascades linked entities)
  const originAEs = (actor.effects ?? []).filter(ef => {
    const flags = ef.flags?.["uesrpg-3ev4"];
    return flags?.isOriginAE && flags?.spellName === "Invisibility";
  });

  if (originAEs.length) {
    const originIds = originAEs.map(ef => ef.id);
    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", originIds);
    } catch (err) {
      console.error("UESRPG | condition-triggers | Failed to remove Invisibility origin AEs", err);
    }
  }

  // 4. Post chat notification
  try {
    const reasonLabel = reason === "attack" ? "making an attack"
      : reason === "cast" ? "casting an attack spell"
      : reason === "interact" ? "an interaction"
      : reason;
    
    await ChatMessage.create({
      content: `<div class="uesrpg"><p><strong>${actor.name}</strong>'s Invisibility was broken by ${reasonLabel}.</p></div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  } catch (_e) { /* non-blocking */ }

  _debug(`Invisibility broken on ${actor.name}`);
  return true;
}

// ─── Hook Registration ───────────────────────────────────────────────────────

let _initialized = false;

/**
 * Initialize all condition trigger hooks. Call once from system.js ready hook.
 * GM-only: only the GM client registers the mutation hooks.
 */
export function initializeConditionTriggers() {
  if (_initialized) return;
  _initialized = true;

  // Only GM runs mutation hooks to avoid conflicting writes
  if (!game.user?.isGM) return;

  // ── Magic Attack Invisibility Break ──
  // Fires after any spell casting resolves. If the caster is invisible and the
  // spell was an attack spell, break invisibility.
  Hooks.on("uesrpg.spell.castResolved", async (payload) => {
    try {
      const caster = payload?.caster;
      if (!caster) return;
      if (!Boolean(caster.system?.traits?.condition?.invisible)) return;

      // Only break on attack spells
      const spell = payload?.spell;
      const isAttack = Boolean(spell?.system?.isAttackSpell);
      if (!isAttack) return;

      // Only break on successful casts (failed casts don't reveal position)
      if (!payload?.success) return;

      await breakInvisibility(caster, "cast");
    } catch (err) {
      console.error("UESRPG | condition-triggers | castResolved hook error", err);
    }
  });

  _debug("Condition triggers initialized (GM)");
}
