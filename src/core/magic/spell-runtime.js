/**
 * @module spell-runtime
 * src/core/magic/spell-runtime.js
 *
 * Consolidated spell runtime services: hooks, routing, reflect, zone management.
 *
 * Merges:
 *  - spell-hooks.js        → emitPreCast, emitCastResolved, emitEffectApplied
 *  - prior routing helper  → classifySpellForRouting, getUserSpellTargets, shouldUseTargetedSpellWorkflow, shouldUseModernSpellWorkflow, debugMagicRoutingLog
 *  - spell-reflect.js      → getSpellReflectThreshold, trySpellReflect
 *  - spell-zone-service.js → linkAreaToOriginAE, getTokensInArea, getActiveSpellZones
 *
 * None of these modules carry side-effect initialization; they are pure utility/service exports.
 *
 * Target: Foundry VTT v14.359+
 */

import { evaluateAEModifierKeys } from "../active-effects/modifier-evaluator.js";
import { registerLinkedEntity, getOriginAEs } from "./effects/origin-effect.js";
import { _str, createDebugLogger, isDebugEnabled } from "./_primitives.js";
import { _bool } from "../../utils/coerce.js";
import { FLAG_SCOPE, SYSTEM_ID } from "../system/namespace.js";
import { createUuidResolver, resolveUuidSync } from "../../utils/uuid-cache.js";
import { getLinkedAreaEntities, getLinkedAreaUuids, getLinkedRegionUuids, buildRegionLink, resolveLinkedArea } from "./region-links.js";
import { testAreaPoint } from "../aoe/containment.js";
import { getSpellLevel } from "./magicka-utils.js";

// ── Shared Private Helpers ───────────────────────────────────────────────────

