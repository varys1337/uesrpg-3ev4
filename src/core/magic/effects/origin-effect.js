/**
 * @module magic/effects/origin-effect
 *
 * src/core/magic/origin-effect.js
 *
 * Origin Active Effect lifecycle management for persistent spells.
 *
 * Design:
 *  - When a spell with duration/upkeep/zones/summons creates persistent effects,
 *    an Origin AE is created on the **caster** that links all downstream entities.
 *  - The Origin AE stores: spell UUID, caster UUID, cost paid, scaling choices,
 *    target snapshot, and a list of linked entity UUIDs (target AEs, templates, summons).
 *  - Ending/removing the Origin AE deterministically cleans all linked entities.
 *  - Teardown is idempotent — safe to call multiple times.
 *
 * Target: Foundry VTT v13.351
 */

import { requestDeleteEmbeddedDocuments, requestUpdateDocument, requestCreateEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { _num, _str, createDebugLogger } from "../_primitives.js";

const _FLAG_NS = "uesrpg-3ev4";

/**
 * Debug logger for origin effect lifecycle.
 * @param  {...any} args 
 */
const _originDebug = createDebugLogger("aeLifecycleDebug", "[UESRPG][OriginAE]");

/**
 * Check if a spell has no listed duration (used for upkeep contract).
 * @param {Item} spell
 * @returns {boolean}
 */
function _isNoListedDuration(spell) {
  const dur = spell?.system?.duration ?? {};
  const unit = _str(dur.unit).toLowerCase();
  const value = _num(dur.value, 0);
  return (unit === "instant") || (value <= 0);
}

// ─── Creation ────────────────────────────────────────────────────────────────

/**
 * Determine whether a spell requires an Origin AE on the caster.
 *
 * Criteria: spell has duration/upkeep/zones/summons/ongoing conditions.
 *
 * @param {Item} spell - The spell item
 * @returns {boolean}
 */
export function spellRequiresOriginAE(spell) {
  if (!spell) return false;
  // Has upkeep → always needs tracking
  if (spell.system?.hasUpkeep) return true;
  // Has embedded AEs → persistent effects
  if ((spell.effects?.size ?? 0) > 0) return true;
  // Has finite duration
  const dur = spell.system?.duration ?? {};
  const unit = _str(dur.unit).toLowerCase();
  const value = _num(dur.value, 0);
  if (value > 0 && ["rounds", "minutes", "hours", "days"].includes(unit)) return true;
  // Permanent duration
  if (unit === "permanent") return true;
  return false;
}

/**
 * Create an Origin AE on the caster for a persistent spell.
 *
 * @param {Actor} casterActor - The caster
 * @param {Item} spell - The spell being cast
 * @param {object} options
 * @param {number} options.costPaid - MP cost actually spent
 * @param {object} options.scalingChoices - Scaling options chosen at cast time
 * @param {object} options.spellOptions - Full spell options (restrain, overload, etc.)
 * @param {string[]} [options.targetUuids] - UUIDs of targets (actors/tokens)
 * @param {number} [options.castWorldTime] - World time at cast
 * @param {object} [options.durationOverride] - Override Duration object for the AE
 * @returns {Promise<ActiveEffect|null>} The created Origin AE, or null on failure
 */
export async function createOriginAE(casterActor, spell, options = {}) {
  if (!casterActor || !spell) return null;
  if (!spellRequiresOriginAE(spell)) return null;

  const castWorldTime = _num(options.castWorldTime, _num(game.time?.worldTime, 0));

  // Build duration for the Origin AE (mirrors what spell-effects.js does for target AEs)
  const duration = options.durationOverride ?? _buildOriginDuration(spell);

  const effectData = {
    name: `[Origin] ${spell.name}`,
    img: spell.img,
    origin: spell.uuid,
    disabled: false,
    duration,
    changes: [], // Origin AE has no modifier changes — it's a lifecycle tracker
    flags: {
      [_FLAG_NS]: {
        isOriginAE: true,
        spellEffect: true,
        spellUuid: spell.uuid,
        spellName: spell.name,
        spellSchool: _str(spell.system?.school),
        spellLevel: _num(spell.system?.level, 1),
        casterUuid: casterActor.uuid,
        originalCastWorldTime: castWorldTime,
        costPaid: _num(options.costPaid, 0),
        scalingChoices: options.scalingChoices ?? null,
        spellOptions: options.spellOptions ?? null,
        targetUuids: Array.isArray(options.targetUuids) ? [...options.targetUuids] : [],
        linkedEntities: [], // Will be populated as target AEs / templates / summons are created
        hasUpkeep: Boolean(spell.system?.hasUpkeep),
        upkeep: Boolean(spell.system?.hasUpkeep) ? {
          originalCost: _num(options.costPaid, _num(spell.system?.cost, 0)),
          refreshCount: 0,
          lastRefreshWorldTime: null,
          lastRefreshRound: null,
          targetLock: Array.isArray(options.targetUuids) ? [...options.targetUuids] : [],
          noListedDuration: _isNoListedDuration(spell)
        } : null,
        owner: "system",
        effectGroup: `spell.origin.${spell.id ?? spell.uuid}`,
        stackRule: "replace",
        source: "spell-origin"
      }
    }
  };

  _originDebug("Creating Origin AE", {
    caster: casterActor.name,
    spell: spell.name,
    flags: effectData.flags[_FLAG_NS]
  });

  try {
    let created;
    if (casterActor.isOwner) {
      const results = await casterActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
      created = results?.[0] ?? null;
    } else {
      const { requestCreateEmbeddedDocuments } = await import("../../../utils/authority-proxy.js");
      const results = await requestCreateEmbeddedDocuments(casterActor, "ActiveEffect", [effectData]);
      created = Array.isArray(results) ? results[0] : results;
    }

    if (created) {
      _originDebug("Origin AE created successfully", { id: created.id, uuid: created.uuid });

      // Emit hook
      try {
        Hooks.callAll("uesrpg.spell.originCreated", {
          casterActor,
          spell,
          originEffect: created,
          options
        });
      } catch (_e) { /* no-op */ }
    }

    return created;
  } catch (err) {
    console.error("UESRPG | origin-effect | Failed to create Origin AE", err);
    return null;
  }
}

// ─── Linking ─────────────────────────────────────────────────────────────────

/**
 * Register a linked entity (target AE, template, summon) with an Origin AE.
 *
 * @param {ActiveEffect} originEffect - The Origin AE on the caster
 * @param {object} link - Link descriptor
 * @param {string} link.type - "targetAE" | "template" | "summon"
 * @param {string} link.uuid - UUID of the linked entity
 * @param {string} [link.actorUuid] - UUID of the target actor (for targetAE type)
 * @param {string} [link.label] - Human-readable label
 * @returns {Promise<boolean>} Success
 */
export async function registerLinkedEntity(originEffect, link) {
  if (!originEffect || !link?.uuid || !link?.type) return false;

  const flags = originEffect.flags?.[_FLAG_NS];
  if (!flags?.isOriginAE) return false;

  const existing = Array.isArray(flags.linkedEntities) ? [...flags.linkedEntities] : [];
  // Prevent duplicate registration
  if (existing.some(e => e.uuid === link.uuid)) return true;

  existing.push({
    type: _str(link.type),
    uuid: _str(link.uuid),
    actorUuid: _str(link.actorUuid),
    label: _str(link.label),
    registeredAt: Date.now()
  });

  _originDebug("Registering linked entity", { originId: originEffect.id, link });

  try {
    await _updateOriginEffect(originEffect, {
      [`flags.${_FLAG_NS}.linkedEntities`]: existing
    });
    return true;
  } catch (err) {
    console.error("UESRPG | origin-effect | Failed to register linked entity", err);
    return false;
  }
}

/**
 * Register multiple target AEs with an Origin AE.
 * Convenience wrapper for `registerLinkedEntity`.
 *
 * @param {ActiveEffect} originEffect - The Origin AE
 * @param {ActiveEffect[]} targetEffects - Array of target AEs
 * @param {Actor} targetActor - The target actor
 * @returns {Promise<void>}
 */
export async function registerTargetAEs(originEffect, targetEffects, targetActor) {
  if (!originEffect || !targetEffects?.length) return;
  for (const te of targetEffects) {
    await registerLinkedEntity(originEffect, {
      type: "targetAE",
      uuid: te.uuid ?? `${targetActor.uuid}.ActiveEffect.${te.id}`,
      actorUuid: targetActor.uuid,
      label: `${te.name} on ${targetActor.name}`
    });
  }
}

// ─── Teardown ────────────────────────────────────────────────────────────────

/**
 * Tear down all linked entities when an Origin AE is removed.
 * Idempotent — safe to call multiple times.
 *
 * @param {ActiveEffect} originEffect - The Origin AE being removed
 * @param {object} [options]
 * @param {boolean} [options.silent] - Suppress notifications
 * @returns {Promise<{deletedCount: number, errors: string[]}>}
 */
export async function teardownOriginAE(originEffect, options = {}) {
  const flags = originEffect?.flags?.[_FLAG_NS];
  if (!flags?.isOriginAE) return { deletedCount: 0, errors: [] };

  const linked = Array.isArray(flags.linkedEntities) ? flags.linkedEntities : [];
  const spellName = _str(flags.spellName || originEffect.name);
  const casterUuid = _str(flags.casterUuid);

  _originDebug("Tearing down Origin AE", {
    originId: originEffect.id,
    spellName,
    linkedCount: linked.length
  });

  let deletedCount = 0;
  const errors = [];

  for (const link of linked) {
    try {
      const result = await _deleteLinkedEntity(link);
      if (result) deletedCount++;
    } catch (err) {
      const msg = `Failed to delete linked ${link.type} ${link.uuid}: ${err.message}`;
      errors.push(msg);
      _originDebug("Teardown error:", msg);
    }
  }

  // Also clean up any target AEs that reference this origin but weren't in the linked list
  // (belt-and-suspenders approach for robustness)
  try {
    const orphanCount = await _cleanOrphanTargetAEs(originEffect);
    deletedCount += orphanCount;
  } catch (err) {
    errors.push(`Orphan cleanup failed: ${err.message}`);
  }

  // Emit hook
  try {
    Hooks.callAll("uesrpg.spell.ended", {
      spellUuid: _str(flags.spellUuid),
      spellName,
      casterUuid,
      originEffectId: originEffect.id,
      deletedCount,
      errors
    });
  } catch (_e) { /* no-op */ }

  if (!options.silent && deletedCount > 0) {
    try {
      ui.notifications.info(`${spellName} ended — ${deletedCount} linked effect${deletedCount > 1 ? "s" : ""} removed.`);
    } catch (_e) { /* no-op */ }
  }

  _originDebug("Teardown complete", { deletedCount, errors: errors.length });
  return { deletedCount, errors };
}

// ─── Query ───────────────────────────────────────────────────────────────────

/**
 * Find the Origin AE for a specific spell on a caster.
 *
 * @param {Actor} casterActor - The caster
 * @param {string} spellUuid - The spell UUID
 * @returns {ActiveEffect|null}
 */
export function findOriginAE(casterActor, spellUuid) {
  if (!casterActor || !spellUuid) return null;
  for (const ef of (casterActor.effects ?? [])) {
    const f = ef.flags?.[_FLAG_NS];
    if (f?.isOriginAE && _str(f.spellUuid) === _str(spellUuid)) return ef;
  }
  return null;
}

/**
 * Get all Origin AEs on an actor.
 *
 * @param {Actor} actor
 * @returns {ActiveEffect[]}
 */
export function getOriginAEs(actor) {
  if (!actor) return [];
  return Array.from(actor.effects ?? []).filter(ef =>
    ef.flags?.[_FLAG_NS]?.isOriginAE === true
  );
}

/**
 * Check if an ActiveEffect is a linked target AE (has back-link to an Origin).
 *
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
export function isLinkedTargetAE(effect) {
  const f = effect?.flags?.[_FLAG_NS];
  return Boolean(f?.originAEUuid || f?.originAEId);
}

// ─── Upkeep Contract ────────────────────────────────────────────────────────

/**
 * Record a successful upkeep refresh on the Origin AE.
 * Updates refresh counters, last-refresh timestamps, and resets duration markers.
 *
 * @param {ActiveEffect} originEffect - The Origin AE
 * @param {object} [opts]
 * @param {number} [opts.costPaid] - MP cost paid for this refresh
 * @returns {Promise<boolean>} Success
 */
export async function refreshOriginAEUpkeep(originEffect, opts = {}) {
  const flags = originEffect?.flags?.[_FLAG_NS];
  if (!flags?.isOriginAE || !flags?.hasUpkeep) return false;

  const upkeep = flags.upkeep ?? {};
  const nowTime = _num(game.time?.worldTime, 0);
  const nowRound = _num(game?.combat?.round, null);
  const refreshCount = _num(upkeep.refreshCount, 0) + 1;

  const updates = {
    [`flags.${_FLAG_NS}.upkeep.refreshCount`]: refreshCount,
    [`flags.${_FLAG_NS}.upkeep.lastRefreshWorldTime`]: nowTime,
    [`flags.${_FLAG_NS}.upkeep.lastRefreshRound`]: nowRound
  };

  // Reset Origin AE duration markers so it mirrors the refreshed target AEs
  if (game?.combat?.id) {
    updates["duration.startRound"] = _num(game.combat.round, 0);
    updates["duration.startTurn"] = _num(game.combat.turn, 0);
    updates["duration.combat"] = game.combat.id;
  }
  updates["duration.startTime"] = nowTime;
  updates["disabled"] = false;

  _originDebug("Refreshing Origin AE upkeep", {
    originId: originEffect.id,
    refreshCount,
    costPaid: _num(opts.costPaid, 0)
  });

  try {
    await _updateOriginEffect(originEffect, updates);

    Hooks.callAll("uesrpg.spell.upkeepRefreshed", {
      originEffect,
      casterUuid: _str(flags.casterUuid),
      spellUuid: _str(flags.spellUuid),
      spellName: _str(flags.spellName),
      refreshCount,
      costPaid: _num(opts.costPaid, 0)
    });

    return true;
  } catch (err) {
    console.error("UESRPG | origin-effect | Failed to refresh upkeep", err);
    return false;
  }
}

/**
 * Cancel upkeep on an Origin AE — triggers full teardown.
 * This is the preferred way to end an upkept spell: deleting the Origin AE
 * fires the `deleteActiveEffect` hook which runs `teardownOriginAE`.
 *
 * @param {ActiveEffect} originEffect - The Origin AE
 * @returns {Promise<boolean>} Success
 */
export async function cancelOriginAEUpkeep(originEffect) {
  const flags = originEffect?.flags?.[_FLAG_NS];
  if (!flags?.isOriginAE) return false;

  _originDebug("Cancelling Origin AE upkeep (triggering teardown)", {
    originId: originEffect.id,
    spellName: _str(flags.spellName)
  });

  try {
    const parent = originEffect.parent;
    if (!parent) return false;
    const existing = parent.effects?.get?.(originEffect.id);
    if (!existing) return false;

    await requestDeleteEmbeddedDocuments(parent, "ActiveEffect", [originEffect.id]);
    return true;
  } catch (err) {
    console.error("UESRPG | origin-effect | Failed to cancel upkeep", err);
    return false;
  }
}

/**
 * Find the Origin AE for an upkeep group key.
 * Group key format: `{casterUuid}::{spellUuid}::{originalCastWorldTime}`
 *
 * @param {string} groupKey - Upkeep group key
 * @returns {ActiveEffect|null}
 */
export function findOriginAEByGroupKey(groupKey) {
  if (!groupKey) return null;
  const parts = _str(groupKey).split("::");
  const casterUuid = parts[0] || "";
  const spellUuid = parts[1] || "";
  const castTime = _num(parts[2], 0);
  if (!casterUuid || !spellUuid) return null;

  const casterDoc = fromUuidSync(casterUuid);
  const casterActor = casterDoc?.documentName === "Actor" ? casterDoc : casterDoc?.actor;
  if (!casterActor) return null;

  for (const ef of (casterActor.effects ?? [])) {
    const f = ef.flags?.[_FLAG_NS];
    if (!f?.isOriginAE) continue;
    if (_str(f.spellUuid) !== spellUuid) continue;
    if (castTime > 0 && _num(f.originalCastWorldTime, 0) !== castTime) continue;
    return ef;
  }
  return null;
}

// ── Paired AE for Absorb [Characteristic] (merged from paired-ae.js) ─────────

/**
 * Check if a spell is an "Absorb [Characteristic]" spell that needs a paired buff.
 * Excludes Absorb Life and Absorb Magicka (those use damage/healing pipelines instead).
 */
function _isAbsorbCharSpell(spell) {
  if (!spell) return false;
  const name = String(spell.name ?? "").trim();
  const school = String(spell.system?.school ?? "").toLowerCase();
  if (school !== "mysticism") return false;
  if (!name.startsWith("Absorb ")) return false;
  if (name === "Absorb Life" || name === "Absorb Magicka") return false;
  return true;
}

/**
 * Build mirrored caster-buff effect data from a target debuff effect.
 * Negates all numeric change values (e.g. -5 → +5).
 */
function _buildCasterBuffData(targetEffect, spell, casterActor) {
  const changes = targetEffect.changes ?? [];
  if (!changes.length) return null;

  const mirroredChanges = changes.map(c => {
    const numVal = Number(c.value);
    const mirrorVal = Number.isFinite(numVal) ? -numVal : c.value;
    return {
      key: c.key,
      mode: c.mode,
      value: String(mirrorVal),
      priority: c.priority ?? 20
    };
  });

  const duration = targetEffect.duration
    ? foundry.utils.duplicate(targetEffect.duration)
    : {};

  const spellName = String(spell.name ?? "");
  const buffName = spellName.replace("(Drain)", "(Buff)").replace(/\s*$/, " (Buff)");

  return {
    name: buffName,
    img: targetEffect.img || spell.img,
    origin: spell.uuid,
    disabled: false,
    duration,
    changes: mirroredChanges,
    flags: {
      "uesrpg-3ev4": {
        spellEffect: true,
        pairedBuff: true,
        spellUuid: spell.uuid,
        spellName: spell.name,
        spellSchool: spell.system?.school ?? "mysticism",
        spellLevel: spell.system?.level ?? 1,
        casterUuid: casterActor.uuid,
        owner: "system",
        effectGroup: `spell.paired.${spell.id || spell.uuid}`,
        stackRule: "override",
        source: "spell-paired"
      }
    }
  };
}

/**
 * Handle `uesrpg.spell.effectApplied` — if the spell is Absorb [Char],
 * create a mirrored buff on the caster and link it to the Origin AE.
 */
async function _onPairedEffectApplied(payload) {
  const { caster, target, spell, effects, originEffect } = payload;

  if (!_isAbsorbCharSpell(spell)) return;
  if (!caster || !target || !effects?.length) return;
  if (!game.user.isGM) return;

  _originDebug(`Absorb paired AE trigger: ${spell.name}`, {
    caster: caster.name,
    target: target.name,
    effectCount: effects.length
  });

  for (const targetEffect of effects) {
    const buffData = _buildCasterBuffData(targetEffect, spell, caster);
    if (!buffData) continue;

    try {
      let created;
      if (caster.isOwner) {
        const results = await caster.createEmbeddedDocuments("ActiveEffect", [buffData]);
        created = results?.[0] ?? null;
      } else {
        const results = await requestCreateEmbeddedDocuments(caster, "ActiveEffect", [buffData]);
        created = Array.isArray(results) ? results[0] : results;
      }

      if (!created) {
        _originDebug("Failed to create caster buff AE (null result)");
        continue;
      }

      _originDebug(`Created caster buff: ${created.name}`, { id: created.id });

      const origin = originEffect ?? findOriginAE(caster, spell.uuid);
      if (origin) {
        await registerLinkedEntity(origin, {
          type: "casterBuff",
          uuid: created.uuid ?? `${caster.uuid}.ActiveEffect.${created.id}`,
          actorUuid: caster.uuid,
          label: `${created.name} on ${caster.name}`
        });
        _originDebug("Registered caster buff with Origin AE", { originId: origin.id });
      }
    } catch (err) {
      console.error("[UESRPG][PairedAE] Failed to create caster buff", err);
    }
  }
}

// ─── Hook Registration ──────────────────────────────────────────────────────

let _hooksInstalled = false;

/**
 * Install the deletion hook that triggers teardown when an Origin AE is removed,
 * and the paired AE hook for Absorb [Characteristic] spells.
 * Must be called once during system initialization.
 */
export function initializeOriginAELifecycle() {
  if (_hooksInstalled) return;
  _hooksInstalled = true;

  // When any ActiveEffect is deleted, check if it's an Origin AE and tear down linked entities
  Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
    // Only the GM processes teardowns to avoid race conditions
    if (!game.user?.isGM) return;

    const flags = effect?.flags?.[_FLAG_NS];
    if (!flags?.isOriginAE) return;

    _originDebug("Origin AE deletion detected, triggering teardown", {
      effectId: effect.id,
      spellName: flags.spellName
    });

    await teardownOriginAE(effect, { silent: false });
  });

  // Paired AE hook for Absorb [Characteristic] spells
  Hooks.on("uesrpg.spell.effectApplied", _onPairedEffectApplied);

  _originDebug("Origin AE lifecycle hooks installed (incl. paired AE)");
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Build a duration object for the Origin AE based on spell data.
 * @param {Item} spell
 * @returns {object}
 */
