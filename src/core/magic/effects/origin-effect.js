import { prepareSpellStrengthForUse } from "../opposed/spell-helpers.js";
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
 *    target snapshot, and a list of linked entity UUIDs (target AEs, regions, summons).
 *  - Ending/removing the Origin AE deterministically cleans all linked entities.
 *  - Teardown is idempotent — safe to call multiple times.
 *
 * v14-safe lifecycle contract:
 *  - Origin AEs are deterministic teardown trackers on the caster.
 *  - Linked cleanup must stay idempotent and tolerate already-missing docs.
 */

import { requestUpdateDocument, requestCreateEmbeddedDocuments, requestAtomicUpdateDocument } from "../../../utils/authority-proxy.js";
import { _num, _str, createDebugLogger } from "../_primitives.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { buildSpellExpirationAnchor } from "../../../utils/document-resolution.js";
import { isMissingDocError, safeDeleteEmbeddedDocument } from "../../../utils/ae-helpers.js";
import { getEffectChanges } from "../../../utils/compat.js";
import { createUuidResolver, resolveUuidSync } from "../../../utils/uuid-cache.js";
import { getLinkedAreaEntities } from "../region-links.js";
import { buildGenericAEData } from "../../active-effects/modifier-evaluator.js";
import { buildSpellEffectMetadataFlags, parseUpkeepGroupKey } from "./spell-effect-metadata.js";
import {
  buildSpellActiveEffectDuration,
  buildSpellActiveEffectDurationFromValues,
  extendEffectDurationByCanonicalPeriod,
  SPELL_EFFECT_DURATION_FLAG_KEY
} from "./spell-effect-duration.js";
import { getSpellCost, getSpellLevel } from "../magicka-utils.js";

import { isActiveGMUser } from "../../../utils/users.js";
import { AUTHORITY_RESULT_CODES, registerAuthorityIntentCommand, registerAuthorityIntentService, requestAuthorityIntent } from "../../../utils/authority-intents.js";
import { reconcileSpellBuffers } from "../../../hooks/init/features/register-buffer-cleanup.js";
import { MagicTimekeeping } from "../timekeeping-helper.js";
import { measurePerfStage } from "../../../utils/perf-tracker.js";
import { createChatOutcome } from "../../config/outcome-application-policy.js";
import { persistChatOutcomes } from "../../../application/combat/chat-outcome-application-service.js";
import { escapeHtml } from "../../../utils/html.js";
import { captureItemOutcomeContext, restoreOutcomeItem } from "../../../utils/item-outcome-snapshot.js";

const _FLAG_NS = FLAG_SCOPE;
const _teardowns = new Map();
const _cancellations = new Map();
const _hookTeardownFailures = [];

export async function executeChatOutcome(outcome, context) {
  const casterActor = resolveUuidSync(outcome.sourceActorUuid);
  const originEffect = resolveUuidSync(outcome.payload.originEffectUuid);
  if (!casterActor || originEffect?.parent?.uuid !== casterActor.uuid) {
    throw Object.assign(new Error("The stored spell origin is no longer available."), { committed: false });
  }
  const spell = restoreOutcomeItem(outcome.payload.spellSnapshot, outcome.payload.spellSnapshotContext);
  const { settleSpellOwnedStages } = await import("../spell-runtime.js");
  return context.stage("originConsequences", () => settleSpellOwnedStages({ casterActor, spell, originEffect,
    targetActors: outcome.payload.targetUuids.map(uuid => resolveUuidSync(uuid)), options: outcome.payload.options,
  }, { kind: "origin", claimKey: `origin:${outcome.id}` }), {
    documents: [casterActor, originEffect, ...outcome.payload.targetUuids.map(uuid => resolveUuidSync(uuid))], requiresGM: true,
  });
}

async function queueOriginConsequences(casterActor, spell, originEffect, options) {
  const mode = String(spell.system?.engine?.conjure?.mode ?? "none");
  const bound = ["weapon", "armor"].includes(spell.flags?.[_FLAG_NS]?.conjureType);
  if (!["item", "creature"].includes(mode) && !bound) return { operationCount: 0, failed: [], handledDomains: [] };
  const { resolveConjureTargets, prepareConjurationOptions } = await import("../conjuration/conjuration-runtime.js");
  const targets = mode === "item" ? resolveConjureTargets(casterActor, originEffect) : [casterActor];
  const storedOptions = { ...options };
  delete storedOptions.message;
  const preparedOptions = { ...storedOptions, ...await prepareConjurationOptions(casterActor, spell, originEffect) };
  const recipients = bound ? [casterActor] : targets;
  const entries = recipients.map(target => createChatOutcome({ adapter: "magic.origin", kind: "effect",
    sourceActorUuid: casterActor.uuid, targetUuid: target.uuid, label: spell.name,
    payload: { originEffectUuid: originEffect.uuid, spellSnapshot: spell.toObject(), spellSnapshotContext: captureItemOutcomeContext(spell), options: preparedOptions,
      targetUuids: (bound ? targets : [target]).map(actor => actor.uuid) } }));
  await persistChatOutcomes({ actor: casterActor, entries,
    content: `<div class="uesrpg"><b>${escapeHtml(spell.name)}</b></div>` });
  return { operationCount: 0, committed: [], failed: [], pending: true, handledDomains: ["conjuration", "boundItem"] };
}

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
 * @param {object|null} [options.castSource] - Optional cast-source metadata
 * @param {string|null} [options.casterTokenUuid] - Token UUID for precise combat anchoring
 * @returns {Promise<ActiveEffect|null>} The created Origin AE, or null on failure
 */
