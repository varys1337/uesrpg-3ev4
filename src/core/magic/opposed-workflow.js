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
  canActorCastSpell,
  getSpellCastingSchool,
  getSpellCost,
  getSpellLevel
} from "./magicka-utils.js";
import { shouldBackfire, triggerBackfire } from "./backfire.js";
import { canUserRollActor } from "../../utils/permissions.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { safeUpdateChatMessage } from "../../utils/chat-message-socket.js";
import { ActionEconomy } from "../combat/action-economy.js";
import { AttackTracker } from "../combat/attack-tracker.js";
import { isActorInStartedCombatEncounter } from "../combat/combat-scope.js";
import { classifySpellForRouting, getUserSpellTargets, emitCastResolved } from "./spell-runtime.js";
import { getBlockingNoDurationUpkeep, spellNeedsDeferredDirectApplication, spellNeedsEffectApplication } from "./opposed/spell-helpers.js";
import { isCharacteristicDefense } from "./characteristic-defense-service.js";
import { normalizeSpellConfig } from "./spell-config.js";
import { resolveActor, resolveToken, resolveDoc } from "./opposed/schema.js";
import { getMessageState, selectDefenderEntry, getDefenderEntries, ensureBankedScaffold, allDefendersCommitted, getDefenderOutcome } from "./opposed/schema.js";
import { renderCard, renderUnopposedCard } from "./opposed/render.js";
import { dispatchAction, autoRollBanked } from "./opposed/actions.js";
import { resolveOutcome } from "./opposed/outcome-resolution.js";
import { updateCard as magicUpdateCard } from "./opposed/updater.js";
import { applyResolvedSpellEffects } from "./effects/spell-effects.js";
import { spellRequiresOriginAE, createOriginAE, replaceEnchantmentUpkeepOrigin } from "./effects/origin-effect.js";
import { buildRollContext } from "../rules/roll-context.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import {
  buildAutomaticEnchantmentCastResult,
  normalizeCastSourceCostMode,
  resolveItemContextFromCastSource,
  getItemSoulPoolSnapshot,
  spendItemSoulCost,
} from "./opposed/cast-source.js";
import { createAttackTraceId } from "../combat/attack-tracker-diagnostics.js";
import { resolveCombatantForActor } from "../../utils/document-resolution.js";
import { buildMagicCastContext } from "./opposed/cast-context.js";

const _FLAG_NS = FLAG_SCOPE;
const _FLAG_KEY = "magicOpposed";
const _CARD_VERSION = 2;
const _magicAutoRollLocalLocks = new Set();

function _collectDefenderRefs(cfg = {}) {
  const refs = [];
  const add = (ref) => {
    const value = typeof ref === "string" ? ref : ref?.uuid;
    const normalized = String(value ?? "").trim();
    if (normalized) refs.push(normalized);
  };

  for (const defender of (Array.isArray(cfg.defenders) ? cfg.defenders : [])) {
    add(defender?.tokenUuid ?? defender?.actorUuid ?? defender?.uuid ?? defender);
  }
  for (const ref of (Array.isArray(cfg.defenderTokenUuids) ? cfg.defenderTokenUuids : [])) add(ref);
  for (const ref of (Array.isArray(cfg.defenderActorUuids) ? cfg.defenderActorUuids : [])) add(ref);
  add(cfg.defenderTokenUuid ?? cfg.defenderActorUuid ?? cfg.defenderUuid);
  return refs;
}

function _buildDefenderEntry(actor, token, { direct = false } = {}) {
  return {
    actorUuid: actor.uuid,
    tokenUuid: token?.document?.uuid ?? token?.uuid ?? null,
    tokenName: token?.name ?? token?.document?.name ?? null,
    name: actor.name,
    defenseType: direct ? "Cannot Defend" : null,
    result: null,
    tn: null,
    noDefense: direct,
    apCost: direct ? 0 : 1,
    banked: { committed: direct, committedAt: direct ? Date.now() : null, committedBy: direct ? game.user?.id ?? null : null }
  };
}

function _resolveDefenderEntries(cfg = {}, options = {}) {
  const entries = [];
  const seen = new Set();

  for (const ref of _collectDefenderRefs(cfg)) {
    const doc = resolveDoc(ref);
    const token = resolveToken(doc);
    const actor = resolveActor(doc);
    if (!actor) continue;
    const key = token?.document?.uuid ?? token?.uuid ?? actor.uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(_buildDefenderEntry(actor, token, options));
  }

  return entries;
}

function _getResolvedSpellLevel(spell) {
  return Number(getSpellLevel(spell) ?? 1) || 1;
}