function _buildOriginDuration(spell) {
  const dur = spell?.system?.duration ?? {};
  const value = _num(dur.value, 0);
  const unit = _str(dur.unit || "rounds").toLowerCase();
  const nowTime = _num(game.time?.worldTime, 0);
  const roundTime = _num(CONFIG.time?.roundTime, 6);

  if (unit === "instant" || value === 0) {
    // For upkeep spells with no listed duration, treat as 1 round
    if (spell.system?.hasUpkeep) {
      return {
        startTime: nowTime,
        seconds: roundTime,
        rounds: 1,
        turns: 0,
        combat: game?.combat?.id ?? null,
        startRound: _num(game?.combat?.round, 0),
        startTurn: _num(game?.combat?.turn, 0)
      };
    }
    return { startTime: nowTime, seconds: 0, rounds: 0, turns: 0 };
  }

  if (unit === "permanent") {
    return { startTime: nowTime, seconds: Infinity, rounds: Infinity, turns: 0 };
  }

  let seconds = 0;
  let rounds = 0;
  switch (unit) {
    case "rounds":
      rounds = value;
      seconds = value * roundTime;
      break;
    case "minutes":
      rounds = value * 10;
      seconds = value * 60;
      break;
    case "hours":
      rounds = value * 600;
      seconds = value * 3600;
      break;
    case "days":
      rounds = value * 14400;
      seconds = value * 86400;
      break;
  }

  const result = {
    startTime: nowTime,
    seconds,
    rounds,
    turns: 0
  };

  // Add combat markers if in combat
  if (game?.combat?.id) {
    result.combat = game.combat.id;
    result.startRound = _num(game.combat.round, 0);
    result.startTurn = _num(game.combat.turn, 0);
  }

  return result;
}

