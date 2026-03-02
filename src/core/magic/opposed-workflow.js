/**
 * @module magic/opposed-workflow
 *
 * src/core/magic/opposed-workflow.js
 *
 * Magic attack opposed workflow for UESRPG 3ev4.
 * Target: Foundry VTT v13.351.
 *
 * Refactored to use modular action handlers following combat opposed workflow pattern.
 * Main file now focuses on orchestration; action handling delegated to opposed/actions/ modules.
 */

import { doTestRoll } from "../../utils/degree-roll-helper.js";
import {
  computeMagicCastingTN,
  computeSpellAttemptMagickaCost,
  consumeSpellMagicka,
  applySpellRestraintRefund,
  isHealingSpell,
  isActorTrainedInMagicSchool
} from "./magicka-utils.js";
import { shouldBackfire, triggerBackfire } from "./backfire.js";
import { canUserRollActor } from "../../utils/permissions.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { safeUpdateChatMessage } from "../../utils/chat-message-socket.js";
import { ActionEconomy } from "../combat/action-economy.js";
import { AttackTracker } from "../combat/attack-tracker.js";
import { classifySpellForRouting, getUserSpellTargets, emitCastResolved } from "./spell-runtime.js";
import { getBlockingNoDurationUpkeep, spellNeedsEffectApplication } from "./opposed/spell-helpers.js";
import { isCharacteristicDefense } from "./characteristic-defense-service.js";
import { normalizeSpellConfig } from "./spell-config.js";
import { resolveActor, resolveToken, resolveDoc } from "./opposed/schema.js";
import { getMessageState, selectDefenderEntry, getDefenderEntries, ensureBankedScaffold, allDefendersCommitted, getDefenderOutcome } from "./opposed/schema.js";
import { renderCard, renderUnopposedCard } from "./opposed/render.js";
import { dispatchAction, autoRollBanked } from "./opposed/actions.js";
import { resolveOutcome } from "./opposed/outcome-resolution.js";
import { updateCard as magicUpdateCard } from "./opposed/updater.js";
import { applySpellEffectsToTarget } from "./effects/spell-effects.js";
import { spellRequiresOriginAE, createOriginAE } from "./effects/origin-effect.js";
import { buildRollContext } from "../rules/roll-context.js";

const _FLAG_NS = "uesrpg-3ev4";
const _FLAG_KEY = "magicOpposed";
const _CARD_VERSION = 2;
const _magicAutoRollLocalLocks = new Set();

function _normalizeCastSourceCostMode(castSource = null) {
  const mode = String(castSource?.costMode ?? "soul").trim().toLowerCase();
  if (mode === "magicka" || mode === "none") return mode;
  return "soul";
}

function _resolveItemContextFromCastSource(castSource = null, itemCastContext = null) {
  const itemUuid = String(itemCastContext?.itemUuid ?? castSource?.itemUuid ?? "").trim();
  const sourceLane = String(itemCastContext?.sourceLane ?? castSource?.sourceLane ?? "workshop").trim().toLowerCase();
  const slotId = String(itemCastContext?.slotId ?? castSource?.spellSlotId ?? "").trim();
  if (!itemUuid) return null;
  const itemDoc = fromUuidSync(itemUuid);
  const item = itemDoc?.documentName === "Item" ? itemDoc : null;
  if (!item) return null;
  return { item, sourceLane, slotId };
}

function _getItemSoulPoolSnapshot(itemCtx = null) {
  if (!itemCtx?.item) return { value: 0, max: 0, poolPath: "" };
  const { item, sourceLane } = itemCtx;
  if (sourceLane === "extension") {
    const pool = item.flags?.[_FLAG_NS]?.itemSpellcasting?.pool ?? {};
    return {
      value: Number(item.system?.charge?.value ?? pool?.value ?? 0) || 0,
      max: Number(item.system?.charge?.max ?? pool?.max ?? 0) || 0,
      poolPath: `flags.${_FLAG_NS}.itemSpellcasting.pool.value`
    };
  }
  const pool = item.flags?.[_FLAG_NS]?.enchanting?.cast?.pool ?? {};
  return {
    value: Number(pool?.value ?? 0) || 0,
    max: Number(pool?.max ?? 0) || 0,
    poolPath: `flags.${_FLAG_NS}.enchanting.cast.pool.value`
  };
}

async function _spendItemSoulCost({ itemCtx, cost }) {
  const amount = Math.max(0, Number(cost ?? 0) || 0);
  const snap = _getItemSoulPoolSnapshot(itemCtx);
  if (snap.value < amount) {
    return { ok: false, reason: "insufficient", value: snap.value, max: snap.max, spent: 0 };
  }
  const next = Math.max(0, snap.value - amount);
  const updates = { [snap.poolPath]: next, "system.charge.value": next };
  const ok = await requestUpdateDocument(itemCtx.item, updates);
  if (!ok) return { ok: false, reason: "update-failed", value: snap.value, max: snap.max, spent: 0 };
  return { ok: true, value: next, max: snap.max, spent: amount };
}

/**
 * Facade for the magic opposed workflow subsystem.
 *
 * Provides the public API for creating, managing, and resolving magic
 * attack opposed tests. Delegates internally to modular handlers in
 * `opposed/` subdirectory.
 *
 * @type {object}
 */