export async function createOriginAE(casterActor, spell, options = {}) {
  if (!casterActor || !spell) return null;
  if (!spellRequiresOriginAE(spell)) return null;

  const conjureMode = String(spell.system?.engine?.conjure?.mode ?? "none");
  const legacyConjure = spell.flags?.[_FLAG_NS]?.conjureType;
  if (["item", "summon", "creature"].includes(conjureMode) || ["weapon", "armor"].includes(legacyConjure)) {
    const strengthData = { attacker: { castContext: options.castContext, spellOptions: options.spellOptions,
      scalingChoices: options.scalingChoices, result: { isCriticalSuccess: Boolean(options.isCritical) } } };
    options = { ...options, castContext: await prepareSpellStrengthForUse({
      data: strengthData, attacker: casterActor, spell, message: options.message,
    }) };
  }

  const castWorldTime = _num(options.castWorldTime, _num(game.time?.worldTime, 0));
  const expirationAnchor = buildSpellExpirationAnchor({
    casterActor,
    casterTokenUuid: options.casterTokenUuid ?? null,
    combat: game?.combat ?? null
  });
  _originDebug("Created origin expiration anchor", {
    spell: spell?.name ?? null,
    caster: casterActor?.name ?? null,
    round: game?.combat?.round ?? null,
    turn: game?.combat?.turn ?? null,
    anchor: expirationAnchor
  });

  // Build duration for the Origin AE (mirrors what spell-effects.js does for target AEs)
  const durationInfo = options.durationOverride
    ? buildSpellActiveEffectDurationFromValues({
        value: options.durationOverride.value,
        unit: options.durationOverride.unit,
        units: options.durationOverride.units,
        expiry: options.durationOverride.expiry,
        seconds: options.durationOverride.seconds,
        rounds: options.durationOverride.rounds,
        turns: options.durationOverride.turns,
        hasUpkeep: Boolean(spell.system?.hasUpkeep)
      })
    : buildSpellActiveEffectDuration({
        actor: casterActor,
        casterActor,
        spell,
        spellOptions: options.spellOptions ?? null,
        scalingChoices: options.scalingChoices ?? null,
        castContext: options.castContext ?? null,
        hasUpkeep: Boolean(spell.system?.hasUpkeep)
      });
  const canonicalDuration = durationInfo.canonicalDuration;
  const duration = durationInfo.liveDuration;
  const castLevel = Number(options?.castContext?.castLevel ?? options?.scalingChoices?.level ?? null) || null;
  const resolvedCost = _num(options.costPaid, _num(getSpellCost(spell, castLevel), _num(spell.system?.cost, 0)));

  const originGroup = `spell.origin.${spell.id ?? spell.uuid}`;
  const effectData = buildGenericAEData({
    source: "spell",
    stack: {
      policy: "replace",
      group: originGroup,
      max: null,
      strengthKey: null,
    },
    name: `[Origin] ${spell.name}`,
    img: spell.img,
    origin: spell.uuid,
    disabled: false,
    duration,
    flags: {
      [_FLAG_NS]: {
        ...buildSpellEffectMetadataFlags({
          casterActor,
          spell,
          actualCost: resolvedCost,
          costPaid: resolvedCost,
          originalCastWorldTime: castWorldTime,
          durationData: canonicalDuration,
          spellOptions: options.spellOptions ?? null,
          scalingChoices: options.scalingChoices ?? null,
          castContext: options.castContext ?? null,
          castSource: options.castSource ?? null,
          itemCastContext: options.itemCastContext ?? null,
          magickaSpend: options.magickaSpend ?? null,
          casterTokenUuid: options.casterTokenUuid ?? null,
          targetUuids: Array.isArray(options.targetUuids) ? [...options.targetUuids] : []
        }),
        isOriginAE: true,
        spellEffect: true,
        [SPELL_EFFECT_DURATION_FLAG_KEY]: durationInfo.spellEffectDuration,
        expirationAnchor,
        linkedEntities: [], // Will be populated as target AEs / regions / summons are created
        hasUpkeep: Boolean(spell.system?.hasUpkeep),
        upkeep: Boolean(spell.system?.hasUpkeep) ? {
          originalCost: resolvedCost,
          refreshCount: 0,
          lastRefreshWorldTime: null,
          lastRefreshRound: null,
          targetLock: Array.isArray(options.targetUuids) ? [...options.targetUuids] : [],
          noListedDuration: Boolean(durationInfo.noListedDuration)
        } : null,
        owner: "system",
        source: "spell-origin"
      }
    },
    changes: []
  });

  _originDebug("Creating Origin AE", {
    caster: casterActor.name,
    spell: spell.name,
    flags: effectData.flags[_FLAG_NS]
  });

  try {
    const results = await requestCreateEmbeddedDocuments(casterActor, "ActiveEffect", [effectData]);
    const created = Array.isArray(results) ? results[0] : (results ?? null);
    if (options.strict && !created) throw new Error("Origin effect creation was not confirmed.");

    if (created) {
      _originDebug("Origin AE created successfully", { id: created.id, uuid: created.uuid });

      let completion;
      try { completion = await queueOriginConsequences(casterActor, spell, created, options); }
      catch (error) { completion = { operationCount: 0, committed: [], handledDomains: ["conjuration", "boundItem"], failed: [{ key: "settlement", error: String(error.message ?? error) }] }; }
      Hooks.callAll("uesrpg.spell.originCreated", { casterActor, spell, originEffect: created, options,
        handledDomains: completion.handledDomains, completion });
      if (completion.failed.length) {
        const error = new Error("Origin creation committed but its owned consequences only partially completed.");
        error.committed = true;
        error.originEffect = created;
        error.aftermathSummary = completion;
        if (options.strict) throw error;
        ui.notifications?.warn?.(error.message);
      }
    }

    return created;
  } catch (err) {
    console.error("UESRPG | origin-effect | Failed to create Origin AE", err);
    if (options.strict) throw err;
    return err.originEffect ?? null;
  }
}