/** @private Debug log for magic routing (gated by setting). */
const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][SpellReflect]");

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Spell Lifecycle Hooks (from spell-hooks.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Emit the preCast hook. Returns false if any listener cancelled the cast.
 *
 * @param {object} payload
 * @param {Actor} payload.caster - The casting actor
 * @param {Item} payload.spell - The spell being cast
 * @param {object} payload.profile - Resolved spell profile
 * @param {object} payload.spellOptions - Spell options (restrain, overload, etc.)
 * @param {string[]} payload.targetUuids - Target UUIDs
 * @returns {boolean} false if cancelled
 */
export function emitPreCast(payload) {
  try {
    return Hooks.call("uesrpg.spell.preCast", {
      caster: payload.caster,
      spell: payload.spell,
      profile: payload.profile,
      spellOptions: payload.spellOptions,
      targetUuids: payload.targetUuids ?? []
    });
  } catch (err) {
    console.error("UESRPG | spell-hooks | preCast hook error", err);
    return true; // Don't block casting on hook errors
  }
}

/**
 * Emit the castResolved hook.
 *
 * @param {object} payload
 * @param {Actor} payload.caster - The casting actor
 * @param {Item} payload.spell - The spell that was cast
 * @param {object} payload.result - Roll result (from degree-roll-helper)
 * @param {boolean} payload.success - Whether the cast succeeded
 * @param {boolean} payload.backfired - Whether backfire was triggered
 * @param {number} payload.mpSpent - MP actually spent (after refund)
 * @param {object} payload.spellOptions - Options used
 * @param {string} [payload.messageId] - Chat message ID
 */
export function emitCastResolved(payload) {
  try {
    Hooks.callAll("uesrpg.spell.castResolved", {
      caster: payload.caster,
      spell: payload.spell,
      result: payload.result,
      success: payload.success,
      backfired: payload.backfired ?? false,
      mpSpent: payload.mpSpent ?? 0,
      spellOptions: payload.spellOptions ?? {},
      messageId: payload.messageId ?? null
    });
  } catch (err) {
    console.error("UESRPG | spell-hooks | castResolved hook error", err);
  }
}

/**
 * Emit the effectApplied hook.
 *
 * @param {object} payload
 * @param {Actor} payload.caster - The casting actor
 * @param {Actor} payload.target - The target actor
 * @param {Item} payload.spell - The spell
 * @param {ActiveEffect[]} payload.effects - The AEs created on the target
 * @param {ActiveEffect} [payload.originEffect] - The Origin AE on the caster (if any)
 */
export function emitEffectApplied(payload) {
  try {
    Hooks.callAll("uesrpg.spell.effectApplied", {
      caster: payload.caster,
      target: payload.target,
      spell: payload.spell,
      effects: payload.effects ?? [],
      originEffect: payload.originEffect ?? null
    });
  } catch (err) {
    console.error("UESRPG | spell-hooks | effectApplied hook error", err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Spell Routing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Classify a spell for routing purposes.
 * @param {Item} spell
 * @returns {{isAttack: boolean, isHealing: boolean, isDirect: boolean, isCharacteristicDefense: boolean, isTargeted: boolean, damageType: string}}
 */
export function classifySpellForRouting(spell) {
  const isAttack = (spell?.system?.isAttackSpell === true) || (_str(spell?.system?.isAttackSpell).toLowerCase() === "true");
  const damageType = _str(spell?.system?.damageType).toLowerCase();
  // Check both the isHealingSpell toggle AND the damageType for backwards compatibility
  // Include temporary healing as healing type
  const isHealing = _bool(spell?.system?.isHealingSpell) ||
                    (damageType === "healing") ||
                    (damageType === "temporaryhealing") ||
                    (damageType === "temporary healing");
  const isDirect = _bool(spell?.system?.isDirect);
  // Characteristic defense spells need targeted workflow to create chat cards
  const defenseModel = _str(spell?.system?.engine?.defenseModel).toLowerCase();
  const isCharacteristicDefense = (defenseModel === "characteristic");
  const isTargeted = isAttack || isHealing || isDirect || isCharacteristicDefense;
  return { isAttack, isHealing, isDirect, isCharacteristicDefense, isTargeted, damageType };
}

/**
 * Get current user targets in a stable array.
 * @returns {Token[]}
 */
export function getUserSpellTargets() {
  try {
    return Array.from(game.user?.targets ?? []);
  } catch (_e) {
    return [];
  }
}

/**
 * Determine whether this cast should route into the targeted MagicOpposedWorkflow.
 * @param {Item} spell
 * @param {Token[]} targets
 * @returns {boolean}
 */
export function shouldUseTargetedSpellWorkflow(spell, targets) {
  const cls = classifySpellForRouting(spell);
  return cls.isTargeted && Array.isArray(targets) && targets.length > 0;
}

/**
 * Determine whether this spell should use the modern casting engine even when untargeted.
 * All spells now use the modern pipeline for consistent Magicka handling and spell options.
 * @param {Item} spell
 * @returns {boolean}
 */
export function shouldUseModernSpellWorkflow(spell) {
  // All spells use the modern rolling pipeline
  return true;
}

/**
 * Optional debug logging for routing decisions.
 * @param {object} params
 * @param {string} params.source
 * @param {Actor} params.actor
 * @param {Item} params.spell
 * @param {Token[]} params.targets
 */
export function debugMagicRoutingLog({ source, actor, spell, targets }) {
  if (!isDebugEnabled("debugMagicRouting")) return;
  const cls = classifySpellForRouting(spell);
  const t = Array.isArray(targets) ? targets.map(tt => tt?.document?.uuid ?? tt?.uuid ?? "?") : [];
  console.debug(`[UESRPG][MagicRouting] ${source}`, {
    actor: actor?.uuid ?? actor?.id,
    spell: spell?.uuid ?? spell?.id,
    classification: cls,
    targets: t
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Spell Reflect (from spell-reflect.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Read the Spell Reflect threshold from an actor.
 *
 * Sources:
 * - AE modifier key: `system.modifiers.magic.spellReflect` (numeric, ADD semantics)
 * - Direct data path: `actor.system.modifiers.magic.spellReflect`
 *
 * @param {Actor} actor
 * @returns {number} The highest spell level that can be reflected (0 = no reflect)
 */
export function getSpellReflectThreshold(actor) {
  if (!actor) return 0;

  // AE-based spellReflect value (aggregated from all active effects)
  const aeResult = evaluateAEModifierKeys(actor, ["system.modifiers.magic.spellReflect"]);
  const aeValue = Number(aeResult["system.modifiers.magic.spellReflect"] ?? 0) || 0;

  // Direct data path fallback (for manually set values or non-AE sources)
  const dataValue = Number(actor.system?.modifiers?.magic?.spellReflect ?? 0) || 0;

  // Use whichever is higher (AE stacking or base value)
  return Math.max(aeValue, dataValue);
}

/**
 * Check if a spell would be reflected by the target's Spell Reflect.
 *
 * @param {Actor} targetActor - The spell's target
 * @param {Item} spell - The spell being cast
 * @param {Actor} casterActor - The original caster
 * @param {object} [options]
 * @param {boolean} [options.alreadyReflected=false] - If true, skip (prevent loops)
 * @returns {Promise<{reflected: boolean, behavior: string, threshold: number, spellLevel: number}>}
 */
export async function trySpellReflect(targetActor, spell, casterActor, options = {}) {
  const result = { reflected: false, behavior: "none", threshold: 0, spellLevel: 0, rollTotal: null };

  if (!targetActor || !spell) return result;

  // Prevent infinite reflect loops
  if (options.alreadyReflected) return result;

  // Don't reflect self-targeted spells
  if (casterActor && targetActor.uuid === casterActor.uuid) return result;

  const threshold = getSpellReflectThreshold(targetActor);
  result.threshold = threshold;

  if (threshold <= 0) return result;

  const spellLevel = Number(getSpellLevel(spell) ?? 0) || 0;
  result.spellLevel = spellLevel;

  // RAW: Roll 1d10 — if roll ≤ threshold, the spell is reflected.
  const roll = new Roll("1d10");
  await roll.evaluate();
  const rollTotal = Number(roll.total ?? 0) || 0;
  result.rollTotal = rollTotal;

  if (rollTotal > threshold) {
    _debug(`Spell "${spell.name}" (L${spellLevel}) — Reflect roll ${rollTotal} > threshold ${threshold}, not reflected`);

    // Post chat notification for the failed reflect attempt
    try {
      await ChatMessage.create({
        content: `<div class="uesrpg"><div class="uesrpg-spell-reflect"><h3>Spell Reflect (${threshold})</h3><p><strong>${targetActor.name}</strong> attempts to reflect <strong>${spell.name}</strong>.</p><p><b>Roll:</b> ${rollTotal}</p><p><b>Outcome:</b> Failed — spell is not reflected.</p></div></div>`,
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    } catch (_e) { /* non-blocking */ }

    return result;
  }

  // Reflected!
  result.reflected = true;

  // Determine behavior based on spell type
  const spellName = String(spell.name ?? "").trim();
  const isAbsorbChar = spellName.startsWith("Absorb ") && spell.system?.school === "mysticism" &&
    !["Absorb Life", "Absorb Magicka"].includes(spellName);

  if (isAbsorbChar) {
    // RAW: "no net effect" when Absorb [Char] is reflected
    result.behavior = "cancel";
  } else {
    // All other spells: redirect to caster
    result.behavior = "redirect";
  }

  _debug(`Spell "${spell.name}" (L${spellLevel}) REFLECTED by ${targetActor.name} (roll ${rollTotal} ≤ threshold ${threshold}), behavior=${result.behavior}`);

  // Post chat notification
  try {
    const behaviorText = result.behavior === "cancel"
      ? `The spell has no net effect.`
      : `The spell is redirected back at ${casterActor?.name ?? "the caster"}!`;

    await ChatMessage.create({
      content: `<div class="uesrpg"><div class="uesrpg-spell-reflect"><h3>Spell Reflected!</h3><p><strong>${targetActor.name}</strong> reflects <strong>${spell.name}</strong> (Level ${spellLevel}).</p><p><b>Roll:</b> ${rollTotal}</p><p>${behaviorText}</p><p><em>Reflect threshold: ${threshold}</em></p></div></div>`,
      speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  } catch (_e) { /* non-blocking */ }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Spell Zone Service (from spell-zone-service.js)
// ═══════════════════════════════════════════════════════════════════════════════

const _FLAG_NS = FLAG_SCOPE;

/**
 * Link an existing Region to an Origin AE.
 *
 * @param {ActiveEffect} originAE - Origin AE on the caster
 * @param {string} regionUuid - UUID of the Region document
 * @param {string} [label] - Human-readable label
 * @returns {Promise<boolean>} Success
 */
export async function linkAreaToOriginAE(originAE, regionUuid, label = "") {
  const link = buildRegionLink(regionUuid, label);
  if (!originAE || !link) return false;
  return registerLinkedEntity(originAE, link);
}

/**
 * Legacy alias for callers that still use template-oriented naming.
 */
export async function linkTemplateToOriginAE(originAE, templateUuid, label = "") {
  return linkAreaToOriginAE(originAE, templateUuid, label);
}

/**
 * Get all tokens currently within a linked area.
 *
 * Uses center + corner + midpoint sampling for accuracy.
 *
 * @param {RegionDocument|MeasuredTemplateDocument|string} areaDocOrUuid - Area document or UUID
 * @returns {Token[]} Array of Token objects within the area
 */
export function getTokensInArea(areaDocOrUuid) {
  try {
    const doc = typeof areaDocOrUuid === "string"
      ? resolveLinkedArea(areaDocOrUuid)
      : areaDocOrUuid;
    if (!doc) return [];

    const scene = doc.parent ?? canvas?.scene;
    if (!scene) return [];

    const tokens = canvas?.tokens?.placeables ?? [];
    if (!tokens.length) return [];

    return tokens.filter(token => {
      if (!token?.document) return false;
      return _isTokenInArea(token, doc.object ?? doc);
    });
  } catch (err) {
    console.warn("UESRPG | spell-zone-service | getTokensInArea error", err);
    return [];
  }
}

export function getTokensInTemplate(templateDocOrUuid) {
  return getTokensInArea(templateDocOrUuid);
}

/**
 * Get all active spell zones (Origin AEs that have linked areas).
 *
 * When `useZoneRegistry` is enabled and no casterActor filter is provided,
 * reads from the in-memory zone registry (O(zones)) instead of scanning all
 * actors (O(all_actors × all_effects)).
 *
 * @param {Actor} [casterActor] - If provided, only returns zones for this caster (legacy scan, already cheap)
 * @returns {Array<{originAE: ActiveEffect, areaUuids: string[], regionUuids: string[], areaType: string, spellName: string, casterUuid: string, spellUuid: string}>}
 */
export function getActiveSpellZones(casterActor = null) {
  // Registry fast-path: only for full scans (no caster filter).
  if (!casterActor && _isZoneRegistryEnabled()) {
    return _getActiveSpellZonesFromRegistry();
  }

  // Legacy path: scan actors directly (also always used when casterActor is provided).
  const results = [];
  const actors = casterActor ? [casterActor] : (game.actors?.contents ?? []);

  for (const actor of actors) {
    const origins = getOriginAEs(actor);
    for (const origin of origins) {
      const flags = origin.flags?.[_FLAG_NS];
      if (!flags?.isOriginAE) continue;
      const areaUuids = getLinkedAreaUuids(origin);
      const regionUuids = getLinkedRegionUuids(origin);
      if (!areaUuids.length) continue;

      results.push({
        originAE: origin,
        areaUuids,
        regionUuids,
        spellName: flags.spellName ?? origin.name,
        casterUuid: flags.casterUuid ?? actor.uuid,
        spellUuid: flags.spellUuid ?? "",
        areaType: regionUuids.length ? "region" : "template"
      });
    }
  }

  return results;
}

// ─── Zone Internals ──────────────────────────────────────────────────────────

/**
 * Check if a token is within an area.
 * Uses center point + 8-direction sampling for tokens larger than 1x1.
 * @param {Token} token
 * @param {Region|MeasuredTemplate} area
 * @returns {boolean}
 * @private
 */
function _isTokenInArea(token, area) {
  const points = _getTokenSamplePoints(token);
  const elevation = token?.document?.elevation ?? token?.elevation ?? 0;
  for (const pt of points) {
    if (testAreaPoint(area, pt, { elevation })) return true;
  }
  return false;
}

/**
 * Get sample points for a token (center + corners + edge midpoints).
 * @param {Token} token
 * @returns {Array<{x: number, y: number}>}
 * @private
 */
function _getTokenSamplePoints(token) {
  const doc = token.document ?? token;
  const x = doc.x ?? 0;
  const y = doc.y ?? 0;
  const gs = canvas?.grid?.size ?? 100;
  const w = (doc.width ?? 1) * gs;
  const h = (doc.height ?? 1) * gs;

  const cx = x + w / 2;
  const cy = y + h / 2;

  // Center point always
  const points = [{ x: cx, y: cy }];

  // For larger tokens, add corners and midpoints
  if (w > gs || h > gs) {
    points.push(
      { x: x, y: y },               // top-left
      { x: x + w, y: y },           // top-right
      { x: x, y: y + h },           // bottom-left
      { x: x + w, y: y + h },       // bottom-right
      { x: cx, y: y },              // top-mid
      { x: cx, y: y + h },          // bottom-mid
      { x: x, y: cy },              // left-mid
      { x: x + w, y: cy }           // right-mid
    );
  }

  return points;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Zone Registry (Milestone D)
//
// Indexed alternative to getActiveSpellZones()'s full actor scan.
// Enabled by the `useZoneRegistry` world setting (default: false).
//
// Registry lifecycle:
//  - Seeded once at system ready via seedZoneRegistry()
//  - Maintained incrementally via createActiveEffect / updateActiveEffect /
//    deleteActiveEffect hooks (installed by seedZoneRegistry)
//  - Rebuilt on canvasReady as a safety net (templates are scene-embedded docs)
//  - rebuildZoneRegistry() exposed as a GM debug utility
//
// Format: Map<aeUuid, ZoneEntry>
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} ZoneEntry
 * @property {string} aeUuid - UUID of the Origin AE (e.g. "Actor.abc.ActiveEffect.def")
 * @property {string} actorId - Foundry id of the owning actor
 * @property {string[]} areaUuids - UUIDs of linked regions or legacy templates
 * @property {string[]} regionUuids - UUIDs of linked regions
 * @property {string} spellName
 * @property {string} casterUuid
 * @property {string} spellUuid
 */

/** @type {Map<string, ZoneEntry>} */
const _zoneRegistry = new Map();

let _zoneRegistryHooksInstalled = false;

function _isZoneRegistryEnabled() {
  try {
    return Boolean(game?.settings?.get?.(SYSTEM_ID, "useZoneRegistry"));
  } catch (_e) {
    return false;
  }
}

/**
 * Build a ZoneEntry from an actor + Origin AE. Returns null if AE has no area links.
 * @param {Actor} actor
 * @param {ActiveEffect} originAE
 * @returns {ZoneEntry|null}
 */
function _makeZoneEntry(actor, originAE) {
  const flags = originAE?.flags?.[_FLAG_NS];
  if (!flags?.isOriginAE) return null;
  const areaUuids = getLinkedAreaUuids(originAE);
  const regionUuids = getLinkedRegionUuids(originAE);
  if (!areaUuids.length) return null;
  const aeUuid = originAE.uuid;
  if (!aeUuid) return null;
  return {
    aeUuid: String(aeUuid),
    actorId: String(actor.id),
    areaUuids,
    regionUuids,
    spellName: String(flags.spellName ?? originAE.name ?? ""),
    casterUuid: String(flags.casterUuid ?? actor.uuid ?? ""),
    spellUuid: String(flags.spellUuid ?? "")
  };
}

function _addToZoneRegistry(actor, originAE) {
  const entry = _makeZoneEntry(actor, originAE);
  if (!entry) return;
  _zoneRegistry.set(entry.aeUuid, entry);
}

function _removeFromZoneRegistry(aeUuid) {
  if (aeUuid) _zoneRegistry.delete(String(aeUuid));
}

function _rebuildZoneRegistryFull() {
  _zoneRegistry.clear();
  for (const actor of (game?.actors?.contents ?? [])) {
    for (const ae of getOriginAEs(actor)) {
      _addToZoneRegistry(actor, ae);
    }
  }
}

/**
 * Read active zones from the registry. Cleans stale entries on the fly.
 * @returns {Array<{originAE: ActiveEffect, areaUuids: string[], regionUuids: string[], spellName: string, casterUuid: string, spellUuid: string, areaType: string}>}
 */
function _getActiveSpellZonesFromRegistry() {
  const results = [];
  const resolver = createUuidResolver();
  for (const [aeUuid, entry] of _zoneRegistry) {
    const ae = resolver.resolveSync(aeUuid) ?? resolveUuidSync(aeUuid);
    if (!ae) {
      // Stale entry — AE was removed without the deleteActiveEffect hook firing
      _zoneRegistry.delete(aeUuid);
      continue;
    }
    results.push({
      originAE: ae,
      areaUuids: entry.areaUuids,
      regionUuids: entry.regionUuids,
      spellName: entry.spellName,
      casterUuid: entry.casterUuid,
      spellUuid: entry.spellUuid,
      areaType: entry.regionUuids?.length ? "region" : "template"
    });
  }
  return results;
}

/**
 * Cheap predicate: returns true if there are any active zones.
 * When registry is enabled, O(1). Otherwise conservatively returns true.
 * Used as the `hasWork` predicate in the zone-tick spell tick handler.
 *
 * @returns {boolean}
 */
export function hasActiveZones() {
  if (_isZoneRegistryEnabled()) return _zoneRegistry.size > 0;
  return true;
}

/**
 * Seed the zone registry and install AE lifecycle hooks for incremental maintenance.
 * Idempotent — safe to call multiple times.
 *
 * Call once at system ready (after initializeSpellTickEngine).
 */
export function seedZoneRegistry() {
  _rebuildZoneRegistryFull();

  if (_zoneRegistryHooksInstalled) return;
  _zoneRegistryHooksInstalled = true;

  // Incremental: add when a new Origin AE is created
  Hooks.on("createActiveEffect", (effect, _options, _userId) => {
    const actor = effect.parent;
    if (!actor || actor.documentName !== "Actor") return;
    _addToZoneRegistry(actor, effect);
  });

  // Incremental: re-index when AE flags change (e.g. template UUID added)
  Hooks.on("updateActiveEffect", (effect, changed, _options, _userId) => {
    if (!changed.flags) return;
    const actor = effect.parent;
    if (!actor || actor.documentName !== "Actor") return;
    _removeFromZoneRegistry(effect.uuid);
    _addToZoneRegistry(actor, effect);
  });

  // Incremental: remove when AE is deleted
  Hooks.on("deleteActiveEffect", (effect, _options, _userId) => {
    _removeFromZoneRegistry(effect.uuid);
  });

  // Safety rebuild when the canvas loads a new scene
  Hooks.on("canvasReady", () => {
    _rebuildZoneRegistryFull();
  });
}

/**
 * Force a full rebuild of the zone registry from live actor data.
 * Exposed as a GM debug utility (game.uesrpg.rebuildZoneRegistry()).
 */
export function rebuildZoneRegistry() {
  _rebuildZoneRegistryFull();
}