function _getResolvedSpellCost(spell, spellOptions = null, spent = null) {
  const castLevel = spellOptions?.castLevel ?? null;
  const fallbackCost = Number(getSpellCost(spell, castLevel) ?? 0) || 0;
  return Number(spent ?? fallbackCost) || 0;
}

function _ignoreTraining(cfg = {}) {
  return cfg?.ignoreTraining === true || cfg?.spellOptions?.ignoreTraining === true;
}

function _ignoreActionPoints(cfg = {}) {
  return cfg?.ignoreActionPoints === true || cfg?.spellOptions?.ignoreActionPoints === true;
}

function _isEnchantmentCastSource(castSource = null) {
  return castSource?.type === "enchantment";
}

function _isAutomaticEnchantmentCast(castSource = null) {
  return _isEnchantmentCastSource(castSource) && castSource?.skipCastingTest !== false;
}

function _getEnchantmentConfiguredCost(castSource = null) {
  return Math.max(0, Number(castSource?.cost ?? 0) || 0);
}

async function _spendActorMagickaFixed(actor, cost) {
  const current = Number(actor?.system?.magicka?.value ?? 0) || 0;
  const fixedCost = Math.max(0, Number(cost ?? 0) || 0);
  if (current < fixedCost) return { ok: false, consumed: 0, remaining: current, refund: 0 };
  const next = Math.max(0, current - fixedCost);
  const ok = await requestUpdateDocument(actor, { "system.magicka.value": next });
  if (!ok) return { ok: false, consumed: 0, remaining: current, refund: 0 };
  return { ok: true, consumed: fixedCost, remaining: next, refund: 0, source: "enchantmentMagicka" };
}

async function _syncEnchantmentUpkeepPointer(attacker, castSource = null, itemCastContext = null, spell = null, originEffect = null) {
  if (!spell?.system?.hasUpkeep) return;
  if (!_isEnchantmentCastSource(castSource)) return;
  const itemCtx = resolveItemContextFromCastSource(castSource, itemCastContext);
  if (!itemCtx?.item || !itemCtx?.slotId) return;
  await replaceEnchantmentUpkeepOrigin(attacker, {
    item: itemCtx.item,
    sourceLane: itemCtx.sourceLane,
    slotId: itemCtx.slotId,
    excludeOriginUuid: originEffect?.uuid ?? originEffect?.id ?? ""
  });
}