export const MagicOpposedWorkflow = {
  /**
   * Create a pending magic attack opposed test.
   *
   * Sets up the attacker, resolves defenders, computes TN, performs the
   * casting roll, and creates the opposed-card ChatMessage.
   *
   * @param {object} cfg
   * @param {string} [cfg.attackerTokenUuid] - Attacker token UUID
   * @param {string} [cfg.attackerActorUuid] - Attacker actor UUID
   * @param {string} [cfg.spellUuid]         - Spell item UUID
   * @param {Array}  [cfg.defenders]         - Defender token/actor refs
   * @param {SpellCastOptions} [cfg.spellOptions] - Casting options
   * @param {string} [cfg.castActionType]    - "primary" | "secondary"
   * @returns {Promise<ChatMessage|null>}
   */
  async createPending(cfg = {}) {
    const aDoc = resolveDoc(cfg.attackerTokenUuid) ?? resolveDoc(cfg.attackerActorUuid) ?? resolveDoc(cfg.attackerUuid);

    const aToken = resolveToken(aDoc);
    const attacker = resolveActor(aDoc);

    const defenderRefs = [];
    const addDefenderRef = (ref) => {
      if (!ref) return;
      if (typeof ref === "string") defenderRefs.push(ref);
      else if (ref?.uuid) defenderRefs.push(ref.uuid);
    };

    if (Array.isArray(cfg.defenders)) {
      for (const def of cfg.defenders) {
        addDefenderRef(def?.tokenUuid ?? def?.actorUuid ?? def?.uuid ?? def);
      }
    }
    if (Array.isArray(cfg.defenderTokenUuids)) {
      for (const ref of cfg.defenderTokenUuids) addDefenderRef(ref);
    }
    if (Array.isArray(cfg.defenderActorUuids)) {
      for (const ref of cfg.defenderActorUuids) addDefenderRef(ref);
    }
    addDefenderRef(cfg.defenderTokenUuid ?? cfg.defenderActorUuid ?? cfg.defenderUuid);

    const defenderEntries = [];
    const seen = new Set();
    for (const ref of defenderRefs) {
      const dDoc = resolveDoc(ref);
      const dToken = resolveToken(dDoc);
      const dActor = resolveActor(dDoc);
      if (!dActor) continue;
      const key = dToken?.document?.uuid ?? dToken?.uuid ?? dActor.uuid;
      if (seen.has(key)) continue;
      seen.add(key);

      defenderEntries.push({
        actorUuid: dActor.uuid,
        tokenUuid: dToken?.document?.uuid ?? dToken?.uuid ?? null,
        tokenName: dToken?.name ?? dToken?.document?.name ?? null,
        name: dActor.name,
        defenseType: null,
        result: null,
        tn: null,
        noDefense: false,
        apCost: 1,
        banked: { committed: false, committedAt: null, committedBy: null }
      });
    }

    if (!attacker || defenderEntries.length === 0) {
      ui.notifications.warn("Magic attack requires both a caster and at least one target.");
      return null;
    }

    const deferSpellChoice = Boolean(cfg?.deferSpellChoice);
    const requestedSpellUuid = String(cfg?.spellUuid ?? "").trim() || null;
    let spell = null;
    let spellOptions = cfg.spellOptions ?? {};
    let tn = null;
    let healingDirect = false;

    if (!deferSpellChoice) {
      spell = await fromUuid(requestedSpellUuid);
      if (!spell) {
        ui.notifications.error("Could not resolve spell.");
        return null;
      }

      if (!isActorTrainedInMagicSchool(attacker, spell?.system?.school)) {
        ui.notifications.warn(`${attacker.name} is untrained in ${spell?.system?.school ?? "that school"} and cannot cast ${spell.name}.`);
        return null;
      }

      // Direct spells resolve immediately (no casting/defense tests).
      if (Boolean(spell?.system?.isDirect)) {
        for (const def of defenderEntries) {
          await this.castDirectTargeted({
            attackerTokenUuid: cfg.attackerTokenUuid,
            attackerActorUuid: cfg.attackerActorUuid,
            attackerUuid: cfg.attackerUuid,
            defenderTokenUuid: def.tokenUuid ?? null,
            defenderActorUuid: def.actorUuid ?? null,
            defenderUuid: def.actorUuid ?? null,
            spellUuid: cfg.spellUuid,
            spellOptions: cfg.spellOptions,
            castActionType: cfg.castActionType,
            castSource: cfg.castSource ?? null,
            itemCastContext: cfg.itemCastContext ?? null
          });
        }
        return null;
      }

      tn = computeMagicCastingTN(attacker, spell, spellOptions);
      healingDirect = isHealingSpell(spell);
    } else if (requestedSpellUuid) {
      spell = await fromUuid(requestedSpellUuid);
    }

    // Cast-time RAW gating: while maintaining an Upkeep spell with no listed duration, the caster cannot cast other spells.
    // In deferred-selection mode, this is re-checked at cast time when the concrete spell is known.
    if (!deferSpellChoice) {
      const blocking = getBlockingNoDurationUpkeep(attacker, spell?.uuid ?? null);
      if (blocking) {
        ui.notifications.warn(`${attacker.name} cannot cast another spell while maintaining ${blocking.spellName} (no listed duration Upkeep).`);
        return null;
      }
    }
    const isAoE = Boolean(cfg?.aoe?.isAoE || cfg?.context?.aoe?.isAoE || cfg?.isAoE);

    // Characteristic defense spells use a characteristic save instead of
    // Block/Evade/Ward.  Tag defender entries so the chat card renders the
    // correct commit/roll buttons ("Roll END Save", etc.).
    const isCharDef = spell && isCharacteristicDefense(spell);
    if (isCharDef) {
      const _CHA_LABELS = { str: "STR", end: "END", agi: "AGI", int: "INT", wp: "WP", prc: "PRC", prs: "PRS", lck: "LCK" };
      const charDef = normalizeSpellConfig(spell)?.characteristicDefense;
      const chaKey = String(charDef?.defenderCharacteristic || "end").toLowerCase();
      const chaLabel = _CHA_LABELS[chaKey] ?? chaKey.toUpperCase();
      for (const def of defenderEntries) {
        def.defenseType = "characteristic-save";
        def.characteristicLabel = chaLabel;
        // noDefense stays false, result stays null — defender actively rolls/commits
      }
    }

    const primaryDefender = defenderEntries[0]?.actorUuid ? resolveActor(defenderEntries[0].actorUuid) : null;
    const rollContext = buildRollContext({
      actor: attacker,
      targetActor: primaryDefender,
      item: spell ?? null,
      testType: "spell",
      attackMode: "magic"
    });

    const data = {
      context: {
        schemaVersion: _CARD_VERSION,
        createdAt: Date.now(),
        createdBy: game.user.id,
        originalCastWorldTime: Number(game.time?.worldTime ?? 0) || 0,
        updatedAt: Date.now(),
        updatedBy: game.user.id,
        phase: "pending",
        healingDirect,
        bankChoicesEnabled: true,
        rollContext,
        rollOptions: Array.isArray(rollContext?.rollOptions) ? rollContext.rollOptions.slice() : [],
        aoe: cfg?.aoe ? foundry.utils.deepClone(cfg.aoe) : undefined,
        isAoE: cfg?.isAoE ?? undefined,
        forcedHitLocation: isAoE ? "Body" : null,
        itemCastContext: cfg?.itemCastContext ? foundry.utils.deepClone(cfg.itemCastContext) : null
      },
      status: "pending",
      mode: "magic",
      attacker: {
        actorUuid: attacker.uuid,
        tokenUuid: aToken?.document?.uuid ?? aToken?.uuid ?? null,
        tokenName: aToken?.name ?? null,
        name: attacker.name,
        spellUuid: deferSpellChoice ? null : (spell?.uuid ?? null),
        preferredSpellUuid: requestedSpellUuid ?? spell?.uuid ?? null,
        pendingSpellChoice: deferSpellChoice,
        spellName: deferSpellChoice ? null : (spell?.name ?? null),
        spellSchool: deferSpellChoice ? null : (spell?.system?.school ?? ""),
        spellLevel: deferSpellChoice ? null : Number(spell?.system?.level ?? 1),
        spellCost: deferSpellChoice ? null : Number(spell?.system?.cost ?? 0),
        spellOptions: deferSpellChoice ? null : spellOptions,
        castActionType: String(cfg.castActionType ?? "primary"),
        apCost: 1,
        result: null,
        tn,
        mpSpent: null,
        mpRemaining: null,
        backfire: false,
        castSource: cfg?.castSource ? foundry.utils.deepClone(cfg.castSource) : null
      },
      defenders: defenderEntries,
      defender: defenderEntries[0] ?? null,
      outcome: null
    };

    const message = await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: attacker, token: aToken?.document ?? aToken ?? null }),
      content: renderCard(data, ""),
      flags: { [_FLAG_NS]: { [_FLAG_KEY]: { version: _CARD_VERSION, state: data } } },
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });

    await safeUpdateChatMessage(message, { content: renderCard(data, message.id) });
    return message;
  },

  /**
   * Resolve a targeted Direct spell with casting test but no defense.
   *
   * Used for spells that automatically hit (no opposed test) but still
   * require a casting roll and target resolution.
   *
   * @param {object} cfg
   * @param {string} [cfg.attackerTokenUuid] - Attacker token UUID
   * @param {string} [cfg.defenderTokenUuid] - Defender token UUID
   * @param {string} [cfg.spellUuid]         - Spell item UUID
   * @param {SpellCastOptions} [cfg.spellOptions] - Casting options
   * @param {string} [cfg.castActionType]    - "primary" | "secondary"
   * @returns {Promise<ChatMessage|null>}
   */
  async castDirectTargeted(cfg = {}) {
    const aDoc = resolveDoc(cfg.attackerTokenUuid) ?? resolveDoc(cfg.attackerActorUuid) ?? resolveDoc(cfg.attackerUuid);
    const dDoc = resolveDoc(cfg.defenderTokenUuid) ?? resolveDoc(cfg.defenderActorUuid) ?? resolveDoc(cfg.defenderUuid);

    const aToken = resolveToken(aDoc);
    const dToken = resolveToken(dDoc);
    const attacker = resolveActor(aDoc);
    const defender = resolveActor(dDoc);

    if (!attacker || !defender) {
      ui.notifications.warn("Direct spell requires both a caster and a target.");
      return null;
    }

    const spell = await fromUuid(cfg.spellUuid);
    if (!spell) {
      ui.notifications.error("Could not resolve spell.");
      return null;
    }

    if (!Boolean(spell?.system?.isDirect)) {
      ui.notifications.warn("This spell is not marked as Direct.");
      return null;
    }

    if (!isActorTrainedInMagicSchool(attacker, spell?.system?.school)) {
      ui.notifications.warn(`${attacker.name} is untrained in ${spell?.system?.school ?? "that school"} and cannot cast ${spell.name}.`);
      return null;
    }

    if (!canUserRollActor(game.user, attacker)) {
      ui.notifications.warn("You do not have permission to cast with this caster.");
      return null;
    }

    const spellOptions = cfg.spellOptions ?? {};
    const castSource = cfg?.castSource ? foundry.utils.deepClone(cfg.castSource) : null;
    const itemCastContext = cfg?.itemCastContext ? foundry.utils.deepClone(cfg.itemCastContext) : null;
    const castSourceMode = _normalizeCastSourceCostMode(castSource);
    const isEnchantmentSource = castSource?.type === "enchantment";
    const tn = computeMagicCastingTN(attacker, spell, spellOptions);

    const blocking = getBlockingNoDurationUpkeep(attacker, spell?.uuid ?? null);
    if (blocking) {
      ui.notifications.warn(`${attacker.name} cannot cast another spell while maintaining ${blocking.spellName} (no listed duration Upkeep).`);
      return null;
    }

    // Preflight: check ALL resources before consuming ANY.
    const apCost = 1;
    const currentAP = Number(attacker?.system?.action_points?.value ?? 0) || 0;
    if (currentAP < apCost) {
      ui.notifications.warn(`${attacker.name} does not have enough Action Points to cast.`);
      return null;
    }

    let itemCtx = null;
    if (isEnchantmentSource) itemCtx = _resolveItemContextFromCastSource(castSource, itemCastContext);
    let enchantSoulCost = 0;
    if (isEnchantmentSource && castSourceMode === "soul") {
      enchantSoulCost = Math.max(0, Number(castSource?.cost ?? 0) || 0);
      const pool = _getItemSoulPoolSnapshot(itemCtx);
      if (pool.value < enchantSoulCost) {
        ui.notifications.warn(`${attacker.name} does not have enough Soul Energy (${pool.value}/${enchantSoulCost}) to cast.`);
        return null;
      }
    } else if (!(isEnchantmentSource && castSourceMode === "none")) {
      const currentMagicka = Number(attacker?.system?.magicka?.value ?? 0) || 0;
      const magickaInfo = computeSpellAttemptMagickaCost(attacker, spell, spellOptions);
      const attemptCost = Number(magickaInfo?.attemptCost ?? magickaInfo?.cost ?? 0) || 0;
      if (currentMagicka < attemptCost) {
        ui.notifications.warn(`${attacker.name} does not have enough Magicka (${currentMagicka}/${attemptCost}) to cast.`);
        return null;
      }
    }

    // All pre-checks passed — now consume resources.
    const apReason = `Cast (Direct): ${spell.name}`;
    const apSpentOk = await ActionEconomy.spendAP(attacker, apCost, { reason: apReason, silent: false });
    if (!apSpentOk) return null;

    let magickaSpend = { ok: true, consumed: 0, remaining: Number(attacker?.system?.magicka?.value ?? 0) || 0, refund: 0 };
    if (isEnchantmentSource && castSourceMode === "soul") {
      const soulSpend = await _spendItemSoulCost({ itemCtx, cost: enchantSoulCost });
      if (!soulSpend?.ok) {
        try {
          await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
        } catch (_e) { /* best-effort */ }
        return null;
      }
      magickaSpend.consumed = Number(soulSpend.spent ?? enchantSoulCost ?? 0) || 0;
      magickaSpend.remaining = Number(attacker?.system?.magicka?.value ?? 0) || 0;
    } else if (!(isEnchantmentSource && castSourceMode === "none")) {
      magickaSpend = await consumeSpellMagicka(attacker, spell, spellOptions);
      if (!magickaSpend?.ok) {
        // Rollback AP on magicka failure
        try {
          await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
        } catch (_e) { /* best-effort */ }
        return null;
      }
    }

    const result = await doTestRoll(attacker, {
      target: tn.finalTN,
      allowLucky: true,
      allowUnlucky: true
    });

    await result.roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      flavor: `<b>${spell.name}</b> — Casting Test (Direct)`,
      flags: { [_FLAG_NS]: { magicOpposedMeta: { stage: "direct-casting" } } }
    });

    const needsBackfire = shouldBackfire(spell, attacker, result.isCriticalFailure, !result.isSuccess);
    if (needsBackfire) {
      await triggerBackfire(attacker, spell);
    }

    const refundInfo = (isEnchantmentSource && castSourceMode !== "magicka")
      ? { finalCost: Number(magickaSpend?.consumed ?? 0) || 0, refund: 0 }
      : await applySpellRestraintRefund(attacker, spell, spellOptions, result, magickaSpend);

    // Emit castResolved hook
    try {
      emitCastResolved({
        caster: attacker,
        spell,
        result,
        success: result.isSuccess,
        backfired: needsBackfire,
        mpSpent: Number(refundInfo?.finalCost ?? magickaSpend?.consumed ?? 0) || 0,
        spellOptions
      });
    } catch (_e) { /* no-op */ }

    // Create Origin AE on the caster for persistent spells (only on success)
    let originEffect = null;
    if (result.isSuccess && spellRequiresOriginAE(spell)) {
      try {
        originEffect = await createOriginAE(attacker, spell, {
          costPaid: Number(refundInfo?.finalCost ?? magickaSpend?.consumed ?? 0) || 0,
          scalingChoices: spellOptions?.castLevel ? { level: spellOptions.castLevel } : null,
          spellOptions,
          targetUuids: defender ? [defender.uuid] : [],
          castWorldTime: Number(game.time?.worldTime ?? 0) || 0,
          castSource: castSource ?? null
        });
      } catch (_e) {
        console.warn("UESRPG | Failed to create Origin AE for direct spell", _e);
      }
    }

    const directRollContext = buildRollContext({
      actor: attacker,
      targetActor: defender,
      item: spell,
      testType: "spell",
      attackMode: "magic"
    });

    const data = {
      context: {
        schemaVersion: _CARD_VERSION,
        createdAt: Date.now(),
        createdBy: game.user.id,
        originalCastWorldTime: Number(game.time?.worldTime ?? 0) || 0,
        phase: "resolved",
        directUndefendable: true,
        rollContext: directRollContext,
        rollOptions: Array.isArray(directRollContext?.rollOptions) ? directRollContext.rollOptions.slice() : [],
        itemCastContext: itemCastContext ?? null
      },
      attacker: {
        actorUuid: attacker.uuid,
        name: attacker.name,
        tokenUuid: aToken?.document?.uuid ?? aToken?.uuid ?? cfg.attackerTokenUuid ?? null,
        tokenName: aToken?.name ?? aToken?.document?.name ?? attacker.name,
        spellUuid: spell.uuid,
        spellName: spell.name,
        spellSchool: spell.system?.school ?? "",
        spellLevel: Number(spell.system?.level ?? 1),
        spellCost: Number(spell.system?.cost ?? 0),
        actionType: cfg.castActionType ?? "primary",
        apCost,
        tn,
        result,
        spellOptions,
        mpSpent: Number(refundInfo?.finalCost ?? magickaSpend?.consumed ?? 0) || 0,
        mpRefund: Number(refundInfo?.refund ?? 0) || 0,
        backfire: needsBackfire,
        castSource: castSource ?? null
      },
      defender: {
        actorUuid: defender.uuid,
        name: defender.name,
        tokenUuid: dToken?.document?.uuid ?? dToken?.uuid ?? cfg.defenderTokenUuid ?? null,
        tokenName: dToken?.name ?? dToken?.document?.name ?? defender.name,
        defenseType: isCharacteristicDefense(spell) ? "characteristic-save" : "Cannot Defend",
        tn: null,
        result: null,
        noDefense: true,
        spellOptions: {}
      },
      outcome: null
    };

    const message = await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: attacker, token: aToken?.document ?? aToken ?? null }),
      content: renderCard(data, ""),
      flags: { [_FLAG_NS]: { [_FLAG_KEY]: { version: _CARD_VERSION, state: data } } },
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });

    await safeUpdateChatMessage(message, { content: renderCard(data, message.id) });
    
    if (result.isSuccess) {
      const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
      const forcedHitLocation = String(data?.context?.forcedHitLocation ?? "").trim();
      const defenderEntry = selectDefenderEntry(data, {}).defender;
      
      await resolveOutcome({
        message,
        data,
        attacker,
        defender,
        defenderEntry,
        spell,
        isAoE,
        forcedHitLocation,
        _updateCard: (msg, d) => magicUpdateCard(msg, d, renderCard)
      });
    }
    
    return message;
  },

  /**
   * Resolve a spell cast with no target selected.
   *
   * Handles self-buffs, ground-targeted AoE, and utility spells using
   * the modern TN/DoS pipeline.
   *
   * @param {object} cfg
   * @param {string} [cfg.attackerTokenUuid] - Attacker token UUID
   * @param {string} [cfg.spellUuid]         - Spell item UUID
   * @param {SpellCastOptions} [cfg.spellOptions] - Casting options
   * @param {string} [cfg.castActionType]    - "primary" | "secondary"
   * @returns {Promise<ChatMessage|null>}
   */
  async castUnopposed(cfg = {}) {
    const aDoc = resolveDoc(cfg.attackerTokenUuid) ?? resolveDoc(cfg.attackerActorUuid) ?? resolveDoc(cfg.attackerUuid);
    const aToken = resolveToken(aDoc);
    const attacker = resolveActor(aDoc);
    if (!attacker) {
      ui.notifications.warn("Could not resolve caster.");
      return null;
    }

    const spell = await fromUuid(cfg.spellUuid);
    if (!spell) {
      ui.notifications.error("Could not resolve spell.");
      return null;
    }

    if (!isActorTrainedInMagicSchool(attacker, spell?.system?.school)) {
      ui.notifications.warn(`${attacker.name} is untrained in ${spell?.system?.school ?? "that school"} and cannot cast ${spell.name}.`);
      return null;
    }

    if (!canUserRollActor(game.user, attacker)) {
      ui.notifications.warn("You do not have permission to roll for this caster.");
      return null;
    }

    const spellOptions = cfg.spellOptions ?? {};
    const castSource = cfg?.castSource ? foundry.utils.deepClone(cfg.castSource) : null;
    const itemCastContext = cfg?.itemCastContext ? foundry.utils.deepClone(cfg.itemCastContext) : null;
    const castSourceMode = _normalizeCastSourceCostMode(castSource);
    const isEnchantmentSource = castSource?.type === "enchantment";
    const tn = computeMagicCastingTN(attacker, spell, spellOptions);

    const blocking = getBlockingNoDurationUpkeep(attacker, spell?.uuid ?? null);
    if (blocking) {
      ui.notifications.warn(`${attacker.name} cannot cast another spell while maintaining ${blocking.spellName} (no listed duration Upkeep).`);
      return null;
    }

    const apCost = 1;
    const currentAP = Number(attacker?.system?.action_points?.value ?? 0) || 0;
    if (currentAP < apCost) {
      ui.notifications.warn("Not enough Action Points to cast the spell.");
      return null;
    }

    let itemCtx = null;
    if (isEnchantmentSource) itemCtx = _resolveItemContextFromCastSource(castSource, itemCastContext);
    let enchantSoulCost = 0;
    if (isEnchantmentSource && castSourceMode === "soul") {
      enchantSoulCost = Math.max(0, Number(castSource?.cost ?? 0) || 0);
      const pool = _getItemSoulPoolSnapshot(itemCtx);
      if (pool.value < enchantSoulCost) {
        ui.notifications.warn(`Not enough Soul Energy to cast ${spell?.name ?? "spell"}. Required: ${enchantSoulCost}, Available: ${pool.value}.`);
        return null;
      }
    } else if (!(isEnchantmentSource && castSourceMode === "none")) {
      const magickaInfo = computeSpellAttemptMagickaCost(attacker, spell, spellOptions);
      const currentMagicka = Number(attacker?.system?.magicka?.value ?? 0) || 0;
      if (currentMagicka < magickaInfo.cost) {
        ui.notifications.warn(`Not enough Magicka to cast ${spell?.name ?? "spell"}. Required: ${magickaInfo.cost}, Available: ${currentMagicka}.`);
        return null;
      }
    }

    // Gate attack limit BEFORE consuming resources.
    const spellClassification = classifySpellForRouting(spell);
    if (spellClassification.isAttack && game.combat) {
      if (AttackTracker.hasExceededLimit(attacker)) {
        ui.notifications.warn(AttackTracker.getLimitWarning(attacker) || "Attack limit reached for this round.");
        return null;
      }
    }

    const castActionType = String(cfg.castActionType ?? "primary");
    const apReason = (castActionType === "secondary") ? "Cast Magic (Instant)" : "Cast Magic";
    const apSpentOk = await ActionEconomy.spendAP(attacker, apCost, { reason: apReason, silent: false });
    if (!apSpentOk) return null;

    if (spellClassification.isAttack) {
      try {
        await AttackTracker.incrementAttacks(attacker);
      } catch (err) {
        console.error("UESRPG | Failed to increment attack counter", { actor: attacker?.uuid, err });
      }
    }

    let magickaSpend = { ok: true, consumed: 0, remaining: Number(attacker?.system?.magicka?.value ?? 0) || 0, refund: 0 };
    if (isEnchantmentSource && castSourceMode === "soul") {
      const soulSpend = await _spendItemSoulCost({ itemCtx, cost: enchantSoulCost });
      if (!soulSpend?.ok) {
        try {
          await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
        } catch (_e) {
          // best-effort
        }
        return null;
      }
      magickaSpend.consumed = Number(soulSpend.spent ?? enchantSoulCost ?? 0) || 0;
      magickaSpend.remaining = Number(attacker?.system?.magicka?.value ?? 0) || 0;
    } else if (!(isEnchantmentSource && castSourceMode === "none")) {
      magickaSpend = await consumeSpellMagicka(attacker, spell, spellOptions);
      if (!magickaSpend?.ok) {
        try {
          await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
        } catch (_e) {
          // best-effort
        }
        return null;
      }
    }

    const result = await doTestRoll(attacker, {
      target: tn.finalTN,
      allowLucky: true,
      allowUnlucky: true
    });

    try {
      const refundInfo = (isEnchantmentSource && castSourceMode !== "magicka")
        ? { finalCost: Number(magickaSpend?.consumed ?? 0) || 0, refund: 0, breakdown: [] }
        : await applySpellRestraintRefund(attacker, spell, spellOptions, result, magickaSpend);
      if (refundInfo?.refund > 0) {
        magickaSpend.consumed = refundInfo.finalCost;
        magickaSpend.remaining = Number(attacker.system?.magicka?.value ?? magickaSpend.remaining);
        magickaSpend.refund = refundInfo.refund;
        magickaSpend.restraintBreakdown = refundInfo.breakdown;
      }
    } catch (err) {
      console.warn("UESRPG | Spell restraint refund failed", err);
    }

    // Emit castResolved hook
    try {
      emitCastResolved({
        caster: attacker,
        spell,
        result,
        success: result.isSuccess,
        backfired: false, // backfire checked below
        mpSpent: Number(magickaSpend?.consumed ?? 0) || 0,
        spellOptions
      });
    } catch (_e) { /* no-op */ }

    await result.roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      flavor: `<b>${spell.name}</b> — Casting Test`,
      flags: { [_FLAG_NS]: { magicOpposedMeta: { stage: "unopposed" } } }
    });

    const needsBackfire = shouldBackfire(spell, attacker, result.isCriticalFailure, !result.isSuccess);
    if (needsBackfire) {
      await triggerBackfire(attacker, spell);
    }

    // Create Origin AE on the caster for persistent spells (only on success)
    let originEffect = null;
    if (result.isSuccess && spellRequiresOriginAE(spell)) {
      try {
        originEffect = await createOriginAE(attacker, spell, {
          costPaid: Number(magickaSpend?.consumed ?? 0) || 0,
          scalingChoices: spellOptions?.castLevel ? { level: spellOptions.castLevel } : null,
          spellOptions,
          targetUuids: [],
          castWorldTime: Number(game.time?.worldTime ?? 0) || 0,
          castSource: castSource ?? null
        });
      } catch (_e) {
        console.warn("UESRPG | Failed to create Origin AE for unopposed spell", _e);
      }
    }

    // Apply spell effects to caster for self-targeting spells
    // (spells with embedded AEs, upkeep, finite duration, or buffers)
    // For conjure-item spells, route effects to the same targets that
    // will receive the conjured items, so AEs and items land on the same actor.
    if (result.isSuccess) {
      const { spellNeedsEffectApplication } = await import("./opposed/spell-helpers.js");
      const hasBuffer = Boolean(spell.system?.hasBuffer && spell.system?.buffer?.type && spell.system.buffer.type !== "none");
      
      if (spellNeedsEffectApplication(spell) || hasBuffer) {
        // Determine effect targets — conjure-item spells route to user-selected targets
        let effectTargets = [attacker];
        const conjureMode = String(spell.system?.engine?.conjure?.mode ?? "").toLowerCase();
        if (conjureMode === "item") {
          const userTargets = getUserSpellTargets();
          if (userTargets.length) {
            const actors = userTargets
              .map(t => t.actor ?? t.document?.actor)
              .filter(a => a != null);
            if (actors.length) effectTargets = actors;
          }
        }

        for (const effectTarget of effectTargets) {
          try {
            await applySpellEffectsToTarget(attacker, effectTarget, spell, {
              actualCost: Number(magickaSpend?.consumed ?? 0) || 0,
              originalCastTime: Number(game.time?.worldTime ?? 0) || 0
            });
          } catch (err) {
            console.error("UESRPG | Failed to apply spell effects to", effectTarget?.name ?? "unknown", err);
          }
        }
      }
    }

    const note = "No target selected — casting test resolved (no defense).";

    const unopposedRollContext = buildRollContext({
      actor: attacker,
      item: spell,
      testType: "spell",
      attackMode: "magic"
    });

    const data = {
      context: {
        schemaVersion: _CARD_VERSION,
        createdAt: Date.now(),
        createdBy: game.user.id,
        originalCastWorldTime: Number(game.time?.worldTime ?? 0) || 0,
        updatedAt: Date.now(),
        updatedBy: game.user.id,
        phase: "resolved",
        unopposed: true,
        note,
        rollContext: unopposedRollContext,
        rollOptions: Array.isArray(unopposedRollContext?.rollOptions) ? unopposedRollContext.rollOptions.slice() : [],
        itemCastContext: itemCastContext ?? null
      },
      status: "resolved",
      mode: "magic",
      attacker: {
        actorUuid: attacker.uuid,
        tokenUuid: aToken?.document?.uuid ?? aToken?.uuid ?? null,
        tokenName: aToken?.name ?? null,
        name: attacker.name,
        spellUuid: spell.uuid,
        spellName: spell.name,
        spellSchool: spell.system?.school ?? "",
        spellLevel: Number(spell.system?.level ?? 1),
        spellCost: Number(spell.system?.cost ?? 0),
        spellOptions,
        castActionType,
        apCost: 1,
        result,
        tn,
        mpSpent: magickaSpend.consumed,
        mpRemaining: magickaSpend.remaining,
        mpRefund: Number(magickaSpend.refund ?? 0) || 0,
        mpRestraintBreakdown: magickaSpend.restraintBreakdown ?? [],
        backfire: needsBackfire,
        castSource: castSource ?? null
      }
    };

    const message = await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: attacker, token: aToken?.document ?? aToken ?? null }),
      content: renderUnopposedCard(data, ""),
      flags: { [_FLAG_NS]: { [_FLAG_KEY]: { version: _CARD_VERSION, state: data } } },
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });

    await safeUpdateChatMessage(message, { content: renderUnopposedCard(data, message.id) });
    return message;
  },

  /**
   * Handle an action dispatched from the opposed card UI.
   *
   * Delegates to the modular action dispatch system in `opposed/actions.js`.
   *
   * @param {ChatMessage} message - The chat message containing the card
   * @param {string} action       - Action identifier (e.g. "defender-roll", "block-resolve")
   * @param {object} [opts={}]    - Action-specific options
   * @returns {Promise<void>}
   */
  async handleAction(message, action, opts = {}) {
    return await dispatchAction(message, action, opts, this, renderCard);
  },

  /**
   * Auto-roll when both sides have committed (banked mode).
   */
  async _autoRollBanked(message) {
    const messageId = message?.id ?? message?._id ?? null;
    if (!messageId) return;
    if (_magicAutoRollLocalLocks.has(messageId)) return;
    _magicAutoRollLocalLocks.add(messageId);
    try {
      return await autoRollBanked(message, this, (msg, d) => magicUpdateCard(msg, d, renderCard));
    } finally {
      _magicAutoRollLocalLocks.delete(messageId);
    }
  },

  /**
   * Resolve the outcome of the opposed test.
   * Delegates to outcome-resolution module.
   */
  async _resolveOutcome(message, data, attacker, defender, opts = {}) {
    const spell = await fromUuid(data.attacker.spellUuid);
    if (!spell) return;

    const { defender: defenderEntry } = selectDefenderEntry(data, opts);
    if (!defenderEntry || !defender) return;

    const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
    const forcedHitLocation = String(data?.context?.forcedHitLocation ?? "").trim();

    const updateCardFn = opts?.batchedUpdate
      ? (async () => {})
      : ((msg, d) => magicUpdateCard(msg, d, renderCard));

    await resolveOutcome({
      message,
      data,
      attacker,
      defender,
      defenderEntry,
      spell,
      isAoE,
      forcedHitLocation,
      _updateCard: updateCardFn
    });
  },

  async maybeAutoRollBanked(message) {
    try {
      if (!message) return;
      const activeGM = game.users.activeGM ?? null;
      if (!activeGM) return;
      if (!game.user?.isGM || game.user.id !== activeGM.id) return;

      const data = getMessageState(message);
      if (!data) return;

      // Guard: another runner already claimed this auto-roll.
      if (data.context?.autoRollStarted) return;

      ensureBankedScaffold(data);
      if (!allDefendersCommitted(data)) return;

      const defenders = getDefenderEntries(data);
      const needsAttackerRoll = !data.attacker?.result;
      const needsAnyDefenderRoll = defenders.some((def) => Boolean(def) && !def.result && !def.noDefense);
      const allResolved = defenders.every((def) => !def || Boolean(getDefenderOutcome(data, def)));
      if (!needsAttackerRoll && (!needsAnyDefenderRoll || allResolved)) return;

      await this._autoRollBanked(message);
    } catch (err) {
      console.error("UESRPG | Magic opposed maybeAutoRollBanked failed", err);
    }
  },

  async maybeAutoRollBankedNoGM(message) {
    try {
      if (!message) return;
      if (game.users.activeGM) return;
      const authorId = message?.author?.id ?? null;
      if (authorId && game.user.id !== authorId) return;

      const data = getMessageState(message);
      if (!data) return;

      // Guard: another runner already claimed this auto-roll.
      if (data.context?.autoRollStarted) return;

      ensureBankedScaffold(data);
      if (!allDefendersCommitted(data)) return;

      const defenders = getDefenderEntries(data);
      const needsAttackerRoll = !data.attacker?.result;
      const needsAnyDefenderRoll = defenders.some((def) => Boolean(def) && !def.result && !def.noDefense);
      const allResolved = defenders.every((def) => !def || Boolean(getDefenderOutcome(data, def)));
      if (!needsAttackerRoll && (!needsAnyDefenderRoll || allResolved)) return;

      await this._autoRollBanked(message);
    } catch (err) {
      console.error("UESRPG | Magic opposed maybeAutoRollBankedNoGM failed", err);
    }
  }
};

