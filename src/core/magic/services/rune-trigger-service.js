/**
 * @module magic/services/rune-trigger-service
 *
 * src/core/magic/rune-trigger-service.js
 *
 * Rune and trap spell trigger detection for UESRPG 3ev4.
 *
 * RAW (Chapter 6):
 *  - Rune type spells persist indefinitely.
 *  - Proximity: detonates when a character comes within a certain distance.
 *  - Time: detonates after a set amount of time.
 *  - Manual: caster detonates manually by using Cast Magic action.
 *  - Detonates in 3m burst dealing [Spell Strength] [Type] damage.
 *  - AoE attack, evadable only if aware.
 *
 * Implementation:
 *  - Rune Origin AEs carry `flags.uesrpg.rune` metadata.
 *  - Proximity detection uses `updateToken` hook to check distance from the rune area.
 *  - Time detection uses the spell tick engine (worldTime trigger).
 *  - Manual detonation via `detonateRune()` API.
 *  - Detonation applies damage, emits hook, then tears down Origin AE.
 *
 * Target: Foundry VTT v14.359+
 */

import { getOriginAEs, teardownOriginAE } from "../effects/origin-effect.js";
import { requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { getTokensInArea } from "../spell-runtime.js";
import { getLinkedAreaEntities } from "../region-links.js";
import { registerSpellTickHandler } from "../ticks/spell-tick-engine.js";
import { _num, _str, createDebugLogger } from "../_primitives.js";
import { FLAG_SCOPE, SYSTEM_ID } from "../../system/namespace.js";
import { createUuidResolver } from "../../../utils/uuid-cache.js";

const _FLAG_NS = FLAG_SCOPE;
const RUNE_DETONATION_RADIUS_M = 3; // RAW: 3m burst

let _hooksInstalled = false;
let _runeRegistryHooksInstalled = false;

const _debug = createDebugLogger("aeLifecycleDebug", "[UESRPG][Rune]");

// ─── Rune Registry (Milestone D) ─────────────────────────────────────────────
//
// Indexed alternative to getActiveRunes()'s full actor scan.
// Enabled by the `useRuneRegistry` world setting (default: false).
//
// Format: Map<aeUuid, RuneEntry>
//
// Lifecycle:
//  - Seeded once at system ready via seedRuneRegistry()
//  - Maintained incrementally via createActiveEffect / updateActiveEffect /
//    deleteActiveEffect hooks installed by seedRuneRegistry()
//  - rebuildRuneRegistry() exposed as a GM debug utility

/**
 * @typedef {object} RuneEntry
 * @property {string} aeUuid - UUID of the rune Origin AE
 * @property {string} actorId - Foundry id of the owning actor
 * @property {object} runeData - Snapshot of flags.rune metadata
 * @property {string[]} areaUuids - UUIDs of linked area documents
 */

/** @type {Map<string, RuneEntry>} */
const _runeRegistry = new Map();

function _isRuneRegistryEnabled() {
  try {
    return Boolean(game?.settings?.get?.(SYSTEM_ID, "useRuneRegistry"));
  } catch (_e) {
    return false;
  }
}

/**
 * Build a RuneEntry from an Origin AE. Returns null if AE is not a rune.
 * @param {ActiveEffect} originAE
 * @returns {RuneEntry|null}
 */
function _makeRuneEntry(originAE) {
  const flags = originAE?.flags?.[_FLAG_NS];
  if (!flags?.isOriginAE || !flags?.rune?.isRune) return null;
  const aeUuid = originAE.uuid;
  if (!aeUuid) return null;
  const actor = originAE.parent;
  const areaLinks = getLinkedAreaEntities(originAE);
  return {
    aeUuid: String(aeUuid),
    actorId: String(actor?.id ?? ""),
    runeData: { ...(flags.rune ?? {}) },
    areaUuids: areaLinks.map(l => String(l.uuid))
  };
}

function _addToRuneRegistry(originAE) {
  const entry = _makeRuneEntry(originAE);
  if (!entry) return;
  _runeRegistry.set(entry.aeUuid, entry);
}

function _removeFromRuneRegistry(aeUuid) {
  if (aeUuid) _runeRegistry.delete(String(aeUuid));
}

function _rebuildRuneRegistryFull() {
  _runeRegistry.clear();
  for (const actor of (game?.actors?.contents ?? [])) {
    for (const ae of getOriginAEs(actor)) {
      _addToRuneRegistry(ae);
    }
  }
}

/**
 * Read active runes from the registry. Cleans stale entries on the fly.
 * @returns {ActiveEffect[]}
 */
function _getActiveRunesFromRegistry() {
  const runes = [];
  const resolver = createUuidResolver();
  for (const [aeUuid] of _runeRegistry) {
    const ae = resolver.resolveSync(aeUuid);
    if (!ae) {
      _runeRegistry.delete(aeUuid);
      continue;
    }
    runes.push(ae);
  }
  return runes;
}

/**
 * Cheap predicate: returns true if any active rune exists.
 * When registry is enabled, O(1). Otherwise conservatively returns true.
 * Used as `hasWork` predicate in the rune-time-trigger spell tick handler.
 *
 * @returns {boolean}
 */
export function hasActiveRunes() {
  if (_isRuneRegistryEnabled()) return _runeRegistry.size > 0;
  return true;
}

/**
 * Seed the rune registry and install AE lifecycle hooks for incremental maintenance.
 * Idempotent — safe to call multiple times.
 */
export function seedRuneRegistry() {
  _rebuildRuneRegistryFull();

  if (_runeRegistryHooksInstalled) return;
  _runeRegistryHooksInstalled = true;

  Hooks.on("createActiveEffect", (effect, _options, _userId) => {
    if (effect.parent?.documentName !== "Actor") return;
    _addToRuneRegistry(effect);
  });

  Hooks.on("updateActiveEffect", (effect, changed, _options, _userId) => {
    if (!changed.flags) return;
    if (effect.parent?.documentName !== "Actor") return;
    _removeFromRuneRegistry(effect.uuid);
    _addToRuneRegistry(effect);
  });

  Hooks.on("deleteActiveEffect", (effect, _options, _userId) => {
    _removeFromRuneRegistry(effect.uuid);
  });
}

/**
 * Force a full rebuild of the rune registry from live actor data.
 * Exposed as a GM debug utility.
 */
export function rebuildRuneRegistry() {
  _rebuildRuneRegistryFull();
}

// ─── Query ───────────────────────────────────────────────────────────────────

/**
 * Check if an Origin AE is a rune.
 *
 * A rune is identified by having `flags.uesrpg-3ev4.rune` metadata OR
 * by having a linked area and spell with rune-like attributes.
 *
 * @param {ActiveEffect} originAE
 * @returns {boolean}
 */
export function isRuneOriginAE(originAE) {
  const flags = originAE?.flags?.[_FLAG_NS];
  if (!flags?.isOriginAE) return false;
  return Boolean(flags.rune?.isRune);
}

/**
 * Get all active rune Origin AEs across all actors (or for a specific caster).
 *
 * When `useRuneRegistry` is enabled and no casterActor filter is provided,
 * reads from the in-memory rune registry (O(runes)) instead of scanning all
 * actors (O(all_actors × all_effects)).
 *
 * @param {Actor} [casterActor] - Optional: filter to this caster (legacy scan)
 * @returns {ActiveEffect[]}
 */
export function getActiveRunes(casterActor = null) {
  // Registry fast-path: only for full scans (no caster filter).
  if (!casterActor && _isRuneRegistryEnabled()) {
    return _getActiveRunesFromRegistry();
  }

  // Legacy path.
  const actors = casterActor ? [casterActor] : (game.actors?.contents ?? []);
  const runes = [];
  for (const actor of actors) {
    for (const ef of getOriginAEs(actor)) {
      if (isRuneOriginAE(ef)) runes.push(ef);
    }
  }
  return runes;
}

// ─── Detonation ──────────────────────────────────────────────────────────────

/**
 * Detonate a rune Origin AE.
 *
 * Collects tokens within the detonation radius, emits the `uesrpg.spell.runeDetonated`
 * hook (allowing damage/effect application by subscribers), then tears down the Origin AE
 * (removing linked areas and all linked entities).
 *
 * @param {ActiveEffect} originAE - The rune's Origin AE
 * @param {object} [opts]
 * @param {string} [opts.triggerSource] - "proximity" | "time" | "manual"
 * @param {Token} [opts.triggerToken] - The token that triggered the rune (proximity)
 * @returns {Promise<{detonated: boolean, tokens: Token[], errors: string[]}>}
 */
export async function detonateRune(originAE, opts = {}) {
  const flags = originAE?.flags?.[_FLAG_NS];
  if (!flags?.isOriginAE) return { detonated: false, tokens: [], errors: ["Not an Origin AE"] };

  const runeData = flags.rune ?? {};
  const spellName = _str(flags.spellName || originAE.name);
  const areaLinks = getLinkedAreaEntities(originAE);

  _debug("Detonating rune:", spellName, "trigger:", opts.triggerSource ?? "unknown");

  // Collect tokens within all linked areas
  const allTokens = [];
  for (const area of areaLinks) {
    const tokens = getTokensInArea(area.uuid);
    for (const t of tokens) {
      if (!allTokens.some(existing => existing.id === t.id)) {
        allTokens.push(t);
      }
    }
  }

  // Emit detonation hook — damage/effect application is handled by subscribers
  try {
    Hooks.callAll("uesrpg.spell.runeDetonated", {
      originAE,
      spellUuid: _str(flags.spellUuid),
      spellName,
      casterUuid: _str(flags.casterUuid),
      triggerSource: opts.triggerSource ?? "unknown",
      triggerToken: opts.triggerToken ?? null,
      tokens: allTokens,
      areaUuids: areaLinks.map(l => l.uuid),
      runeData
    });
  } catch (err) {
    console.warn("UESRPG | rune-trigger-service | runeDetonated hook error", err);
  }

  // Log to chat
  try {
    const tokenNames = allTokens.map(t => t.name ?? "?").join(", ");
    await ChatMessage.create({
      content: `<div class="uesrpg"><h3>Rune Detonated</h3><p><strong>${spellName}</strong> triggered (${opts.triggerSource ?? "unknown"}).</p>${allTokens.length ? `<p>Caught in blast: ${tokenNames}</p>` : "<p>No targets in area.</p>"}</div>`,
      speaker: { alias: "System" },
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  } catch (_e) { /* no-op */ }

  // Teardown: remove linked areas + Origin AE
  const result = await teardownOriginAE(originAE, { silent: true });

  // Delete the Origin AE itself (teardown only cleans linked entities)
  try {
    const parent = originAE.parent;
    if (parent) {
      const existing = parent.effects?.get?.(originAE.id);
      if (existing) {
        await requestDeleteEmbeddedDocuments(parent, "ActiveEffect", [existing.id]);
      }
    }
  } catch (_e) { /* no-op — may already be deleted by teardown hook */ }

  return {
    detonated: true,
    tokens: allTokens,
    errors: result.errors ?? []
  };
}

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialize rune trigger detection hooks.
 * Must be called once during system initialization.
 */
export function initializeRuneTriggerService() {
  if (_hooksInstalled) return;
  _hooksInstalled = true;

  // Proximity trigger: detect token movement near runes (GM-only)
  Hooks.on("updateToken", async (tokenDoc, changed) => {
    if (!game.user?.isGM) return;
    // Only trigger on position changes
    if (!("x" in changed) && !("y" in changed)) return;

    // Fast-path: skip if no runes exist (O(1) when registry enabled, else O(1) array length check)
    if (!hasActiveRunes()) return;

    const runes = getActiveRunes();
    if (!runes.length) return;

    const token = tokenDoc.object ?? tokenDoc;
    const tokenCenter = token?.center ?? { x: _num(tokenDoc.x, 0) + 50, y: _num(tokenDoc.y, 0) + 50 };
    const resolver = createUuidResolver();

    for (const rune of runes) {
      const runeData = rune.flags?.[_FLAG_NS]?.rune ?? {};
      if (runeData.triggerType !== "proximity") continue;

      const areaLinks = getLinkedAreaEntities(rune);

      for (const area of areaLinks) {
        try {
          const areaDoc = resolver.resolveSync(area.uuid);
          if (!areaDoc) continue;
          const areaObj = areaDoc.object ?? areaDoc;
          let areaCenter = areaObj?.center ?? null;
          if (!areaCenter && areaDoc?.documentName === "Region") {
            const bounds = areaObj?.bounds ?? null;
            if (bounds) areaCenter = { x: bounds.x + (bounds.width / 2), y: bounds.y + (bounds.height / 2) };
          }
          if (!areaCenter) continue;

          // Check distance from token center to area center
          const dx = tokenCenter.x - areaCenter.x;
          const dy = tokenCenter.y - areaCenter.y;
          const distPixels = Math.sqrt(dx * dx + dy * dy);

          // Convert to meters using grid scale
          const gridSize = _num(canvas?.grid?.size, 100);
          const gridDist = _num(canvas?.scene?.grid?.distance, 1);
          const distMeters = (distPixels / gridSize) * gridDist;

          const triggerRadius = _num(runeData.triggerRadius, RUNE_DETONATION_RADIUS_M);

          if (distMeters <= triggerRadius) {
            _debug("Proximity trigger!", rune.flags?.[_FLAG_NS]?.spellName, "by", tokenDoc.name);
            await detonateRune(rune, {
              triggerSource: "proximity",
              triggerToken: token
            });
            return; // Only one detonation per movement
          }
        } catch (err) {
          console.warn("UESRPG | rune-trigger-service | proximity check error", err);
        }
      }
    }
  });

  // Time trigger: register with the spell tick engine
  registerSpellTickHandler({
    id: "rune-time-trigger",
    label: "Rune Time Trigger",
    // hasWork: skip on irrelevant triggers or when no runes exist.
    hasWork: (ctx) => (ctx.trigger === "turnEnd" || ctx.trigger === "worldTime") && hasActiveRunes(),
    fn: async (ctx) => {
      if (ctx.trigger !== "turnEnd" && ctx.trigger !== "worldTime") return;

      const runes = getActiveRunes();
      for (const rune of runes) {
        const runeData = rune.flags?.[_FLAG_NS]?.rune ?? {};
        if (runeData.triggerType !== "time") continue;

        const placedTime = _num(rune.flags?.[_FLAG_NS]?.originalCastWorldTime, 0);
        const triggerDelay = _num(runeData.triggerDelay, 0); // seconds
        if (triggerDelay <= 0) continue;

        const elapsed = ctx.worldTime - placedTime;
        if (elapsed >= triggerDelay) {
          _debug("Time trigger!", rune.flags?.[_FLAG_NS]?.spellName, "elapsed:", elapsed, "s");
          await detonateRune(rune, { triggerSource: "time" });
        }
      }
    }
  });

  _debug("Rune trigger service initialized");
}
