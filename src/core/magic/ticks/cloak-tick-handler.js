/**
 * @module magic/ticks/cloak-tick-handler
 *
 * src/core/magic/cloak-tick-handler.js
 *
 * Cloak-type spell tick handler for UESRPG 3ev4.
 * Registers with the spell tick engine to apply AoE tick damage/effects
 * to tokens within range of the caster at the end of their turn.
 *
 * Design:
 *  - Fires on `turnEnd` for the caster whose turn just ended
 *  - Finds all tokens within `cloak.range` meters of the caster's token
 *  - Applies spell damage and/or effects to each eligible target
 *  - Skips the caster if `excludeSelf` is true (default)
 *  - GM-only execution for consistency
 *
 * Integration:
 *  - Uses `registerSpellTickHandler` for tick lifecycle management
 *  - Uses `getOriginAEs` to find active cloak spells on the current actor
 *  - Uses `rollSpellDamage` from magicka-utils for damage computation
 *  - Uses authority proxy for all mutations
 *
 * Target: Foundry VTT v13.351
 */

import { registerSpellTickHandler } from "./spell-tick-engine.js";
import { getOriginAEs } from "../effects/origin-effect.js";
import { normalizeSpellConfig } from "../spell-config.js";
import { rollSpellDamage, getSpellDamageType, getSpellDamageFormula } from "../magicka-utils.js";
import { _num, _strTrim as _str, createDebugLogger } from "../_primitives.js";
import { FLAG_SCOPE, SYSTEM_ID } from "../../system/namespace.js";

const _debug = createDebugLogger("spellTickDebug", "[UESRPG][CloakTick]");

let _registered = false;
let _cloakRegistryHooksInstalled = false;

// ─── Cloak Actor Registry (Milestone D) ──────────────────────────────────────
//
// Tracks actors that have at least one Origin AE so the cloak tick handler
// can skip actors that are definitely not cloak casters without calling
// getOriginAEs() (which iterates all actor effects).
//
// Enabled by `useCloakRegistry` world setting (default: false).
//
// We track Origin AE presence (not cloak-specific) because checking whether
// an Origin AE is a cloak spell requires async spell UUID resolution, which is
// not viable in a synchronous predicate. Actors with Origin AEs are already a
// small set; the inner cloak check in _processCloakOriginAE filters further.

/** @type {Set<string>} actorIds with at least one Origin AE */
const _cloakActorSet = new Set();

function _isCloakRegistryEnabled() {
  try {
    return Boolean(game?.settings?.get?.(SYSTEM_ID, "useCloakRegistry"));
  } catch (_e) {
    return false;
  }
}

function _isOriginAE(effect) {
  return Boolean(effect?.flags?.[FLAG_SCOPE]?.isOriginAE);
}

function _rebuildCloakActorSet() {
  _cloakActorSet.clear();
  for (const actor of (game?.actors?.contents ?? [])) {
    for (const ae of (actor?.effects?.contents ?? [])) {
      if (_isOriginAE(ae)) {
        _cloakActorSet.add(String(actor.id));
        break;
      }
    }
  }
}

/**
 * Returns true if the given actorId is a known cloak caster candidate.
 * When registry is disabled, always returns true (conservatively).
 * @param {string|null|undefined} actorId
 * @returns {boolean}
 */
function _hasCloakCaster(actorId) {
  if (!_isCloakRegistryEnabled()) return true;
  if (!actorId) return false;
  return _cloakActorSet.has(String(actorId));
}

/**
 * Seed the cloak actor set and install AE lifecycle hooks for incremental maintenance.
 * Idempotent — safe to call multiple times.
 */
export function seedCloakRegistry() {
  _rebuildCloakActorSet();

  if (_cloakRegistryHooksInstalled) return;
  _cloakRegistryHooksInstalled = true;

  Hooks.on("createActiveEffect", (effect, _options, _userId) => {
    const actor = effect.parent;
    if (!actor || actor.documentName !== "Actor") return;
    if (_isOriginAE(effect)) _cloakActorSet.add(String(actor.id));
  });

  Hooks.on("deleteActiveEffect", (effect, _options, _userId) => {
    const actor = effect.parent;
    if (!actor || actor.documentName !== "Actor") return;
    // Remove actor from set only if they have no remaining Origin AEs after this deletion.
    // The effect is still present in actor.effects during this hook (Foundry fires before removal),
    // so we check all effects excluding the deleted one.
    const deletedId = String(effect.id ?? "");
    const hasRemaining = (actor?.effects?.contents ?? []).some(ae => ae.id !== deletedId && _isOriginAE(ae));
    if (!hasRemaining) _cloakActorSet.delete(String(actor.id));
  });
}