/**
 * Delete a single linked entity by its link descriptor.
 * @param {object} link
 * @returns {Promise<boolean>}
 */
async function _deleteLinkedEntity(link) {
  if (!link?.uuid) return false;

  try {
    const doc = fromUuidSync(link.uuid);
    if (!doc) return false; // Already deleted

    switch (link.type) {
      case "targetAE": {
        const parent = doc.parent;
        if (!parent) return false;
        // Verify the effect still exists on the parent
        const existing = parent.effects?.get?.(doc.id);
        if (!existing) return false;
        await requestDeleteEmbeddedDocuments(parent, "ActiveEffect", [doc.id]);
        return true;
      }
      case "template": {
        // MeasuredTemplate deletion
        if (doc.documentName === "MeasuredTemplate") {
          const scene = doc.parent;
          if (scene) {
            await scene.deleteEmbeddedDocuments("MeasuredTemplate", [doc.id]);
            return true;
          }
        }
        return false;
      }
      case "summon": {
        // Token deletion for summoned creatures
        if (doc.documentName === "Token" || doc.documentName === "TokenDocument") {
          const scene = doc.parent;
          if (scene) {
            await scene.deleteEmbeddedDocuments("Token", [doc.id]);
            return true;
          }
        }
        return false;
      }
      case "casterBuff": {
        // ActiveEffect on the caster (e.g. Absorb [Char] paired buff)
        const buffParent = doc.parent;
        if (!buffParent) return false;
        const existingBuff = buffParent.effects?.get?.(doc.id);
        if (!existingBuff) return false;
        await requestDeleteEmbeddedDocuments(buffParent, "ActiveEffect", [doc.id]);
        return true;
      }
      case "boundItem": {
        // Temporary item on the caster (e.g. Conjure [Weapon/Armor])
        const itemParent = doc.parent;
        if (!itemParent) return false;
        const existingItem = itemParent.items?.get?.(doc.id);
        if (!existingItem) return false;
        await requestDeleteEmbeddedDocuments(itemParent, "Item", [doc.id]);
        return true;
      }
      default:
        return false;
    }
  } catch (err) {
    const msg = _str(err?.message);
    // "does not exist" errors mean entity was already cleaned up
    if (msg.includes("does not exist") || msg.includes("No Document")) return false;
    throw err;
  }
}