// Chat hook: bind button clicks (v13).
Hooks.on("renderChatMessageHTML", (message, html) => {
  const data = getMessageState(message);
  if (!data) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  root.querySelectorAll("[data-ues-magic-opposed-action]").forEach((el) => {
    const action = el.dataset.uesMagicOpposedAction;
    const defenderIndex = Number.isFinite(Number(el.dataset?.defenderIndex)) ? Number(el.dataset.defenderIndex) : null;

    // Permission-aware button state
    try {
      const attackerUuid = data?.attacker?.actorUuid;
      const defenders = getDefenderEntries(data);
      const defEntry = (defenderIndex != null && defenders[defenderIndex]) ? defenders[defenderIndex] : data?.defender;
      const defenderUuid = defEntry?.actorUuid;
      const actorUuid = (action === "attacker-roll") ? attackerUuid : (action?.startsWith?.("defender-") ? defenderUuid : null);
      const actor = actorUuid ? resolveActor(actorUuid) : null;
      if (actor && !canUserRollActor(game.user, actor)) {
        el.setAttribute("disabled", "disabled");
        el.setAttribute("title", "You do not have permission to roll for this actor.");
      }
    } catch (_e) {
      // no-op
    }

    el.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const act = ev.currentTarget?.dataset?.uesMagicOpposedAction;
      if (!act) return;
      await MagicOpposedWorkflow.handleAction(message, act, { defenderIndex });
    });
  });
});