/**
 * Initialize the cloak tick handler.
 * Registers a spell tick handler that fires on turnEnd.
 * Must be called once during system initialization (after initializeSpellTickEngine).
 */
export function initializeCloakTickHandler() {
  if (_registered) return;
  _registered = true;

  registerSpellTickHandler({
    id: "cloak-aura",
    label: "Cloak Aura Tick",
    // hasWork: skip actors that have no Origin AEs (not potential cloak casters).
    hasWork: (ctx) => ctx.trigger === "turnEnd" && _hasCloakCaster(ctx.actor?.id),
    fn: _onTick
  });

  _debug("Cloak tick handler registered");
}

/**
 * Tick handler function.
 * @param {SpellTickContext} ctx
 */
async function _onTick(ctx) {
  // Only fire at end of turn (caster's turn just ended)
  if (ctx.trigger !== "turnEnd") return;

  // GM-only execution
  if (!game.user?.isGM) return;

  const casterActor = ctx.actor;
  if (!casterActor) return;

  // Find all Origin AEs on this actor that have cloak enabled
  const originAEs = getOriginAEs(casterActor);
  if (!originAEs.length) return;

  for (const originAE of originAEs) {
    try {
      await _processCloakOriginAE(casterActor, originAE, ctx);
    } catch (err) {
      console.error("UESRPG | CloakTick | Error processing origin AE", originAE?.name, err);
    }
  }
}

/**
 * Process a single origin AE to check if it has cloak enabled
 * and apply effects to nearby tokens.
 * @private
 */
async function _processCloakOriginAE(casterActor, originAE, ctx) {
  const flags = originAE?.flags?.["uesrpg-3ev4"];
  if (!flags?.isOriginAE) return;

  // Resolve the spell from the origin AE
  const spellUuid = _str(flags.spellUuid);
  if (!spellUuid) return;

  let spell;
  try {
    spell = await fromUuid(spellUuid);
  } catch (_e) {
    return;
  }
  if (!spell) return;

  // Check if this spell has cloak mode enabled
  const config = normalizeSpellConfig(spell);
  if (!config.cloak?.enabled) return;

  const cloakConfig = config.cloak;
  const range = _num(cloakConfig.range, 1);
  const excludeSelf = cloakConfig.excludeSelf !== false;
  const useSpellDamage = cloakConfig.useSpellDamage !== false;

  _debug("Processing cloak tick:", spell.name, {
    range,
    excludeSelf,
    useSpellDamage,
    caster: casterActor.name
  });

  // Find the caster's token on the active scene
  const casterToken = _getTokenForActor(casterActor);
  if (!casterToken) {
    _debug("No caster token found on active scene for", casterActor.name);
    return;
  }

  // Find all tokens within range
  const nearbyTokens = _getTokensInRange(casterToken, range, excludeSelf);
  if (!nearbyTokens.length) {
    _debug("No targets within", range, "m of", casterActor.name);
    return;
  }

  _debug("Found", nearbyTokens.length, "targets within range:", nearbyTokens.map(t => t.name));

  // Apply effects to each target
  for (const targetToken of nearbyTokens) {
    const targetActor = targetToken.actor ?? targetToken.document?.actor ?? null;
    if (!targetActor) continue;

    try {
      await _applyCloakToTarget(casterActor, targetActor, spell, config, ctx);
    } catch (err) {
      console.warn("UESRPG | CloakTick | Failed to apply cloak to", targetActor.name, err);
    }
  }
}

/**
 * Apply cloak damage/effects to a single target.
 * @private
 */