/**
 * Clean up orphan target AEs that reference the origin but weren't in the linked list.
 * Scans both world actors AND synthetic (unlinked) token actors to ensure
 * effects on canvas tokens are properly cleaned up.
 *
 * @param {ActiveEffect} originEffect
 * @returns {Promise<number>} Number of orphans deleted
 */
async function _cleanOrphanTargetAEs(originEffect) {
  const flags = originEffect?.flags?.[_FLAG_NS];
  if (!flags) return 0;

  const spellUuid = _str(flags.spellUuid);
  const castTime = _num(flags.originalCastWorldTime, 0);
  const casterUuid = _str(flags.casterUuid);
  if (!spellUuid || !casterUuid) return 0;

  let count = 0;

  // Collect all actors to scan: world actors + synthetic token actors
  /** @type {Actor[]} */
  const actorsToScan = [...(game.actors?.contents ?? [])];

  // Add synthetic (unlinked) token actors — these have their own effect deltas
  // and are NOT covered by the world actor scan.
  if (canvas?.tokens?.placeables) {
    const worldActorIds = new Set(actorsToScan.map(a => a.id));
    for (const token of canvas.tokens.placeables) {
      const actor = token.actor;
      if (!actor) continue;
      // Linked tokens share the world actor (already in the list).
      // Unlinked (synthetic) tokens have separate actors.
      if (token.document?.actorLink) continue;
      // Deduplicate: synthetic actors share .id with their base actor,
      // but have unique .uuid. We check by uuid to avoid re-scanning.
      if (!actorsToScan.some(a => a.uuid === actor.uuid)) {
        actorsToScan.push(actor);
      }
    }
  }

  for (const actor of actorsToScan) {
    const toDelete = [];
    for (const ef of (actor.effects ?? [])) {
      const f = ef.flags?.[_FLAG_NS];
      if (!f?.spellEffect) continue;
      if (f.isOriginAE) continue; // Skip other origin AEs
      if (_str(f.spellUuid) !== spellUuid) continue;
      if (_str(f.casterUuid) !== casterUuid) continue;
      if (castTime > 0 && _num(f.originalCastWorldTime, 0) !== castTime) continue;
      toDelete.push(ef.id);
    }
    if (toDelete.length) {
      try {
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", toDelete);
        count += toDelete.length;
      } catch (_e) {
        // best-effort
      }
    }
  }

  return count;
}

/**
 * Update an Origin AE safely.
 * @param {ActiveEffect} effect
 * @param {object} updates
 * @returns {Promise<boolean>}
 */
async function _updateOriginEffect(effect, updates) {
  if (!effect || !updates) return false;
  try {
    const parent = effect.parent;
    if (!parent) return false;
    const existing = parent.effects?.get?.(effect.id);
    if (!existing) return false;

    if (game.user?.isGM || existing.isOwner) {
      await existing.update(updates);
      return true;
    }
    return await requestUpdateDocument(effect, updates);
  } catch (err) {
    console.error("UESRPG | origin-effect | Failed to update Origin AE", err);
    return false;
  }
}