function _buildMagicAttackTrackerContext(attacker, explicitTokenUuid = null, source = "magic-opposed-workflow", extras = {}) {
  const tokenUuid = String(explicitTokenUuid ?? attacker?.token?.document?.uuid ?? attacker?.token?.uuid ?? "").trim();
  const combatantId = String(extras?.combatantId ?? resolveCombatantForActor(game?.combat ?? null, attacker, {
    tokenUuid: tokenUuid || null,
    actorUuid: attacker?.uuid ?? null,
    combatId: game?.combat?.id ?? null
  })?.id ?? "").trim();
  return {
    combatantId: combatantId || null,
    tokenUuid: tokenUuid || null,
    source,
    sourceTag: source,
    attackTraceId: String(extras?.attackTraceId ?? "").trim() || null,
    attackMode: "magic",
    phase: String(extras?.phase ?? "").trim() || null
  };
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

    const defenderEntries = _resolveDefenderEntries(cfg);

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

      if (!_ignoreTraining(cfg) && !canActorCastSpell(attacker, spell)) {
        ui.notifications.warn(`${attacker.name} is untrained in ${getSpellCastingSchool(spell) || "that school"} and cannot cast ${spell.name}.`);
        return null;
      }

      if (game?.combat) {
        const cls = classifySpellForRouting(spell);
        const trackerContext = _buildMagicAttackTrackerContext(attacker, cfg.attackerTokenUuid, "magic-opposed-pending", {
          attackTraceId: cfg?.attackTraceId ?? null,
          phase: "pending-gate"
        });
        if (cls?.isAttack && AttackTracker.hasExceededLimit(attacker, { attackMode: "magic" }, trackerContext)) {
          ui.notifications.warn(
            AttackTracker.getLimitWarning(attacker, { attackMode: "magic" }, trackerContext) || "Attack limit reached."
          );
          return null;
        }
      }

      // Direct spells resolve immediately (no casting/defense tests).
      if (Boolean(spell?.system?.isDirect) && !isCharacteristicDefense(spell)) {
        return this.castDirectTargeted({
          attackerTokenUuid: cfg.attackerTokenUuid,
          attackerActorUuid: cfg.attackerActorUuid,
          attackerUuid: cfg.attackerUuid,
          defenderTokenUuids: defenderEntries.map((def) => def.tokenUuid).filter(Boolean),
          defenderActorUuids: defenderEntries.filter((def) => !def.tokenUuid).map((def) => def.actorUuid).filter(Boolean),
          spellUuid: cfg.spellUuid,
          spellOptions: cfg.spellOptions,
          castActionType: cfg.castActionType,
          castSource: cfg.castSource ?? null,
          itemCastContext: cfg.itemCastContext ?? null
        });
      }

      const firstDefenderForCasting = defenderEntries[0]?.actorUuid ? resolveActor(defenderEntries[0].actorUuid) : null;
      tn = computeMagicCastingTN(attacker, spell, {
        ...spellOptions,
        opposingActor: firstDefenderForCasting,
        targetActor: firstDefenderForCasting,
      });
      healingDirect = isHealingSpell(spell) && Boolean(spell?.system?.isDirect);
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
        attackTraceId: String(cfg?.attackTraceId ?? "").trim() || createAttackTraceId("magic-opposed"),
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
        combatantId: resolveCombatantForActor(game?.combat ?? null, attacker, {
          tokenUuid: aToken?.document?.uuid ?? aToken?.uuid ?? null,
          actorUuid: attacker.uuid,
          combatId: game?.combat?.id ?? null
        })?.id ?? null,
        tokenName: aToken?.name ?? null,
        name: attacker.name,
        spellUuid: deferSpellChoice ? null : (spell?.uuid ?? null),
        preferredSpellUuid: requestedSpellUuid ?? spell?.uuid ?? null,
        pendingSpellChoice: deferSpellChoice,
        spellName: deferSpellChoice ? null : (spell?.name ?? null),
        spellSchool: deferSpellChoice ? null : (spell?.system?.school ?? ""),
        spellLevel: deferSpellChoice ? null : _getResolvedSpellLevel(spell),
        spellCost: deferSpellChoice ? null : _getResolvedSpellCost(spell, spellOptions),
        spellOptions: deferSpellChoice ? null : spellOptions,
        castActionType: String(cfg.castActionType ?? "primary"),
        apCost: 1,
        result: null,
        tn,
        mpSpent: null,
        mpRemaining: null,
        backfire: false,
        ignoreTraining: _ignoreTraining(cfg),
        ignoreActionPoints: _ignoreActionPoints(cfg),
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
   * @param {string[]} [cfg.defenderTokenUuids] - Defender token UUIDs
   * @param {string} [cfg.spellUuid]         - Spell item UUID
   * @param {SpellCastOptions} [cfg.spellOptions] - Casting options
   * @param {string} [cfg.castActionType]    - "primary" | "secondary"
   * @returns {Promise<ChatMessage|null>}
   */
  async castDirectTargeted(cfg = {}) {
    const aDoc = resolveDoc(cfg.attackerTokenUuid) ?? resolveDoc(cfg.attackerActorUuid) ?? resolveDoc(cfg.attackerUuid);
    const aToken = resolveToken(aDoc);
    const attacker = resolveActor(aDoc);
    if (!attacker) {
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

    const defenderEntries = _resolveDefenderEntries(cfg, { direct: true });
    if (!defenderEntries.length && String(spell?.system?.engine?.targeting?.mode ?? "").trim().toLowerCase() === "self") {
      defenderEntries.push(_buildDefenderEntry(attacker, aToken, { direct: true }));
    }
    if (!defenderEntries.length) {
      ui.notifications.warn("Direct spell requires both a caster and a target.");
      return null;
    }
    const primaryDefenderEntry = defenderEntries[0];
    const defender = resolveActor(primaryDefenderEntry.actorUuid);
    if (!defender) {
      ui.notifications.warn("Direct spell target could not be resolved.");
      return null;
    }

    if (!_ignoreTraining(cfg) && !canActorCastSpell(attacker, spell)) {
      ui.notifications.warn(`${attacker.name} is untrained in ${getSpellCastingSchool(spell) || "that school"} and cannot cast ${spell.name}.`);
      return null;
    }

    if (!canUserRollActor(game.user, attacker)) {
      ui.notifications.warn("You do not have permission to cast with this caster.");
      return null;
    }

    const spellOptions = cfg.spellOptions ?? {};
    const spellClassification = classifySpellForRouting(spell);
    const castSource = cfg?.castSource ? foundry.utils.deepClone(cfg.castSource) : null;
    const itemCastContext = cfg?.itemCastContext ? foundry.utils.deepClone(cfg.itemCastContext) : null;
    const castSourceMode = normalizeCastSourceCostMode(castSource);
    const isEnchantmentSource = castSource?.type === "enchantment";
    const ignoreAP = _ignoreActionPoints(cfg);
    const tn = computeMagicCastingTN(attacker, spell, {
      ...spellOptions,
      opposingActor: defender,
      targetActor: defender,
    });

    const blocking = getBlockingNoDurationUpkeep(attacker, spell?.uuid ?? null);
    if (blocking) {
      ui.notifications.warn(`${attacker.name} cannot cast another spell while maintaining ${blocking.spellName} (no listed duration Upkeep).`);
      return null;
    }

    const attackTraceId = String(cfg?.attackTraceId ?? "").trim() || createAttackTraceId("magic-direct");
    const directTrackerContext = _buildMagicAttackTrackerContext(attacker, cfg.attackerTokenUuid, "magic-opposed-direct", {
      attackTraceId,
      phase: "direct-gate"
    });
    const directInStartedCombat = isActorInStartedCombatEncounter(attacker, {
      tokenUuid: directTrackerContext.tokenUuid,
      combatantId: directTrackerContext.combatantId
    });
    if (spellClassification.isAttack && directInStartedCombat) {
      if (AttackTracker.hasExceededLimit(attacker, { attackMode: "magic" }, directTrackerContext)) {
        ui.notifications.warn(
          AttackTracker.getLimitWarning(attacker, { attackMode: "magic" }, directTrackerContext)
            || "Attack limit reached for this round."
        );
        return null;
      }
    }

    // Preflight: check ALL resources before consuming ANY.
    const apCost = 1;
    const currentAP = Number(attacker?.system?.action_points?.value ?? 0) || 0;
    if (!ignoreAP && directInStartedCombat && currentAP < apCost) {
      ui.notifications.warn(`${attacker.name} does not have enough Action Points to cast.`);
      return null;
    }

    let itemCtx = null;
    let magickaCostSnapshot = null;
    if (isEnchantmentSource) itemCtx = resolveItemContextFromCastSource(castSource, itemCastContext);
    if (isEnchantmentSource && !itemCtx?.item) {
      ui.notifications.warn("Stored enchantment source is missing its item context.");
      return null;
    }
    const configuredEnchantmentCost = isEnchantmentSource ? _getEnchantmentConfiguredCost(castSource) : 0;
    let enchantSoulCost = 0;
    if (isEnchantmentSource && castSourceMode === "soul") {
      enchantSoulCost = configuredEnchantmentCost;
      const pool = getItemSoulPoolSnapshot(itemCtx);
      if (pool.value < enchantSoulCost) {
        ui.notifications.warn(`${attacker.name} does not have enough Soul Energy (${pool.value}/${enchantSoulCost}) to cast.`);
        return null;
      }
    } else if (isEnchantmentSource && castSourceMode === "magicka") {
      const currentMagicka = Number(attacker?.system?.magicka?.value ?? 0) || 0;
      if (currentMagicka < configuredEnchantmentCost) {
        ui.notifications.warn(`${attacker.name} does not have enough Magicka (${currentMagicka}/${configuredEnchantmentCost}) to cast.`);
        return null;
      }
    } else if (!(isEnchantmentSource && castSourceMode === "none")) {
      const currentMagicka = Number(attacker?.system?.magicka?.value ?? 0) || 0;
      const magickaInfo = computeSpellAttemptMagickaCost(attacker, spell, spellOptions);
      magickaCostSnapshot = magickaInfo?.costSnapshot ?? null;
      const attemptCost = Number(magickaInfo?.attemptCost ?? magickaInfo?.cost ?? 0) || 0;
      if (currentMagicka < attemptCost) {
        ui.notifications.warn(`${attacker.name} does not have enough Magicka (${currentMagicka}/${attemptCost}) to cast.`);
        return null;
      }
    }

    // All pre-checks passed — now consume resources.
    const apReason = `Cast (Direct): ${spell.name}`;
    if (!ignoreAP) {
      const apSpentOk = await ActionEconomy.spendAP(attacker, apCost, {
        reason: apReason,
        silent: false,
        tokenUuid: directTrackerContext.tokenUuid,
        combatantId: directTrackerContext.combatantId
      });
      if (!apSpentOk) return null;
    }

    let magickaSpend = { ok: true, consumed: 0, remaining: Number(attacker?.system?.magicka?.value ?? 0) || 0, refund: 0 };
    if (isEnchantmentSource && castSourceMode === "soul") {
      const soulSpend = await spendItemSoulCost({ itemCtx, cost: enchantSoulCost });
      if (!soulSpend?.ok) {
        if (!ignoreAP && directInStartedCombat) {
          try {
            await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
          } catch (_e) { /* best-effort */ }
        }
        return null;
      }
      magickaSpend.consumed = Number(soulSpend.spent ?? enchantSoulCost ?? 0) || 0;
      magickaSpend.remaining = Number(attacker?.system?.magicka?.value ?? 0) || 0;
    } else if (isEnchantmentSource && castSourceMode === "magicka") {
      magickaSpend = await _spendActorMagickaFixed(attacker, configuredEnchantmentCost);
      if (!magickaSpend?.ok) {
        if (!ignoreAP && directInStartedCombat) {
          try {
            await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
          } catch (_e) { /* best-effort */ }
        }
        return null;
      }
    } else if (!(isEnchantmentSource && castSourceMode === "none")) {
      magickaSpend = await consumeSpellMagicka(attacker, spell, { ...spellOptions, costSnapshot: magickaCostSnapshot });
      if (!magickaSpend?.ok) {
        // Rollback AP on magicka failure
        if (!ignoreAP && directInStartedCombat) {
          try {
            await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
          } catch (_e) { /* best-effort */ }
        }
        return null;
      }
    }

    const result = _isAutomaticEnchantmentCast(castSource)
      ? buildAutomaticEnchantmentCastResult(castSource)
      : await doTestRoll(attacker, {
          target: tn.finalTN,
          allowLucky: true,
          allowUnlucky: true
        });

    if (spellClassification.isAttack) {
      try {
        const trackerContext = _buildMagicAttackTrackerContext(attacker, cfg.attackerTokenUuid, "magic-opposed-direct", {
          attackTraceId,
          phase: "direct-increment"
        });
        await AttackTracker.incrementAttacks(attacker, trackerContext);
        const warning = AttackTracker.getLimitWarning(attacker, { attackMode: "magic" }, trackerContext);
        if (warning) ui.notifications.warn(warning);
      } catch (err) {
        console.error("UESRPG | Failed to increment attack counter", { actor: attacker?.uuid, err });
      }
    }

    if (!result?.noRoll && result?.roll) {
      await result.roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      flavor: `<b>${spell.name}</b> — Casting Test (Direct)`,
      flags: { [_FLAG_NS]: { magicOpposedMeta: { stage: "direct-casting" } } }
      });
    }

    const needsBackfire = _isAutomaticEnchantmentCast(castSource)
      ? false
      : shouldBackfire(spell, attacker, result.isCriticalFailure, !result.isSuccess);
    if (needsBackfire) {
      await triggerBackfire(attacker, spell);
    }

    const refundInfo = isEnchantmentSource
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
      const castContext = buildMagicCastContext({
        spellLevel: Number(spell?.system?.level ?? 1),
        spellOptions,
        scalingChoices: spellOptions?.castLevel ? { level: spellOptions.castLevel } : null
      }, spell);
      try {
        originEffect = await createOriginAE(attacker, spell, {
          costPaid: Number(refundInfo?.finalCost ?? magickaSpend?.consumed ?? 0) || 0,
          scalingChoices: spellOptions?.castLevel ? { level: spellOptions.castLevel } : null,
          spellOptions,
          castContext,
          targetUuids: defenderEntries.map((entry) => entry.actorUuid).filter(Boolean),
          castWorldTime: Number(game.time?.worldTime ?? 0) || 0,
          castSource: castSource ?? null,
          itemCastContext: itemCastContext ?? null,
          magickaSpend: foundry.utils.deepClone(magickaSpend ?? null),
          casterTokenUuid: aToken?.document?.uuid ?? aToken?.uuid ?? cfg.attackerTokenUuid ?? null
        });
      } catch (_e) {
        console.warn("UESRPG | Failed to create Origin AE for direct spell", _e);
      }
    }
    if (result.isSuccess) {
      await _syncEnchantmentUpkeepPointer(attacker, castSource, itemCastContext, spell, originEffect);
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
        attackTraceId,
        schemaVersion: _CARD_VERSION,
        createdAt: Date.now(),
        createdBy: game.user.id,
        originalCastWorldTime: Number(game.time?.worldTime ?? 0) || 0,
        phase: "resolved",
        directUndefendable: true,
        noDefenseUnopposed: true,
        rollContext: directRollContext,
        rollOptions: Array.isArray(directRollContext?.rollOptions) ? directRollContext.rollOptions.slice() : [],
        itemCastContext: itemCastContext ?? null
      },
      status: "resolved",
      mode: "magic",
      attacker: {
        actorUuid: attacker.uuid,
        name: attacker.name,
        tokenUuid: aToken?.document?.uuid ?? aToken?.uuid ?? cfg.attackerTokenUuid ?? null,
        tokenName: aToken?.name ?? aToken?.document?.name ?? attacker.name,
        spellUuid: spell.uuid,
        spellName: spell.name,
        spellSchool: spell.system?.school ?? "",
        spellLevel: _getResolvedSpellLevel(spell),
        spellCost: _getResolvedSpellCost(spell, spellOptions, refundInfo?.finalCost ?? magickaSpend?.consumed ?? null),
        actionType: cfg.castActionType ?? "primary",
        apCost,
        tn,
        result,
        spellOptions,
        mpSpent: Number(refundInfo?.finalCost ?? magickaSpend?.consumed ?? 0) || 0,
        mpRefund: Number(refundInfo?.refund ?? 0) || 0,
        backfire: needsBackfire,
        ignoreTraining: _ignoreTraining(cfg),
        ignoreActionPoints: ignoreAP,
        castSource: castSource ?? null
      },
      defenders: defenderEntries,
      defender: defenderEntries[0],
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
      for (let index = 0; index < defenderEntries.length; index++) {
        const defenderEntry = defenderEntries[index];
        const targetActor = resolveActor(defenderEntry.actorUuid);
        if (!targetActor) continue;
        data.defender = defenderEntry;

        await resolveOutcome({
          message,
          data,
          attacker,
          defender: targetActor,
          defenderEntry,
          spell,
          isAoE,
          forcedHitLocation,
          skipAttackerSideEffects: index > 0,
          _updateCard: (msg, d) => magicUpdateCard(msg, d, renderCard)
        });
      }
      data.defender = defenderEntries[0];
      await magicUpdateCard(message, data, renderCard);
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

    if (!_ignoreTraining(cfg) && !canActorCastSpell(attacker, spell)) {
      ui.notifications.warn(`${attacker.name} is untrained in ${getSpellCastingSchool(spell) || "that school"} and cannot cast ${spell.name}.`);
      return null;
    }

    if (!canUserRollActor(game.user, attacker)) {
      ui.notifications.warn("You do not have permission to roll for this caster.");
      return null;
    }

    const spellOptions = cfg.spellOptions ?? {};
    const castSource = cfg?.castSource ? foundry.utils.deepClone(cfg.castSource) : null;
    const itemCastContext = cfg?.itemCastContext ? foundry.utils.deepClone(cfg.itemCastContext) : null;
    const castSourceMode = normalizeCastSourceCostMode(castSource);
    const isEnchantmentSource = castSource?.type === "enchantment";
    const ignoreAP = _ignoreActionPoints(cfg);
    const tn = computeMagicCastingTN(attacker, spell, {
      ...spellOptions,
      opposingActor: defender,
      targetActor: defender,
    });

    const blocking = getBlockingNoDurationUpkeep(attacker, spell?.uuid ?? null);
    if (blocking) {
      ui.notifications.warn(`${attacker.name} cannot cast another spell while maintaining ${blocking.spellName} (no listed duration Upkeep).`);
      return null;
    }

    const apCost = 1;
    const currentAP = Number(attacker?.system?.action_points?.value ?? 0) || 0;
    const castTrackerContext = _buildMagicAttackTrackerContext(attacker, cfg.attackerTokenUuid, "magic-opposed-cast", {
      attackTraceId: cfg?.attackTraceId ?? createAttackTraceId("magic-cast"),
      phase: "cast-gate"
    });
    const castInStartedCombat = isActorInStartedCombatEncounter(attacker, {
      tokenUuid: castTrackerContext.tokenUuid,
      combatantId: castTrackerContext.combatantId
    });
    if (!ignoreAP && castInStartedCombat && currentAP < apCost) {
      ui.notifications.warn("Not enough Action Points to cast the spell.");
      return null;
    }

    let itemCtx = null;
    let magickaCostSnapshot = null;
    if (isEnchantmentSource) itemCtx = resolveItemContextFromCastSource(castSource, itemCastContext);
    if (isEnchantmentSource && !itemCtx?.item) {
      ui.notifications.warn("Stored enchantment source is missing its item context.");
      return null;
    }
    const configuredEnchantmentCost = isEnchantmentSource ? _getEnchantmentConfiguredCost(castSource) : 0;
    let enchantSoulCost = 0;
    if (isEnchantmentSource && castSourceMode === "soul") {
      enchantSoulCost = configuredEnchantmentCost;
      const pool = getItemSoulPoolSnapshot(itemCtx);
      if (pool.value < enchantSoulCost) {
        ui.notifications.warn(`Not enough Soul Energy to cast ${spell?.name ?? "spell"}. Required: ${enchantSoulCost}, Available: ${pool.value}.`);
        return null;
      }
    } else if (isEnchantmentSource && castSourceMode === "magicka") {
      const currentMagicka = Number(attacker?.system?.magicka?.value ?? 0) || 0;
      if (currentMagicka < configuredEnchantmentCost) {
        ui.notifications.warn(`Not enough Magicka to cast ${spell?.name ?? "spell"}. Required: ${configuredEnchantmentCost}, Available: ${currentMagicka}.`);
        return null;
      }
    } else if (!(isEnchantmentSource && castSourceMode === "none")) {
      const magickaInfo = computeSpellAttemptMagickaCost(attacker, spell, spellOptions);
      magickaCostSnapshot = magickaInfo?.costSnapshot ?? null;
      const currentMagicka = Number(attacker?.system?.magicka?.value ?? 0) || 0;
      if (currentMagicka < magickaInfo.cost) {
        ui.notifications.warn(`Not enough Magicka to cast ${spell?.name ?? "spell"}. Required: ${magickaInfo.cost}, Available: ${currentMagicka}.`);
        return null;
      }
    }

    // Gate attack limit BEFORE consuming resources.
    const spellClassification = classifySpellForRouting(spell);
    if (spellClassification.isAttack && castInStartedCombat) {
      if (AttackTracker.hasExceededLimit(attacker, { attackMode: "magic" }, castTrackerContext)) {
        ui.notifications.warn(
          AttackTracker.getLimitWarning(attacker, { attackMode: "magic" }, castTrackerContext)
            || "Attack limit reached for this round."
        );
        return null;
      }
    }

    const castActionType = String(cfg.castActionType ?? "primary");
    const apReason = (castActionType === "secondary") ? "Cast Magic (Instant)" : "Cast Magic";
    if (!ignoreAP) {
      const apSpentOk = await ActionEconomy.spendAP(attacker, apCost, {
        reason: apReason,
        silent: false,
        tokenUuid: castTrackerContext.tokenUuid,
        combatantId: castTrackerContext.combatantId
      });
      if (!apSpentOk) return null;
    }

    if (spellClassification.isAttack) {
      try {
        await AttackTracker.incrementAttacks(
          attacker,
          _buildMagicAttackTrackerContext(attacker, cfg.attackerTokenUuid, "magic-opposed-cast", {
            attackTraceId: cfg?.attackTraceId ?? createAttackTraceId("magic-cast"),
            phase: "cast-increment"
          })
        );
      } catch (err) {
        console.error("UESRPG | Failed to increment attack counter", { actor: attacker?.uuid, err });
      }
    }

    let magickaSpend = { ok: true, consumed: 0, remaining: Number(attacker?.system?.magicka?.value ?? 0) || 0, refund: 0 };
    if (isEnchantmentSource && castSourceMode === "soul") {
      const soulSpend = await spendItemSoulCost({ itemCtx, cost: enchantSoulCost });
      if (!soulSpend?.ok) {
        if (!ignoreAP && castInStartedCombat) {
          try {
            await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
          } catch (_e) {
            // best-effort
          }
        }
        return null;
      }
      magickaSpend.consumed = Number(soulSpend.spent ?? enchantSoulCost ?? 0) || 0;
      magickaSpend.remaining = Number(attacker?.system?.magicka?.value ?? 0) || 0;
    } else if (isEnchantmentSource && castSourceMode === "magicka") {
      magickaSpend = await _spendActorMagickaFixed(attacker, configuredEnchantmentCost);
      if (!magickaSpend?.ok) {
        if (!ignoreAP && castInStartedCombat) {
          try {
            await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
          } catch (_e) {
            // best-effort
          }
        }
        return null;
      }
    } else if (!(isEnchantmentSource && castSourceMode === "none")) {
      magickaSpend = await consumeSpellMagicka(attacker, spell, { ...spellOptions, costSnapshot: magickaCostSnapshot });
      if (!magickaSpend?.ok) {
        if (!ignoreAP && castInStartedCombat) {
          try {
            await requestUpdateDocument(attacker, { "system.action_points.value": currentAP });
          } catch (_e) {
            // best-effort
          }
        }
        return null;
      }
    }

    const result = _isAutomaticEnchantmentCast(castSource)
      ? buildAutomaticEnchantmentCastResult(castSource)
      : await doTestRoll(attacker, {
          target: tn.finalTN,
          allowLucky: true,
          allowUnlucky: true
        });

    try {
      const refundInfo = isEnchantmentSource
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

    if (!result?.noRoll && result?.roll) {
      await result.roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      flavor: `<b>${spell.name}</b> — Casting Test`,
      flags: { [_FLAG_NS]: { magicOpposedMeta: { stage: "unopposed" } } }
      });
    }

    const needsBackfire = _isAutomaticEnchantmentCast(castSource)
      ? false
      : shouldBackfire(spell, attacker, result.isCriticalFailure, !result.isSuccess);
    if (needsBackfire) {
      await triggerBackfire(attacker, spell);
    }

    // Create Origin AE on the caster for persistent spells (only on success)
    let originEffect = null;
    if (result.isSuccess && spellRequiresOriginAE(spell)) {
      const castContext = buildMagicCastContext({
        spellLevel: _getResolvedSpellLevel(spell),
        spellOptions,
        scalingChoices: spellOptions?.castLevel ? { level: spellOptions.castLevel } : null
      }, spell);
      try {
        originEffect = await createOriginAE(attacker, spell, {
          costPaid: Number(magickaSpend?.consumed ?? 0) || 0,
          scalingChoices: spellOptions?.castLevel ? { level: spellOptions.castLevel } : null,
          spellOptions,
          castContext,
          targetUuids: [],
          castWorldTime: Number(game.time?.worldTime ?? 0) || 0,
          castSource: castSource ?? null,
          itemCastContext: itemCastContext ?? null,
          magickaSpend: foundry.utils.deepClone(magickaSpend ?? null),
          casterTokenUuid: aToken?.document?.uuid ?? aToken?.uuid ?? null
        });
      } catch (_e) {
        console.warn("UESRPG | Failed to create Origin AE for unopposed spell", _e);
      }
    }
    if (result.isSuccess) {
      await _syncEnchantmentUpkeepPointer(attacker, castSource, itemCastContext, spell, originEffect);
    }

    const targetingMode = String(spell?.system?.engine?.targeting?.mode ?? "").trim().toLowerCase();
    const isDirectSelf = Boolean(spell?.system?.isDirect) && targetingMode === "self";
    const needsDeferredDirect = isDirectSelf && spellNeedsDeferredDirectApplication(spell);

    if (needsDeferredDirect) {
      const note = "Self-target direct cast resolved with no defense.";
      const unopposedRollContext = buildRollContext({
        actor: attacker,
        targetActor: attacker,
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
          noDefenseUnopposed: true,
          directUndefendable: true,
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
          spellLevel: _getResolvedSpellLevel(spell),
          spellCost: _getResolvedSpellCost(spell, spellOptions, magickaSpend?.consumed ?? null),
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
          ignoreTraining: _ignoreTraining(cfg),
          ignoreActionPoints: ignoreAP,
          castSource: castSource ?? null
        },
        defender: {
          actorUuid: attacker.uuid,
          name: attacker.name,
          tokenUuid: aToken?.document?.uuid ?? aToken?.uuid ?? null,
          tokenName: aToken?.name ?? aToken?.document?.name ?? attacker.name,
          defenseType: "Cannot Defend",
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

      const defenderEntry = selectDefenderEntry(data, {}).defender;
      await resolveOutcome({
        message,
        data,
        attacker,
        defender: attacker,
        defenderEntry,
        spell,
        isAoE: false,
        forcedHitLocation: "",
        _updateCard: (msg, d) => magicUpdateCard(msg, d, renderCard)
      });

      return message;
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
          const castContext = buildMagicCastContext({
            spellLevel: _getResolvedSpellLevel(spell),
            spellOptions,
            scalingChoices: spellOptions?.castLevel ? { level: spellOptions.castLevel } : null
          }, spell);
          try {
            await applyResolvedSpellEffects({
              casterActor: attacker,
              targetActor: effectTarget,
              spell,
              payload: {
                actualCost: Number(magickaSpend?.consumed ?? 0) || 0,
                originalCastTime: Number(game.time?.worldTime ?? 0) || 0,
                spellOptions,
                scalingChoices: spellOptions?.castLevel ? { level: spellOptions.castLevel } : null,
                castContext,
                castSource: castSource ?? null,
                itemCastContext: itemCastContext ?? null,
                magickaSpend: foundry.utils.deepClone(magickaSpend ?? null),
                casterTokenUuid: aToken?.document?.uuid ?? aToken?.uuid ?? null
              }
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
        spellLevel: _getResolvedSpellLevel(spell),
        spellCost: _getResolvedSpellCost(spell, spellOptions, magickaSpend?.consumed ?? null),
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
        ignoreTraining: _ignoreTraining(cfg),
        ignoreActionPoints: ignoreAP,
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
      return await autoRollBanked(message, this, (msg, d) => magicUpdateCard(msg, d, renderCard), { reason: "hook" });
    } finally {
      _magicAutoRollLocalLocks.delete(messageId);
    }
  },

  /**
   * Resolve the outcome of the opposed test.
   * Delegates to outcome-resolution module.
   */
  async _resolveOutcome(message, data, attacker, defender, opts = {}) {
    const spell = opts?.spell ?? await fromUuid(data.attacker.spellUuid);
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
      if (data.context?.autoRollAborted) return;

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
      if (data.context?.autoRollAborted) return;

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