// ─── Linking ─────────────────────────────────────────────────────────────────

/**
 * Register a linked entity (target AE, region, summon) with an Origin AE.
 *
 * @param {ActiveEffect} originEffect - The Origin AE on the caster
 * @param {object} link - Link descriptor
 * @param {string} link.type - "targetAE" | "region" | "template" | "summon"
 * @param {string} link.uuid - UUID of the linked entity
 * @param {string} [link.actorUuid] - UUID of the target actor (for targetAE type)
 * @param {string} [link.label] - Human-readable label
 * @returns {Promise<boolean>} Success
 */
export async function registerLinkedEntity(originEffect, link, { strict = false } = {}) {
  if (!originEffect || !link?.uuid || !link?.type) return false;

  const flags = originEffect.flags?.[_FLAG_NS];
  if (!flags?.isOriginAE) return false;

  let needed = false;
  let calculated = false;
  const updated = await requestAtomicUpdateDocument(originEffect, fresh => {
    calculated = true;
    const existing = Array.isArray(fresh.flags?.[_FLAG_NS]?.linkedEntities) ? [...fresh.flags[_FLAG_NS].linkedEntities] : [];
    needed = !existing.some(entry => entry.uuid === link.uuid);
    if (!needed) return {};
    existing.push({ type: _str(link.type), uuid: _str(link.uuid), actorUuid: _str(link.actorUuid), label: _str(link.label), registeredAt: Date.now() });
    return { [`flags.${_FLAG_NS}.linkedEntities`]: existing };
  }, { render: false, perfKind: "spellLifecycle" });
  return strict ? Boolean(updated || (calculated && !needed)) : true;
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
export async function registerTargetAEs(originEffect, targetEffects, targetActor, { strict = false } = {}) {
  if (!originEffect || !targetEffects?.length) return;
  for (const te of targetEffects) {
    const registered = await registerLinkedEntity(originEffect, {
      type: "targetAE",
      uuid: te.uuid ?? `${targetActor.uuid}.ActiveEffect.${te.id}`,
      actorUuid: targetActor.uuid,
      label: `${te.name} on ${targetActor.name}`
    }, { strict });
    if (strict && !registered) throw new Error("Spell effect origin registration was not confirmed.");
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
export function teardownOriginAE(originEffect, options = {}) {
  if (!originEffect?.flags?.[_FLAG_NS]?.isOriginAE) return Promise.resolve({ deletedCount: 0, errors: [] });
  const key = originEffect.uuid;
  if (_teardowns.has(key)) return _teardowns.get(key);
  const promise = measurePerfStage("spellLifecycle", "teardown", { originUuid: key }, () => _teardownOriginAE(originEffect, options))
    .finally(() => _teardowns.delete(key));
  _teardowns.set(key, promise);
  return promise;
}

/** Join cleanup initiated by native deletion hooks during an expiry sweep. */
export async function settlePendingOriginTeardowns() {
  while (_teardowns.size) await Promise.all(Array.from(_teardowns.values()));
  const errors = _hookTeardownFailures.splice(0);
  if (errors.length) throw new Error(errors.join("; "));
}

async function _teardownOriginAE(originEffect, options) {
  const flags = originEffect.flags[_FLAG_NS];
  const errors = [];
  let deletedCount = 0;
  const links = new Map();
  for (const link of [...(flags.linkedEntities ?? []), ...getLinkedAreaEntities(originEffect)]) {
    if (link?.uuid) links.set(link.uuid, link);
  }
  for (const actor of MagicTimekeeping.collectRelevantActors()) {
    for (const effect of (actor.effects ?? [])) {
      const f = effect.flags?.[_FLAG_NS];
      if (!f?.spellEffect || f.isOriginAE) continue;
      if (f.originAEUuid ? f.originAEUuid !== originEffect.uuid :
        (_str(f.spellUuid) !== _str(flags.spellUuid) || _str(f.casterUuid) !== _str(flags.casterUuid) ||
          (_num(flags.originalCastWorldTime, 0) > 0 && _num(f.originalCastWorldTime, 0) !== _num(flags.originalCastWorldTime, 0)))) continue;
      links.set(effect.uuid, { type: "targetAE", uuid: effect.uuid });
    }
  }
  const buffers = new Map();
  for (const link of links.values()) {
    const doc = resolveUuidSync(link.uuid);
    const f = doc?.flags?.[_FLAG_NS];
    if (f?.bufferApplied && doc.parent?.documentName === "Actor") {
      const entry = buffers.get(doc.parent.uuid) ?? { actor: doc.parent, types: new Set() };
      entry.types.add(f.bufferType);
      buffers.set(doc.parent.uuid, entry);
    }
    try {
      const present = Boolean(doc);
      if (!await _deleteLinkedEntity(link)) throw new Error("Deletion was not confirmed.");
      if (present) deletedCount++;
    } catch (error) { errors.push(`Linked ${link.type} ${link.uuid}: ${error.message}`); }
  }
  for (const { actor, types } of buffers.values()) {
    try { await reconcileSpellBuffers(actor, types, { strict: true }); }
    catch (error) { errors.push(error.message); }
  }
  const source = flags.castSource;
  if (source?.type === "enchantment") {
    const item = resolveUuidSync(_str(source.enchantedItemUuid));
    const lane = _str(source.sourceLane || "workshop").toLowerCase();
    const path = lane === "extension" ? "itemSpellcasting.activeUpkeepSlotId" : "enchanting.cast.activeUpkeepSpellId";
    if (item?.documentName === "Item") {
      let needed = false;
      let calculated = false;
      const ok = await requestAtomicUpdateDocument(item, fresh => {
        calculated = true;
        needed = _str(foundry.utils.getProperty(fresh.flags?.[_FLAG_NS], path)) === _str(source.enchantSpellSlotId);
        return needed ? { [`flags.${_FLAG_NS}.${path}`]: null } : {};
      }, { render: false, perfKind: "spellLifecycle" });
      if (!ok && (!calculated || needed)) errors.push("Enchantment upkeep pointer cleanup was not confirmed.");
    }
  }
  Hooks.callAll("uesrpg.spell.ended", { spellUuid: _str(flags.spellUuid), spellName: _str(flags.spellName || originEffect.name),
    casterUuid: _str(flags.casterUuid), originEffectId: originEffect.id, deletedCount, errors,
    completion: { status: errors.length ? "partial" : "completed" } });
  if (errors.length && !options.silent) ui.notifications?.warn?.("Spell ended with unresolved linked cleanup.");
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

export function findOriginAEByEnchantmentSlot(casterActor, { itemUuid = "", slotId = "", sourceLane = "workshop" } = {}) {
  if (!casterActor || !itemUuid || !slotId) return null;
  const wantedLane = _str(sourceLane || "workshop").toLowerCase();
  for (const effect of (casterActor.effects ?? [])) {
    const flags = effect?.flags?.[_FLAG_NS];
    const castSource = flags?.castSource ?? null;
    if (!flags?.isOriginAE || castSource?.type !== "enchantment") continue;
    if (_str(castSource.enchantedItemUuid) !== _str(itemUuid)) continue;
    if (_str(castSource.enchantSpellSlotId) !== _str(slotId)) continue;
    if (_str(castSource.sourceLane || "workshop").toLowerCase() !== wantedLane) continue;
    return effect;
  }
  return null;
}

export async function replaceEnchantmentUpkeepOrigin(casterActor, { item, sourceLane = "workshop", slotId = "", excludeOriginUuid = "", strict = false } = {}) {
  if (!casterActor || !item || !slotId) return false;
  const lane = _str(sourceLane || "workshop").toLowerCase();
  const upkeepPath = lane === "extension"
    ? `flags.${_FLAG_NS}.itemSpellcasting.activeUpkeepSlotId`
    : `flags.${_FLAG_NS}.enchanting.cast.activeUpkeepSpellId`;
  const excluded = _str(excludeOriginUuid);
  for (const effect of getOriginAEs(casterActor)) {
    const castSource = effect?.flags?.[_FLAG_NS]?.castSource ?? null;
    if (castSource?.type !== "enchantment") continue;
    if (_str(castSource.enchantedItemUuid) !== _str(item.uuid)) continue;
    if (_str(castSource.enchantSpellSlotId) !== _str(slotId)) continue;
    if (_str(castSource.sourceLane || "workshop").toLowerCase() !== lane) continue;
    if (excluded && (_str(effect.uuid) === excluded || _str(effect.id) === excluded)) continue;
    if (!await cancelOriginAEUpkeep(effect, { strict })) return false;
  }
  const confirmed = await requestUpdateDocument(item, { [upkeepPath]: slotId }, { render: false });
  if (strict && !confirmed) throw new Error("Enchantment upkeep pointer was not confirmed.");
  return confirmed;
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
    [`flags.${_FLAG_NS}.upkeep.lastRefreshRound`]: nowRound,
    [`flags.${_FLAG_NS}.upkeepAwaiting`]: null,
    [`flags.${_FLAG_NS}.upkeepPendingNativeExtension`]: null,
    [`flags.${_FLAG_NS}.upkeepPromptMessageId`]: null,
    [`flags.${_FLAG_NS}.upkeepPromptSignature`]: null,
    [`flags.${_FLAG_NS}.upkeepPromptedAtWorldTime`]: null,
    [`flags.${_FLAG_NS}.upkeepPromptedEndTime`]: null,
    [`flags.${_FLAG_NS}.upkeepPromptedCombatRound`]: null,
    [`flags.${_FLAG_NS}.upkeepPromptedCombatTurn`]: null,
    [`flags.${_FLAG_NS}.upkeepBoundaryMode`]: null,
    [`flags.${_FLAG_NS}.upkeepBoundaryEndTime`]: null,
    [`flags.${_FLAG_NS}.upkeepBoundaryEndRound`]: null,
    [`flags.${_FLAG_NS}.upkeepBoundaryEndTurn`]: null,
    [`flags.${_FLAG_NS}.upkeepPendingGraceExtension`]: null,
    [`flags.${_FLAG_NS}.expiredAtWorldTime`]: null,
    [`flags.${_FLAG_NS}.expiredAtCombatRound`]: null,
    [`flags.${_FLAG_NS}.expirationAnchor`]: buildSpellExpirationAnchor({
      casterActor: originEffect.parent,
      casterTokenUuid: flags?.expirationAnchor?.casterTokenUuid ?? null,
      combat: game?.combat ?? null,
      existing: flags?.expirationAnchor ?? null
    })
  };
  _originDebug("Normalized origin upkeep anchor", {
    originId: originEffect?.id ?? null,
    spellName: _str(flags?.spellName),
    casterUuid: _str(flags?.casterUuid),
    round: game?.combat?.round ?? null,
    turn: game?.combat?.turn ?? null,
    anchor: updates[`flags.${_FLAG_NS}.expirationAnchor`]
  });

  const canonical = flags?.[SPELL_EFFECT_DURATION_FLAG_KEY] ?? null;
  const durationExtension = extendEffectDurationByCanonicalPeriod(originEffect, canonical);
  if (durationExtension) Object.assign(updates, durationExtension);
  updates["disabled"] = false;
  updates[`flags.${_FLAG_NS}.ae.suppressed.expired`] = false;
  updates[`flags.${_FLAG_NS}.ae.suppressed.atWorldTime`] = null;
  updates[`flags.${_FLAG_NS}.ae.suppressed.atCombatRound`] = null;
  updates[`flags.${_FLAG_NS}.ae.suppressed.reason`] = null;
  updates[`flags.${_FLAG_NS}.durationStartTime`] = nowTime;
  updates[`flags.${_FLAG_NS}.durationStartRound`] = null;
  updates[`flags.${_FLAG_NS}.durationStartTurn`] = null;

  _originDebug("Refreshing Origin AE upkeep", {
    originId: originEffect.id,
    refreshCount,
    costPaid: _num(opts.costPaid, 0)
  });

  try {
    if (!await _updateOriginEffect(originEffect, updates, { strict: true })) return false;

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
export function cancelOriginAEUpkeep(originEffect, { strict = false } = {}) {
  const complete = pending => strict ? pending.then(ok => {
    if (!ok) throw new Error("Spell cancellation did not completely settle. Review the surviving entities before repeating the action.");
    return true;
  }) : pending;
  if (!originEffect?.flags?.[_FLAG_NS]?.isOriginAE) return complete(Promise.resolve(false));
  const key = originEffect.uuid;
  if (_cancellations.has(key)) return complete(_cancellations.get(key));
  const promise = (async () => {
    if (!isActiveGMUser(game.user)) {
      const result = await requestAuthorityIntent("spell.cancelOrigin", { originUuid: key, casterUuid: originEffect.parent?.uuid }, { timeout: 60_000 });
      return result?.ok === true;
    }
    const parent = originEffect.parent;
    if (!parent) return false;
    const live = parent.effects?.get?.(originEffect.id);
    if (live) {
      const deleted = await safeDeleteEmbeddedDocument(parent, "ActiveEffect", live.id, {
        context: "UESRPG | cancel spell origin",
        deleteOptions: { uesrpgExpirationSweep: true, uesrpgOwnedTeardown: true }
      });
      if (!deleted && parent.effects?.has?.(live.id)) return false;
    }
    const result = await teardownOriginAE(live ?? originEffect);
    return result.errors.length === 0;
  })().catch(error => { console.error("UESRPG | Origin cancellation failed", error); return false; })
    .finally(() => _cancellations.delete(key));
  _cancellations.set(key, promise);
  return complete(promise);
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
  const { casterUuid, casterTokenUuid, spellUuid, originalCastWorldTime: castTime } = parseUpkeepGroupKey(groupKey);
  if (!casterUuid || !spellUuid) return null;

  const casterDoc = resolveUuidSync(casterUuid);
  const casterActor = casterDoc?.documentName === "Actor" ? casterDoc : casterDoc?.actor;
  if (!casterActor) return null;

  for (const ef of (casterActor.effects ?? [])) {
    const f = ef.flags?.[_FLAG_NS];
    if (!f?.isOriginAE) continue;
    if (_str(f.spellUuid) !== spellUuid) continue;
    if (casterTokenUuid && _str(f.casterTokenUuid) !== casterTokenUuid) continue;
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
  const changes = getEffectChanges(targetEffect);
  if (!changes.length) return null;

  const mirroredChanges = changes.map(c => {
    const numVal = Number(c.value);
    const mirrorVal = Number.isFinite(numVal) ? -numVal : c.value;
    return {
      key: c.key,
      type: c.type,
      value: String(mirrorVal),
      priority: c.priority ?? 20
    };
  });

  const duration = targetEffect.duration
    ? foundry.utils.deepClone(targetEffect.duration)
    : {};
  const durationValue = Number(duration?.value);
  const durationUnits = String(duration?.units ?? "");

  const spellName = String(spell.name ?? "");
  const buffName = spellName.replace("(Drain)", "(Buff)").replace(/\s*$/, " (Buff)");

  const pairedGroup = `spell.paired.${spell.id || spell.uuid}`;
  const targetFlags = targetEffect?.flags?.[_FLAG_NS] ?? {};
  const pairedSourceTargetUuids = Array.isArray(targetFlags.targetUuids)
    ? foundry.utils.deepClone(targetFlags.targetUuids)
    : [];

  return buildGenericAEData({
    source: "spell",
    stack: {
      policy: "replace",
      group: pairedGroup,
      max: null,
      strengthKey: null,
    },
    name: buffName,
    img: targetEffect.img || spell.img,
    origin: spell.uuid,
    disabled: false,
    duration,
    flags: {
      [_FLAG_NS]: {
        spellEffectMetadataVersion: targetFlags.spellEffectMetadataVersion ?? 1,
        spellEffectMetadataTier: targetFlags.spellEffectMetadataTier ?? 2,
        spellEffect: true,
        [SPELL_EFFECT_DURATION_FLAG_KEY]: foundry.utils.deepClone(targetFlags[SPELL_EFFECT_DURATION_FLAG_KEY] ?? null),
        pairedBuff: true,
        spellUuid: spell.uuid,
        spellName: spell.name,
        spellSchool: targetFlags.spellSchool ?? spell.system?.school ?? "mysticism",
        spellLevel: targetFlags.spellLevel ?? getSpellLevel(spell) ?? 1,
        castLevel: targetFlags.castLevel ?? targetFlags.spellLevel ?? getSpellLevel(spell) ?? 1,
        hasHigherCastLevel: Boolean(targetFlags.hasHigherCastLevel),
        spellStrengthValue: targetFlags.spellStrengthValue ?? null,
        casterUuid: casterActor.uuid,
        casterTokenUuid: targetFlags.casterTokenUuid ?? null,
        actualCost: targetFlags.actualCost ?? null,
        costPaid: targetFlags.costPaid ?? targetFlags.actualCost ?? null,
        originalCastWorldTime: targetFlags.originalCastWorldTime ?? null,
        durationSeconds: targetFlags.durationSeconds
          ?? (durationUnits === "seconds" && Number.isFinite(durationValue) ? durationValue : null),
        durationRounds: targetFlags.durationRounds
          ?? (durationUnits === "rounds" && Number.isFinite(durationValue) ? durationValue : null),
        targetUuids: [casterActor.uuid],
        pairedSourceTargetUuids,
        upkeepGroupKey: targetFlags.upkeepGroupKey ?? null,
        castContext: foundry.utils.deepClone(targetFlags.castContext ?? null),
        spellOptions: foundry.utils.deepClone(targetFlags.spellOptions ?? null),
        scalingChoices: foundry.utils.deepClone(targetFlags.scalingChoices ?? null),
        castSource: foundry.utils.deepClone(targetFlags.castSource ?? null),
        itemCastContext: foundry.utils.deepClone(targetFlags.itemCastContext ?? null),
        magickaSpend: foundry.utils.deepClone(targetFlags.magickaSpend ?? null),
        castSourceType: targetFlags.castSourceType ?? "spell",
        castSourceCostMode: targetFlags.castSourceCostMode ?? null,
        resourceMode: targetFlags.resourceMode ?? null,
        resourceSource: targetFlags.resourceSource ?? null,
        isEnchantmentCast: Boolean(targetFlags.isEnchantmentCast),
        enchantmentId: targetFlags.enchantmentId ?? null,
        enchantmentItemUuid: targetFlags.enchantmentItemUuid ?? null,
        enchantmentSourceLane: targetFlags.enchantmentSourceLane ?? null,
        enchantmentSlotId: targetFlags.enchantmentSlotId ?? null,
        owner: "system",
        source: "spell-paired"
      }
    },
    changes: mirroredChanges
  });
}

/**
 * Handle `uesrpg.spell.effectApplied` — if the spell is Absorb [Char],
 * create a mirrored buff on the caster and link it to the Origin AE.
 */
export async function applyPairedCasterEffects(payload, { strict = false } = {}) {
  const { caster, target, spell, effects, originEffect } = payload;

  if (!_isAbsorbCharSpell(spell)) return;
  if (!caster || !target || !effects?.length) return;
  if (!game.user.isGM) {
    if (strict) throw new Error("GM authority is required for paired caster effects.");
    return;
  }

  _originDebug(`Absorb paired AE trigger: ${spell.name}`, {
    caster: caster.name,
    target: target.name,
    effectCount: effects.length
  });

  for (const targetEffect of effects) {
    const buffData = _buildCasterBuffData(targetEffect, spell, caster);
    if (!buffData) continue;

    try {
      const results = await requestCreateEmbeddedDocuments(caster, "ActiveEffect", [buffData]);
      const created = Array.isArray(results) ? results[0] : (results ?? null);

      if (!created) {
        if (strict) throw new Error("Caster buff creation was not confirmed.");
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
        }, { strict });
        _originDebug("Registered caster buff with Origin AE", { originId: origin.id });
      }
    } catch (err) {
      if (strict) throw err;
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
  registerAuthorityIntentService();
  registerAuthorityIntentCommand("spell.cancelOrigin", async ({ requester, data }) => {
    if (Object.keys(data ?? {}).some(key => !["originUuid", "casterUuid"].includes(key))) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
    const caster = await fromUuid(_str(data?.casterUuid));
    if (caster?.documentName !== "Actor" || (!requester.isGM && !caster.testUserPermission(requester, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER))) return { ok: false, code: AUTHORITY_RESULT_CODES.UNAUTHORIZED };
    const prefix = `${caster.uuid}.ActiveEffect.`;
    if (!_str(data.originUuid).startsWith(prefix) || _str(data.originUuid).slice(prefix.length).includes(".")) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
    const origin = await fromUuid(data.originUuid);
    if (!origin) {
      const pending = _teardowns.get(data.originUuid);
      const settled = pending ? await pending : null;
      return { ok: !settled?.errors?.length };
    }
    if (!origin.flags?.[_FLAG_NS]?.isOriginAE || origin.parent?.uuid !== caster.uuid) return { ok: false, code: AUTHORITY_RESULT_CODES.INVALID_REQUEST };
    return { ok: await cancelOriginAEUpkeep(origin) };
  });
  // When any ActiveEffect is deleted, check if it's an Origin AE and tear down linked entities
  Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
    // Only the GM processes teardowns to avoid race conditions
    if (!isActiveGMUser(game.user) || options?.uesrpgOwnedTeardown) return;

    const flags = effect?.flags?.[_FLAG_NS];
    if (!flags?.isOriginAE) return;

    _originDebug("Origin AE deletion detected, triggering teardown", {
      effectId: effect.id,
      spellName: flags.spellName
    });

    const settled = await teardownOriginAE(effect, { silent: false });
    if (settled.errors.length) {
      _hookTeardownFailures.push(...settled.errors);
      if (_hookTeardownFailures.length > 100) _hookTeardownFailures.splice(0, _hookTeardownFailures.length - 100);
    }
  });

  // Paired AE hook for Absorb [Characteristic] spells
  Hooks.on("uesrpg.spell.effectApplied", payload => {
    if (payload?.handledDomains?.includes("paired")) return;
    void applyPairedCasterEffects(payload).catch(error => console.error("UESRPG | Paired effect failed", error));
  });

  _originDebug("Origin AE lifecycle hooks installed (incl. paired AE)");
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Delete a single linked entity by its link descriptor.
 * @param {object} link
 * @returns {Promise<boolean>}
 */
async function _deleteLinkedEntity(link) {
  if (!link?.uuid) return false;

  try {
    const resolver = createUuidResolver();
    const doc = resolver.resolveSync(link.uuid);
    if (!doc) return true; // Confirmed absence is idempotent success

    switch (link.type) {
      case "targetAE": {
        const parent = doc.parent;
        if (!parent) return false;
        // Verify the effect still exists on the parent
        const existing = parent.effects?.get?.(doc.id);
        if (!existing) return true;
        return await safeDeleteEmbeddedDocument(parent, "ActiveEffect", doc.id, {
          context: "UESRPG | origin-effect | delete linked targetAE",
          deleteOptions: { uesrpgExpirationSweep: true, uesrpgBufferCleanupHandled: true }
        });
      }
      case "template": {
        // Legacy compatibility cleanup for old template-linked worlds only.
        if (doc.documentName === "MeasuredTemplate") {
          const scene = doc.parent;
          if (scene) {
            return await safeDeleteEmbeddedDocument(scene, "MeasuredTemplate", doc.id, {
              context: "UESRPG | origin-effect | delete linked template"
            });
          }
        }
        return false;
      }
      case "region": {
        if (doc.documentName === "Region") {
          const scene = doc.parent;
          if (scene) {
            return await safeDeleteEmbeddedDocument(scene, "Region", doc.id, {
              context: "UESRPG | origin-effect | delete linked region"
            });
          }
        }
        return false;
      }
      case "summon": {
        // Token deletion for summoned creatures
        if (doc.documentName === "Token" || doc.documentName === "TokenDocument") {
          const scene = doc.parent;
          if (scene) {
            return await safeDeleteEmbeddedDocument(scene, "Token", doc.id, {
              context: "UESRPG | origin-effect | delete linked summon"
            });
          }
        }
        return false;
      }
      case "casterBuff": {
        // ActiveEffect on the caster (e.g. Absorb [Char] paired buff)
        const buffParent = doc.parent;
        if (!buffParent) return false;
        const existingBuff = buffParent.effects?.get?.(doc.id);
        if (!existingBuff) return true;
        return await safeDeleteEmbeddedDocument(buffParent, "ActiveEffect", doc.id, {
          context: "UESRPG | origin-effect | delete linked casterBuff",
          deleteOptions: { uesrpgExpirationSweep: true, uesrpgBufferCleanupHandled: true }
        });
      }
      case "boundItem": {
        // Temporary item on the caster (e.g. Conjure [Weapon/Armor])
        const itemParent = doc.parent;
        if (!itemParent) return false;
        const existingItem = itemParent.items?.get?.(doc.id);
        if (!existingItem) return true;
        return await safeDeleteEmbeddedDocument(itemParent, "Item", doc.id, {
          context: "UESRPG | origin-effect | delete linked boundItem"
        });
      }
      default:
        return false;
    }
  } catch (err) {
    if (isMissingDocError(err) && !resolveUuidSync(link.uuid)) return true;
    throw err;
  }
}

/**
 * Update an Origin AE safely.
 * @param {ActiveEffect} effect
 * @param {object} updates
 * @returns {Promise<boolean>}
 */
async function _updateOriginEffect(effect, updates, { strict = false } = {}) {
  if (!effect || !updates) return false;
  try {
    const parent = effect.parent;
    if (!parent) return false;
    const existing = parent.effects?.get?.(effect.id);
    if (!existing) return false;

    const updated = await requestUpdateDocument(existing, updates);
    return strict ? updated === true : true;
  } catch (err) {
    if (isMissingDocError(err)) return false;
    console.error("UESRPG | origin-effect | Failed to update Origin AE", err);
    return false;
  }
}