async function _applyCloakToTarget(casterActor, targetActor, spell, config, ctx) {
  const spellName = _str(spell.name) || "Cloak Spell";
  const damageFormula = getSpellDamageFormula(spell);
  const damageType = getSpellDamageType(spell);
  const isDamaging = Boolean(damageFormula && damageFormula !== "0" && damageType !== "none");
  const useSpellDamage = config.cloak.useSpellDamage !== false;

  _debug("Applying cloak to", targetActor.name, { isDamaging, useSpellDamage, damageFormula, damageType });

  // Apply damage if configured and the spell has a damage formula
  if (useSpellDamage && isDamaging) {
    try {
      const { applyMagicDamage } = await import("../damage-application.js");
      const damageResult = await rollSpellDamage(spell, {});
      const damageValue = _num(damageResult?.total, 0);

      if (damageValue > 0) {
        await applyMagicDamage(targetActor, damageValue, damageType, spell, {
          hitLocation: "Body",
          rollHTML: damageResult?.rollHTML ?? "",
          source: `${spellName} (Cloak)`,
          casterActor,
          isCritical: false
        });

        // Post damage to chat
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: casterActor }),
          content: `<div class="uesrpg-cloak-tick"><strong>${spellName}</strong> (Cloak) deals <strong>${damageValue}</strong> ${damageType} damage to <strong>${targetActor.name}</strong>.</div>`,
          flags: { "uesrpg-3ev4": { cloakTick: true } },
          style: CONST.CHAT_MESSAGE_STYLES.OTHER
        });
      }
    } catch (err) {
      console.warn("UESRPG | CloakTick | Damage application failed for", targetActor.name, err);
    }
  }

  // NOTE: Cloak ticks intentionally do NOT transfer spell AEs to targets.
  // Transferring OverTime / persistent AEs would cause effects to persist after
  // targets leave the cloak range. Damage is applied per-tick only while in range.
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Canvas Helpers
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Find a token for the given actor on the active scene.
 * @param {Actor} actor
 * @returns {Token|null}
 */
function _getTokenForActor(actor) {
  if (!actor) return null;
  try {
    const tokens = actor.getActiveTokens?.(true, true) ?? actor.getActiveTokens?.() ?? [];
    const scene = canvas?.scene;
    for (const t of tokens) {
      const doc = t?.document ?? t;
      if (scene && doc?.scene?.id && doc.scene.id !== scene.id) continue;
      if (scene && doc?.parent?.id && doc.parent.id !== scene.id) continue;
      return t?.object ?? t;
    }
    return tokens[0]?.object ?? tokens[0] ?? null;
  } catch (_e) {
    return null;
  }
}

/**
 * Get all tokens within `rangeMeters` of the source token.
 *
 * @param {Token} sourceToken - Center token
 * @param {number} rangeMeters - Range in meters (scene distance units)
 * @param {boolean} excludeSelf - Exclude the source token's actor
 * @returns {Token[]} Array of tokens within range
 */
function _getTokensInRange(sourceToken, rangeMeters, excludeSelf) {
  if (!sourceToken || !canvas?.tokens?.placeables) return [];

  const sourceActor = sourceToken.actor ?? sourceToken.document?.actor ?? null;
  const results = [];

  for (const token of canvas.tokens.placeables) {
    // Skip hidden tokens
    if (token.document?.hidden) continue;

    // Skip self if configured
    if (excludeSelf && sourceActor) {
      const tActor = token.actor ?? token.document?.actor ?? null;
      if (tActor?.id === sourceActor.id) continue;
    }

    // Measure distance
    const dist = _measureDistanceMeters(sourceToken, token);
    if (dist <= rangeMeters) {
      results.push(token);
    }
  }

  return results;
}

/**
 * Measure the grid-space distance between two tokens in meters.
 * Uses Foundry v13's `measurePath` API with fallback.
 *
 * @param {Token} aToken
 * @param {Token} bToken
 * @returns {number} Distance in scene units (meters).
 */
function _measureDistanceMeters(aToken, bToken) {
  try {
    const a = aToken?.center ?? aToken?.object?.center ?? null;
    const b = bToken?.center ?? bToken?.object?.center ?? null;
    if (!a || !b) return Number.POSITIVE_INFINITY;

    if (!canvas?.grid || !canvas?.scene) return Number.POSITIVE_INFINITY;

    // Use v13 measurePath API with fallback to deprecated measureDistances
    if (typeof canvas.grid.measurePath === "function") {
      const path = canvas.grid.measurePath([a, b], { gridSpaces: true });
      const d = path?.distance ?? (Array.isArray(path) && path.length > 0 ? path[0] : null);
      if (Number.isFinite(d)) return d;
    } else {
      const distances = canvas.grid.measureDistances([a, b], { gridSpaces: true });
      const d = Array.isArray(distances) ? distances[0] : null;
      if (Number.isFinite(d)) return d;
    }

    // Fallback: pixel distance approximation
    const pixels = Math.hypot(b.x - a.x, b.y - a.y);
    const gridSize = _num(canvas.grid.size, 0);
    const gridDistance = _num(canvas.scene.grid?.distance, 0);
    if (gridSize > 0 && gridDistance > 0) return (pixels / gridSize) * gridDistance;

    return Number.POSITIVE_INFINITY;
  } catch (_e) {
    return Number.POSITIVE_INFINITY;
  }
}
