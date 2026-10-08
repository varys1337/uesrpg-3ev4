import { runAlchemyItemActivation } from "./operations.js";
import { measurePerfStage } from "../../utils/perf-tracker.js";
/**
 * Alchemy Runtime Automation
 *
 * NOTE (Project Policy): Alchemy is treated as a **core system mechanic**.
 * Runtime automation is therefore **always enabled** (no world-setting gating).
 *
 * Nothing in this file registers hooks at import time — call
 * initializeAlchemyRuntime() once at system ready.
 *
 * Covered automations:
 *   §7.1  Drink Potion      — consume item, apply instant effects, create upkeep AEs
 *   §7.2  Apply to Weapon   — apply poison/toxin as weapon Active Effects, emit confirmation
 *   §7.3  On-hit resolution — poison/toxin fires when a tagged weapon connects (via uesrpgDamageApplied)
 *   §7.4  Round tick-down   — upkeep/duration tracking via updateCombat hook
 *   §7.5  Chat card button  — click handler wired to renderChatMessage
 *
 * Internal helpers are not exported; apply helpers are exported through the
 * runtime barrel for sheet/chat/API entry points.
 */

import { getEffectByKey } from "./effects.js";
import { rollPotionBackfire } from "./backfire.js";
import {
  requestAtomicUpdateDocument,
  requestCreateEmbeddedDocuments,
  requestUpdateChatMessage,
  requestUpdateDocument,
  doesUserOwnActor,
} from "../../utils/authority-proxy.js";
import { t, tf } from "../../utils/i18n.js";
import { applyDamage, applyHealing } from "../combat/damage-automation.js";
import { applyDamageResolved } from "../combat/damage-resolver.js";
import { renderPoisonResistanceCard, renderToxinResistanceCard } from "./render.js";
import {
  ALCHEMY_DEFAULT_ICON,
  cloneAlchemyData as _cloneData,
  emitAlchemyRoll3d as _emitAlchemyRoll3d,
  FLAG_NS,
  getAlchemyFlags,
} from "./shared.js";
import {
  clearAppliedAlchemy as _clearAppliedAlchemy,
  buildWeaponAlchemyAEData,
  getAppliedAlchemy as _getAppliedAlchemy,
  getAlchemyOnHitCarrier,
  isAppliedAlchemyExpired as _isAppliedAlchemyExpired,
  updateAppliedAlchemyHits as _updateAppliedAlchemyHits,
} from "./carrier-state.js";
import {
  applyAlchemyToAmmo as applyAlchemyToAmmoImpl,
  applyAlchemyToTarget as applyAlchemyToTargetImpl,
  applyAlchemyToWeapon as applyAlchemyToWeaponImpl,
  consumeAlchemyItem as _consumeAlchemyItem,
  pickAlchemyCoatingTarget as pickAlchemyCoatingTargetImpl,
  pickAlchemyWeapon as pickAlchemyWeaponImpl,
} from "./apply.js";
import {
  buildSyntheticSpellFromPayload as _buildSyntheticSpellFromPayload,
  cloneEffectEntryWithPotency as _cloneEffectEntryWithPotency,
  getAlchemyEffectLabel as _effectLabel,
  normalizeStoredSpellEffect as _normalizeStoredSpellEffect,
} from "./spell-effects.js";
import { appendSupplementalDamageReportToMessage } from "../combat/chat-handlers/combat-chat-apply.js";
import { resolveMagicCastContext } from "../magic/opposed/cast-context.js";
import { getSpellDamageType, rollSpellHealing } from "../magic/magicka-utils.js";
import { doTestRoll } from "../../utils/degree-roll-helper.js";
import {
  applyConsequences,
  computeCharacteristicDefenseTN,
  formatConsequenceReport,
  processCharacteristicDefenseOutcome,
} from "../magic/characteristic-defense-service.js";
import { normalizeSpellConfig } from "../magic/spell-config.js";
import {
  ALCHEMY_POISON_CARD_KEY,
  ALCHEMY_TOXIN_CARD_KEY,
  alchemyNoteHtml as _alchemyNoteHtml,
  getPoisonCardState as _getPoisonCardState,
  getWhisperRecipientsForActor as _getWhisperRecipientsForActor,
  poisonCardFlagPatch as _poisonCardFlagPatch,
  postAlchemyUseMessage as _postAlchemyUseMessageImpl,
  toxinCardFlagPatch as _toxinCardFlagPatch,
} from "./runtime/chat-cards.js";
import { registerAlchemyRuntimeHooks } from "./runtime/hooks.js";
import {
  getEnduranceTN as _getEnduranceTN,
  resolveStaminaPaths as _resolveStaminaPaths,
  rollEnduranceTest as _rollEnduranceTest,
} from "./runtime/resource-updates.js";
import { buildEffectChange, buildEffectChangesData } from "../../utils/compat.js";
import { buildGenericAEData } from "../active-effects/modifier-evaluator.js";
import { createChatOutcome, chatOutcomeFlags } from "../config/outcome-application-policy.js";
import { resumeDamageAftermath } from "../combat/damage/deferred-operations.js";
import { prepareResolvedSpellEffectPayload } from "../magic/effects/spell-effects.js";
import { resolveActorFromUuidSync } from "../../utils/uuid-cache.js";

// ── Flag namespace constant (delegated to canonical FLAG_SCOPE from namespace.js) ──
const _ALCHEMY_ON_HIT_IN_FLIGHT = new Map();

function _requireApplication(result, label) {
  if (!result || result.execution?.status === "partial" || result.execution?.status === "failed" || result.aftermathSummary?.failed?.length) {
    const error = new Error(`${label} was not fully confirmed. Do not repeat a committed resource change.`);
    error.committed = result?.execution?.committed === true || Number(result?.healing ?? result?.damage ?? result?.granted ?? 0) !== 0;
    throw error;
  }
  return result;
}

async function _prepareAlchemySpellOutcome({ targetActor, sourceActor, syntheticSpell, castContext, normalizedEffect, label, kind, amount, damageType, rollHTML = "" }) {
  const prepared = kind === "effect" ? await prepareResolvedSpellEffectPayload({ casterActor: sourceActor, spell: syntheticSpell, payload: { castContext } }) : { castContext };
  return { ok: true, committed: false, noteHtml: _alchemyNoteHtml(label, `${amount || "Effects"} - application pending.`),
    outcome: createChatOutcome({ adapter: "alchemy.spell", kind, sourceActorUuid: sourceActor.uuid,
      targetUuid: targetActor.uuid, label, payload: {
        alchemySpell: true, spellSnapshot: syntheticSpell, spellUuid: syntheticSpell.uuid,
        casterUuid: sourceActor.uuid, damage: amount, damageType, rollHTML, source: syntheticSpell.name,
        isHealing: kind === "healing", isDamaging: kind === "damage", needsEffects: kind === "effect",
        isTemporary: damageType === "temporaryhealing" || damageType === "temporary healing", ...prepared,
        actualCost: Number(normalizedEffect.cost ?? 0) || 0,
        originalCastWorldTime: Number(game.time.worldTime ?? 0),
      } }) };
}

export async function executeChatOutcome(outcome, context) {
  const payload = outcome.payload;
  if (outcome.adapter === "alchemy.spell") {
    const { executeInlineChatOutcome } = await import("../combat/chat-handlers/combat-chat-apply.js");
    return executeInlineChatOutcome({ ...outcome, magic: true, damage: { _magicPayload: payload } }, context);
  }
  if (outcome.adapter === "alchemy.potion") {
    const result = await context.stage("potion", () => _applyPotionEffect(context.actor, getEffectByKey(payload.effectKey),
      payload.sl, payload.potency, payload.finalDuration, payload.params, { receiptId: context.receiptId, outcomeContext: context }));
    return resumeDamageAftermath(result, context);
  }
  if (outcome.adapter === "alchemy.poison") {
    const result = await context.stage("health", async () => _requireApplication(await applyDamageResolved(context.actor, {
      ...payload, rawDamage: payload.amount, receiptId: context.receiptId, outcomeContext: context,
    }), "Poison damage"));
    await resumeDamageAftermath(result, context);
    if (result.gmDamageReport && payload.parentMessageId) {
      const parent = game.messages.get(payload.parentMessageId);
      if (parent && game.user.isGM) await appendSupplementalDamageReportToMessage(parent, context.actor.uuid, result);
    }
    return result;
  }
  return _executePreparedToxin(outcome, context);
}

async function _applySerializedSpellEffect(targetActor, effectEntry, {
  casterActor = null,
  potency = 1,
  mode = null,
  noteLabelSuffix = "Spell",
  parentApplication = null,
} = {}) {
  const normalizedResult = await _normalizeStoredSpellEffect(effectEntry, {
    mode: String(mode ?? effectEntry?.mode ?? "potion").trim().toLowerCase() || "potion",
  });
  if (!normalizedResult?.ok) return normalizedResult;

  const normalizedEffect = _cloneEffectEntryWithPotency(normalizedResult.effectEntry, potency);
  const payload = normalizedEffect.directPayload ?? {};
  const syntheticSpell = _buildSyntheticSpellFromPayload(normalizedEffect);
  if (!syntheticSpell) {
    return { ok: false, reason: `${_effectLabel(normalizedEffect)} is missing its serialized spell payload.` };
  }

  const applicationKind = String(payload?.applicationKind ?? "").trim().toLowerCase();
  const damageType = String(payload?.damageType ?? getSpellDamageType(syntheticSpell) ?? "").trim().toLowerCase();
  const label = `${_effectLabel(normalizedEffect)} [${noteLabelSuffix}]`;
  const sourceActor = casterActor ?? targetActor;
  const spellConfig = normalizeSpellConfig(syntheticSpell);
  let castContext = null;

  if (String(mode ?? "").trim().toLowerCase() === "toxin" && spellConfig?.defenseModel === "characteristic") {
    syntheticSpell.system = syntheticSpell.system ?? {};
    syntheticSpell.system.engine = syntheticSpell.system.engine ?? {};
    syntheticSpell.system.engine.defenseModel = "characteristic";
    syntheticSpell.system.engine.characteristicDefense = {
      ...(syntheticSpell.system.engine.characteristicDefense ?? {}),
      defenderCharacteristic: "end",
    };

    if (spellConfig.characteristicDefense?.modifierMode !== "formula") {
      castContext = await resolveMagicCastContext({}, syntheticSpell, { actor: sourceActor });
    }
    const tnData = computeCharacteristicDefenseTN(targetActor, syntheticSpell, { caster: sourceActor, castContext });
    const finalTN = Math.max(1, Number(tnData?.finalTN ?? _getEnduranceTN(targetActor)) || _getEnduranceTN(targetActor) || 1);
    const result = await doTestRoll(targetActor, {
      target: finalTN,
      allowLucky: true,
      allowUnlucky: true,
    });
    _emitAlchemyRoll3d(result?.roll ?? null, { actor: targetActor });

    const defResult = {
      success: Boolean(result?.isSuccess),
      criticalSuccess: Boolean(result?.isCriticalSuccess),
      criticalFailure: Boolean(result?.isCriticalFailure),
      rollTotal: Number(result?.rollTotal ?? result?.roll?.total ?? 0) || 0,
      target: finalTN,
      degree: Number(result?.degree ?? 0) || 0,
      characteristic: "end",
      characteristicLabel: "Endurance",
      characteristicTotal: Number(tnData?.baseTN ?? _getEnduranceTN(targetActor)) || _getEnduranceTN(targetActor) || 0,
      modifier: Number(tnData?.totalMod ?? 0) || 0,
      onSuccess: spellConfig?.characteristicDefense?.onSuccess ?? "negate",
      onFailure: spellConfig?.characteristicDefense?.onFailure ?? "consequences",
      result,
      roll: result?.roll ?? null,
      tnData,
    };
    const outcome = await processCharacteristicDefenseOutcome(targetActor, syntheticSpell, defResult, {
      caster: sourceActor,
      suppressChat: true,
    });
    const outcomeLabel = defResult.success
      ? `${targetActor.name} resisted the toxin.`
      : `${targetActor.name} failed the Endurance save.`;
    const consequenceHtml = formatConsequenceReport(outcome?.consequenceReport ?? null, "Consequences");

    return {
      ok: true,
      noteHtml: _alchemyNoteHtml(
        label,
        `
          <div>END TN ${finalTN}, Roll ${defResult.rollTotal} - ${defResult.success ? "Success" : "Failure"}.</div>
          <div>${outcomeLabel}</div>
          ${consequenceHtml}
        `
      ),
    };
  }

  if (applicationKind === "healing") {
    const healRoll = await rollSpellHealing(syntheticSpell, { level: Number(normalizedEffect?.spellLevel ?? 1) || 1, actor: sourceActor, castContext });
    if (!castContext?.spellStrengthResolved) _emitAlchemyRoll3d(healRoll, { actor: sourceActor, damageType });
    const rolled = Math.max(0, Number(healRoll?.total ?? 0) || 0);
    const healed = Math.max(0, potency < 1 ? Math.floor(rolled * potency) : rolled);
    return _prepareAlchemySpellOutcome({ targetActor, sourceActor, syntheticSpell, castContext, normalizedEffect, label,
      kind: "healing", amount: healed, damageType, rollHTML: await healRoll.render() });
  }

  if (applicationKind === "spelleffects") {
    castContext = await resolveMagicCastContext({}, syntheticSpell, { actor: sourceActor });
    return _prepareAlchemySpellOutcome({ targetActor, sourceActor, syntheticSpell, castContext, normalizedEffect, label,
      kind: "effect", amount: 0, damageType });
  }

  if (applicationKind === "damage") {
    const formula = String(payload?.formula ?? syntheticSpell?.system?.damageFormula ?? "").trim();
    if (!formula) return { ok: false, reason: `${syntheticSpell.name} has no serialized damage formula.` };
    const stored = castContext?.spellStrengthSelectedRolls;
    const roll = stored?.length === 1 ? Roll.fromData(stored[0]) : await new Roll(formula).evaluate();
    if (!stored?.length) _emitAlchemyRoll3d(roll, { actor: sourceActor, damageType });
    const amount = Math.max(0, potency < 1 ? Math.floor((Number(roll?.total ?? 0) || 0) * potency) : Number(roll?.total ?? 0) || 0);
    return _prepareAlchemySpellOutcome({ targetActor, sourceActor, syntheticSpell, castContext, normalizedEffect, label,
      kind: "damage", amount, damageType, rollHTML: await roll.render() });
  }

  return { ok: false, reason: `${syntheticSpell.name} uses unsupported alchemy application kind "${applicationKind || "unknown"}".` };
}

// ── §7.1 Drink Potion ─────────────────────────────────────────────────────────

/**
 * Execute the drink-potion workflow for an alchemy item on a given actor.
 *
 * Resolution order:
 *   1. If the potion is Backfired → roll Potion Backfire Table first.
 *   2. For each effect: apply instant effects immediately; create upkeep AEs for timed ones.
 *   3. Consume the item (reduce qty or delete).
 *   4. Post result chat card.
 *
 * @param {Actor} actor
 * @param {Item}  potionItem
 */
export function drinkPotion(actor, potionItem) {
  return runAlchemyItemActivation(potionItem, async fresh => {
    if (fresh.parent?.uuid !== actor?.uuid) return { ok: false, reason: "Potion does not belong to this Actor.", execution: { status: "failed", committed: false } };
    const progress = { committed: false, consumed: false, rows: [], outcomes: [], backfireHtml: "", presentationStarted: false };
    try {
      return await _drinkPotion(actor, fresh, progress);
    } catch (error) {
      const committed = progress.committed || error?.committed === true;
      const status = committed ? "partial" : "failed";
      const reason = error?.message ?? String(error);
      ui.notifications.warn(`Potion ${status}: ${reason}`);
      if (!progress.presentationStarted) {
        try {
          await _postAlchemyUseMessage(actor, fresh, committed ? "Potion Partially Completed" : "Potion Not Applied",
            progress.backfireHtml + progress.rows.join("\n") + _alchemyNoteHtml("Completion", foundry.utils.escapeHTML(reason), "is-warning"));
        } catch (_error) { /* The completion result still reports the failed presentation. */ }
      }
      return { ok: false, reason, consumed: progress.consumed, execution: { status, committed } };
    }
  });
}

async function _finishPotionUse(actor, potionItem, title, html, progress) {
  progress.presentationStarted = true;
  await measurePerfStage("consumption", "presentation", { itemUuid: potionItem.uuid, writeCount: 1 },
    () => _postAlchemyUseMessage(actor, potionItem, title, html, chatOutcomeFlags(progress.outcomes)));
  const consumption = await _consumeAlchemyItem(actor, potionItem);
  if (!consumption?.ok) throw new Error(consumption?.reason ?? "Potion consumption was not confirmed.");
  progress.consumed = true;
  progress.committed = true;
  return { ok: true, consumed: true, execution: { status: "completed", committed: true } };
}

async function _drinkPotion(actor, potionItem, progress) {
  if (!actor || !potionItem) throw new Error("Missing Actor or potion Item.");
  const algData = getAlchemyFlags(potionItem);
  if (!algData || algData.kind !== "potion") {
    return { ok: false, reason: t("UESRPG.Notifications.Alchemy.NotBrewedPotion"), execution: { status: "failed", committed: false } };
  }

  // Only owner or GM may act.
  if (!actor.isOwner && !game.user.isGM) {
    ui.notifications.warn(t("UESRPG.Notifications.Alchemy.NotOwner"));
    return { ok: false, reason: t("UESRPG.Notifications.Alchemy.NotOwner"), execution: { status: "failed", committed: false } };
  }

  let halfPotency = false;
  let backfireHtml = "";

  // Backfired potion: roll the Potion Backfire Table before applying any effect.
  if (algData.backfired) {
    const bfResult = await rollPotionBackfire();
    _emitAlchemyRoll3d(bfResult?.rollObject ?? null, { actor });
    _emitAlchemyRoll3d(bfResult?.minorEffect?.rollObject ?? null, { actor });
    const bfEntry = bfResult.entry;
    backfireHtml = _alchemyNoteHtml(
      `Backfire (1d10=${bfResult.roll})`,
      `${bfEntry?.label ?? "?"} - ${bfEntry?.description ?? ""}`,
      "is-danger"
    );

    progress.backfireHtml = backfireHtml;
    switch (bfEntry?.outcome) {
      case "no_effect":
        progress.backfireHtml = backfireHtml;
        return _finishPotionUse(actor, potionItem, "Potion Consumed — No Effect", backfireHtml, progress);

      case "half_potency":
        halfPotency = true;
        break;

      case "minor_effects":
      case "dangerous":
        if (bfResult.minorEffect?.entry) {
          backfireHtml += _alchemyNoteHtml(
            `Minor Effect (2d8=${bfResult.minorEffect.roll})`,
            `${bfResult.minorEffect.entry.label} - ${bfResult.minorEffect.entry.description}`,
            "is-warning"
          );
        }
        if (bfEntry?.outcome === "dangerous") {
          const dmgRoll = new Roll("1d8");
          await dmgRoll.evaluate();
          _emitAlchemyRoll3d(dmgRoll, { actor, damageType: "physical" });
          progress.outcomes.push(createChatOutcome({ adapter: "damage.resolved", kind: "damage", sourceActorUuid: actor.uuid,
            targetUuid: actor.uuid, label: "Backfired Potion", payload: { amount: dmgRoll.total,
              ignoreReduction: true, damageType: "physical", source: "Backfired Potion", skipChatMessage: true } }));
        }
        progress.backfireHtml = backfireHtml;
        return _finishPotionUse(actor, potionItem, "Potion Consumed — Backfire!", backfireHtml, progress);

      case "sickened":
        backfireHtml += _alchemyNoteHtml("Sickened", "Make an Endurance test or gain Poisoned for 1d6 rounds.", "is-warning");
        progress.backfireHtml = backfireHtml;
        return _finishPotionUse(actor, potionItem, "Potion Consumed — Sickened!", backfireHtml, progress);

      default:
        break;
    }
  }

  const normalizedEffects = [];
  for (const rawEffect of algData.effects ?? []) {
    if (String(rawEffect?.effectSource ?? "catalog") !== "spell") {
      normalizedEffects.push(rawEffect);
      continue;
    }

    const normalized = await _normalizeStoredSpellEffect(rawEffect, { mode: "potion" });
    if (!normalized?.ok) {
      throw new Error(normalized?.reason ?? tf("UESRPG.Notifications.Alchemy.MustReBrewBeforeConsume", { effect: _effectLabel(rawEffect) }));
    }
    normalizedEffects.push(normalized.effectEntry);
  }

  // Apply each effect.
  const effectResultRows = progress.rows;

  for (const effectEntry of normalizedEffects) {
    if (String(effectEntry?.effectSource ?? "catalog") === "spell") {
      const resolved = await _applySerializedSpellEffect(actor, effectEntry, {
        casterActor: actor,
        potency: halfPotency ? 0.5 : 1,
        mode: "potion",
        noteLabelSuffix: "Spell",
      });
      if (!resolved?.ok) {
        throw new Error(resolved?.reason ?? t("UESRPG.Notifications.Alchemy.PotionEffectNotResolved"));
      }
      progress.committed ||= resolved.committed === true;
      if (resolved.outcome) progress.outcomes.push(resolved.outcome);
      effectResultRows.push(
        resolved.noteHtml
        ?? _alchemyNoteHtml(`${_effectLabel(effectEntry)} [Spell]`, `SL ${Number(effectEntry?.spellLevel ?? 1)}.`)
      );
      continue;
    }

    const { effectKey, spellLevel, finalDuration, attributes, params } = effectEntry;
    const effectDef = getEffectByKey(effectKey);
    if (!effectDef) continue;

    const sl = Number(spellLevel ?? 1);
    const potency = halfPotency ? 0.5 : 1;

    const resultRow = await measurePerfStage("consumption", "ownedFollowups", { itemUuid: potionItem.uuid, effectKey },
      () => _applyPotionEffect(actor, effectDef, sl, potency, finalDuration, params, { prepareOnly: true }));
    progress.committed ||= resultRow.committed === true;
    if (resultRow.outcome) progress.outcomes.push(resultRow.outcome);
    effectResultRows.push(resultRow.noteHtml);
  }

  return _finishPotionUse(actor, potionItem, "Potion Consumed", backfireHtml + effectResultRows.join("\n"), progress);
}

/**
 * Apply a single potion effect to an actor.
 * Returns an HTML row for the result chat card.
 */
async function _applyPotionEffect(actor, effectDef, sl, potency, finalDuration, params, { prepareOnly = false, receiptId = null, outcomeContext = null } = {}) {
  const key = effectDef.key;
  const label = effectDef.label;
  const magnitude = Math.max(1, Math.floor(sl * potency));

  if (prepareOnly && effectDef.automation !== "manual" && (["restoreHealth", "heal", "replenish", "restoreMagicka", "restoreStamina"].includes(key)
    || (effectDef.attributes.includes("upkeep") && finalDuration))) {
    return { committed: false, noteHtml: _alchemyNoteHtml(label, `SL ${sl} - application pending.`),
      outcome: createChatOutcome({ adapter: "alchemy.potion", kind: ["restoreHealth", "heal"].includes(key) ? "healing" : "effect",
        sourceActorUuid: actor.uuid, targetUuid: actor.uuid, label,
        payload: { effectKey: key, sl, potency, finalDuration, params } }) };
  }

  if (key === "restoreHealth" || key === "heal") {
    const amount = key === "heal" ? Math.max(1, Math.floor(2 * sl * potency)) : magnitude;
    const result = _requireApplication(await applyHealing(actor, amount, { source: label, skipChatMessage: true, receiptId, outcomeContext }), label);
    return { ...result, committed: result.execution?.committed === true, noteHtml: _alchemyNoteHtml(label, `+${Number(result.healing ?? 0)} HP restored`) };
  }

  if (key === "replenish" || key === "restoreMagicka" || key === "restoreStamina") {
    const amount = key === "replenish" ? Math.max(1, Math.floor(2 * sl * potency)) : magnitude;
    let calculated = false;
    let delta = 0;
    const confirmed = await requestAtomicUpdateDocument(actor, fresh => {
      calculated = true;
      const pool = key === "restoreStamina" ? _resolveStaminaPaths(fresh) : {
        valuePath: "system.magicka.value", value: Number(fresh.system?.magicka?.value ?? 0), max: Number(fresh.system?.magicka?.max ?? 0),
      };
      const next = Math.min(pool.max, pool.value + amount);
      delta = next - pool.value;
      return delta === 0 ? null : { [pool.valuePath]: next };
    }, { perfKind: "consumption" });
    if (!calculated || (delta !== 0 && !confirmed)) throw new Error(`${label} restoration was not confirmed.`);
    return { committed: Boolean(confirmed), noteHtml: _alchemyNoteHtml(label, `+${delta} ${key === "restoreStamina" ? "Stamina" : "Magicka"} restored`) };
  }

  if (effectDef.automation === "manual") {
    const parameterText = Object.values(params ?? {}).filter(Boolean).join(", ");
    return { committed: false, noteHtml: `<div class="uesrpg-da-row"><span class="k">${label}</span><span class="v">SL ${sl}${parameterText ? ` (${parameterText})` : ""} — GM resolves effect</span></div>` };
  }

  // Safely representable upkeep effects create a timed Active Effect.
  if (effectDef.attributes.includes("upkeep") && finalDuration) {
    const durationRounds = finalDuration.unit === "minutes"
      ? finalDuration.value * 10   // 1 minute = 10 rounds (6-second rounds)
      : finalDuration.value;

    const aeData = _buildPotionAE(actor, effectDef, sl, magnitude, durationRounds, params);
    const created = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [aeData]);
    if (created?.length !== 1) throw new Error(`${label} effect creation was not confirmed.`);

    return { committed: true, noteHtml: `<div class="uesrpg-da-row"><span class="k">${label}</span><span class="v">SL ${sl} — ${finalDuration.value} ${finalDuration.unit}</span></div>` };
  }

  // Dispel: descriptive only.
  if (key === "dispel") {
    return { committed: false, noteHtml: `<div class="uesrpg-da-row"><span class="k">${label}</span><span class="v">Dispel Strength ${magnitude} — resolve via magic automation</span></div>` };
  }

  // Fallback: descriptive.
  return { committed: false, noteHtml: `<div class="uesrpg-da-row"><span class="k">${label}</span><span class="v">SL ${sl} — GM resolves effect</span></div>` };
}


/**
 * Build an ActiveEffect data object for a timed potion effect.
 */
function _buildPotionAE(actor, effectDef, sl, magnitude, durationRounds, _params) {
  const changes = _buildAEChanges(effectDef.key, magnitude);
  const combatActive = !!game.combat?.active;

  return buildGenericAEData({
    source: "alchemy",
    stack: {
      policy: "replace",
      group: `alchemy.potion.${actor?.id ?? actor?.uuid ?? "actor"}.${effectDef.key}`,
      max: null,
      strengthKey: null,
    },
    name: `${effectDef.label} (Potion SL${sl})`,
    icon: ALCHEMY_DEFAULT_ICON,
    origin: actor.uuid,
    duration: combatActive
      ? { rounds: durationRounds, combat: game.combat.id }
      : { seconds: durationRounds * 6 },
    flags: {
      [FLAG_NS]: {
        spellEffect: true,
        alchemyPotion: true,
        potionEffectKey: effectDef.key,
        potionSL: sl,
      },
    },
    changes,
  });
}

/**
 * Map an effect key to AE changes array.
 * Only covers effects that have direct stat mapping; complex effects are descriptive.
 */
function _buildAEChanges(effectKey, magnitude) {
  switch (effectKey) {
    case "shieldSpell":
      return [buildEffectChange({ key: "magic_ar", type: "add", value: String(magnitude), priority: 20 })];
    case "fortifyAttribute":
      return [];
    case "feather":
      return [buildEffectChange({ key: "system.encumbrance.bonus", type: "add", value: String(-magnitude * 5), priority: 20 })];
    default:
      return [];
  }
}

// ── §7.2 Apply to Weapon ──────────────────────────────────────────────────────

/**
 * Tag a weapon item with poison or toxin data.
 * On the next confirmed hit the `uesrpgDamageApplied` hook fires the on-hit resolution.
 *
 * @param {Actor} actor         Owner of both items.
 * @param {Item}  alchemyItem   Poison or toxin item.
 * @param {Item}  weaponItem    Target weapon.
 */
export async function applyAlchemyToWeapon(actor, alchemyItem, weaponItem) {
  return applyAlchemyToWeaponImpl(actor, alchemyItem, weaponItem);
}

export async function applyAlchemyToAmmo(actor, alchemyItem, ammoItem) {
  return applyAlchemyToAmmoImpl(actor, alchemyItem, ammoItem);
}

export async function applyAlchemyToTarget(actor, alchemyItem, targetItem) {
  return applyAlchemyToTargetImpl(actor, alchemyItem, targetItem);
}

// ── §7.3 On-hit resolution ────────────────────────────────────────────────────

/**
 * Called on `uesrpgDamageApplied`.
 * Checks if the attacker's weapon has alchemyApplied data; if so, resolves it.
 */
export function applyAlchemyOnHit(targetActor, context, options = {}) {
  return measurePerfStage("onHit", "alchemy", { actorUuid: targetActor?.uuid, applicationId: context?.applicationId },
    () => _onDamageApplied(targetActor, context, options));
}

async function _onDamageApplied(targetActor, context, { strict = false } = {}) {
  const sourceItem = getAlchemyOnHitCarrier(context);
  if (!sourceItem) return;

  let applied = _getAppliedAlchemy(sourceItem);
  if (!applied) return;
  if (!game.user?.isGM && !doesUserOwnActor(game.user, sourceItem.parent)) {
    if (strict) throw new Error("GM authority is required for alchemy on-hit consequences.");
    return;
  }

  if (applied.source === "legacy-flag") {
    const legacyAe = buildWeaponAlchemyAEData({
      uuid: applied.itemUuid ?? null,
      name: applied.itemName ?? "Applied Alchemy",
    }, applied);
    const created = await requestCreateEmbeddedDocuments(sourceItem, "ActiveEffect", [legacyAe]);
    if (created?.length !== 1) throw new Error("Legacy coating migration was not confirmed.");
    if (!await requestUpdateDocument(sourceItem, { [`flags.${FLAG_NS}.alchemyApplied`]: null }, { render: false })) throw new Error("Legacy coating cleanup was not confirmed.");
    applied = _getAppliedAlchemy(sourceItem);
  }

  if (_isAppliedAlchemyExpired(applied)) {
    if (!await _clearAppliedAlchemy(sourceItem, applied)) throw new Error("Expired coating cleanup was not confirmed.");
    return;
  }

  const inFlightKey = [
    String(context?.applicationId ?? ""),
    String(sourceItem?.uuid ?? sourceItem?.id ?? ""),
    String(applied?.effectId ?? applied?.itemUuid ?? applied?.kind ?? ""),
  ].join(":");
  if (_ALCHEMY_ON_HIT_IN_FLIGHT.has(inFlightKey)) return _ALCHEMY_ON_HIT_IN_FLIGHT.get(inFlightKey);
  const pending = (async () => {
    if (applied.kind === "poison") {
      if (!await _clearAppliedAlchemy(sourceItem, applied)) throw new Error("Poison consumption was not confirmed.");
      if (!await _postPoisonResistanceCard(targetActor, sourceItem, applied, context)) throw new Error("Poison resistance presentation failed.");
    }
    if (applied.kind === "toxin") await _resolveToxinOnHit(targetActor, sourceItem, applied, context, { strict });
  })().finally(() => _ALCHEMY_ON_HIT_IN_FLIGHT.delete(inFlightKey));
  _ALCHEMY_ON_HIT_IN_FLIGHT.set(inFlightKey, pending);
  return pending;
}

/**
 * Create the pending poison resistance card.
 */
async function _postPoisonResistanceCard(targetActor, weaponItem, applied, context = {}) {
  const endTN = _getEnduranceTN(targetActor);
  if (endTN <= 0) {
    ui.notifications.warn(tf("UESRPG.Notifications.Alchemy.NoEnduranceTN", { target: targetActor?.name ?? t("UESRPG.UI.Target") }));
    return null;
  }

  const state = {
    kind: "poisonResistance",
    targetActorUuid: String(targetActor?.uuid ?? "").trim(),
    weaponUuid: String(weaponItem?.uuid ?? "").trim(),
    sourceActorUuid: weaponItem?.parent?.uuid ?? "",
    weaponName: String(weaponItem?.name ?? "Weapon").trim() || "Weapon",
    appliedEffectId: String(applied?.effectId ?? "").trim() || null,
    poisonLevel: Math.max(1, Number(applied?.poisonLevel ?? 1) || 1),
    damageFormula: String(applied?.damageFormula ?? "1d4").trim() || "1d4",
    parentMessageId: String(context?.chatContext?.parentMessageId ?? "").trim() || null,
    resolving: false,
    resolved: false,
    endTN,
    finalTN: null,
    rollTotal: null,
    passed: null,
    damageApplied: null,
    backfired: Boolean(applied?.backfired),
    statusNote: "",
  };

  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: renderPoisonResistanceCard({
      actorName: targetActor.name,
      actorUuid: targetActor.uuid,
      weaponName: weaponItem?.name ?? "Weapon",
      poisonLevel: state.poisonLevel,
      damageFormula: state.damageFormula,
      endTN,
      resolving: false,
      resolved: false,
    }),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    whisper: _getWhisperRecipientsForActor(targetActor),
    flags: {
      [FLAG_NS]: {
        [ALCHEMY_POISON_CARD_KEY]: state,
      },
    },
  });
}

export async function resolvePoisonResistanceFromChat({ messageId, action } = {}) {
  if (String(action ?? "").trim().toLowerCase() !== "roll") return;
  const message = game.messages?.get?.(String(messageId ?? "").trim()) ?? null;
  if (!message) return;

  const state = _getPoisonCardState(message);
  if (state?.resolved || state?.resolving) return;

  const targetActor = await fromUuid(String(state?.targetActorUuid ?? "").trim()).catch(() => null);
  if (!targetActor) {
    ui.notifications.warn(t("UESRPG.Notifications.Alchemy.PoisonResistanceNoTarget"));
    return;
  }

  const weaponItem = state?.weaponUuid
    ? await fromUuid(String(state.weaponUuid).trim()).catch(() => null)
    : null;
  const baseTN = Math.max(0, Number(state?.endTN ?? _getEnduranceTN(targetActor)) || _getEnduranceTN(targetActor));
  if (baseTN <= 0) {
    const failedState = {
      ...state,
      resolving: false,
      resolved: true,
      finalTN: 0,
      rollTotal: null,
      passed: null,
      damageApplied: 0,
      statusNote: tf("UESRPG.Notifications.Alchemy.NoEnduranceTN", { target: targetActor.name }),
    };
    await requestUpdateChatMessage(message, {
      content: renderPoisonResistanceCard({
        actorName: targetActor.name,
        actorUuid: targetActor.uuid,
        weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
        poisonLevel: state?.poisonLevel ?? 1,
        damageFormula: state?.damageFormula ?? "1d4",
        endTN: baseTN,
        finalTN: failedState.finalTN,
        rollTotal: failedState.rollTotal,
        passed: failedState.passed,
        damageApplied: failedState.damageApplied,
        resolving: false,
        resolved: true,
        statusNote: failedState.statusNote,
      }),
      ..._poisonCardFlagPatch(failedState),
    });
    return;
  }

  await requestUpdateChatMessage(message, {
    content: renderPoisonResistanceCard({
      actorName: targetActor.name,
      actorUuid: targetActor.uuid,
      weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
      poisonLevel: state?.poisonLevel ?? 1,
      damageFormula: state?.damageFormula ?? "1d4",
      endTN: baseTN,
      resolving: true,
      resolved: false,
    }),
    ..._poisonCardFlagPatch({
      ...state,
      resolving: true,
      resolved: false,
    }),
  });

  const endurance = await _rollEnduranceTest(targetActor, { label: "Poison Resistance" });
  if (!endurance?.ok) {
    const failedState = {
      ...state,
      resolving: false,
      resolved: true,
      finalTN: baseTN,
      rollTotal: null,
      passed: null,
      damageApplied: 0,
      statusNote: endurance?.reason ?? "Poison resistance test could not be rolled.",
    };
    await requestUpdateChatMessage(message, {
      content: renderPoisonResistanceCard({
        actorName: targetActor.name,
        actorUuid: targetActor.uuid,
        weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
        poisonLevel: state?.poisonLevel ?? 1,
        damageFormula: state?.damageFormula ?? "1d4",
        endTN: baseTN,
        finalTN: failedState.finalTN,
        rollTotal: failedState.rollTotal,
        passed: failedState.passed,
        damageApplied: failedState.damageApplied,
        resolving: false,
        resolved: true,
        statusNote: failedState.statusNote,
      }),
      ..._poisonCardFlagPatch(failedState),
    });
    return;
  }

  const outcomes = [];
  let damageApplied = 0;
  let statusNote = `${targetActor.name} resisted the poison.`;
  if (!endurance.success) {
    const damageRoll = await new Roll(String(state?.damageFormula ?? "1d4").trim() || "1d4").evaluate();
    _emitAlchemyRoll3d(damageRoll, { actor: targetActor, message, damageType: "poison" });
    damageApplied = Math.max(
      0,
      state?.backfired
        ? Math.floor((Number(damageRoll?.total ?? 0) || 0) / 2)
        : (Number(damageRoll?.total ?? 0) || 0)
    );

    outcomes.push(createChatOutcome({ adapter: "alchemy.poison", kind: "damage",
      sourceActorUuid: state.sourceActorUuid ?? weaponItem?.parent?.uuid ?? "", targetUuid: targetActor.uuid,
      label: `Poison (Level ${state?.poisonLevel ?? 1})`, payload: {
        amount: damageApplied, damageType: "poison", ignoreReduction: true, hitLocation: "Body",
        source: `Poison (Level ${state?.poisonLevel ?? 1})`, origin: state.weaponUuid || null,
        parentMessageId: state.parentMessageId, rollHTML: await damageRoll.render(),
        chatContext: { parentMessageId: state.parentMessageId || null, suppressStandaloneSummary: true, alchemyOnHitSuppressed: true },
      } }));

    statusNote = `${targetActor.name} failed the Endurance test: ${damageApplied} poison damage to Body resolved (ignores armor).`;
  }

  const nextState = {
    ...state,
    resolving: false,
    resolved: true,
    finalTN: endurance.tn,
    rollTotal: endurance.total,
    passed: endurance.success,
    damageApplied,
    statusNote,
  };
  await requestUpdateChatMessage(message, {
    content: renderPoisonResistanceCard({
      actorName: targetActor.name,
      actorUuid: targetActor.uuid,
      weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
      poisonLevel: state?.poisonLevel ?? 1,
      damageFormula: state?.damageFormula ?? "1d4",
      endTN: baseTN,
      finalTN: nextState.finalTN,
      rollTotal: nextState.rollTotal,
      passed: nextState.passed,
      damageApplied: nextState.damageApplied,
      resolving: false,
      resolved: true,
      statusNote: nextState.statusNote,
    }),
    ..._poisonCardFlagPatch(nextState),
    [`flags.${FLAG_NS}.chatOutcomes`]: { version: 1, entries: outcomes },
  });
}

/**
 * Build AE data for a condition-applying toxin effect.
 * Pure function — no Foundry calls.
 */
function _buildConditionAEData(conditionName, aeName, durationRounds, combatActive) {
  return {
    name: aeName,
    icon: "icons/magic/death/undead-ghost-strike-green.webp",
    statuses: [conditionName.toLowerCase()],
    duration: combatActive
      ? { rounds: durationRounds, combat: game.combat.id }
      : { seconds: durationRounds * 6 },
    flags: { [FLAG_NS]: { spellEffect: true, alchemyToxin: true } },
    ...buildEffectChangesData([]),
  };
}

function _isSaveGatedToxinEffect(effectEntry) {
  if (!effectEntry) return false;
  if (String(effectEntry?.effectSource ?? "catalog") === "spell") {
    const syntheticSpell = _buildSyntheticSpellFromPayload(effectEntry);
    if (!syntheticSpell) return false;
    const spellConfig = normalizeSpellConfig(syntheticSpell);
    return spellConfig?.defenseModel === "characteristic";
  }

  const effectDef = getEffectByKey(effectEntry?.effectKey);
  return Boolean(effectDef?.automation === "automatic" && effectDef?.toxinSave?.characteristic === "end");
}

async function _applyCatalogToxinEffect(targetActor, effectEntry, {
  durationRounds,
  combatActive,
  backfired = false,
} = {}) {
  const aeCreates = [];
  const noteRows = [];
  let damageToApply = 0;
  let magickaDrain = 0;
  let staminaDrain = 0;

  const sl = Number(effectEntry?.spellLevel ?? 1);
  const magnitude = backfired ? Math.max(1, Math.floor(sl / 2)) : sl;
  const effectDef = getEffectByKey(effectEntry?.effectKey);
  if (!effectDef) {
    return { ok: false, noteRows: [_alchemyNoteHtml("Unknown Effect", "Toxin effect definition could not be found.", "is-warning")] };
  }

  const key = effectDef.key;
  if (effectDef.automation === "manual") {
    const substitutedSave = effectDef.toxinSave?.label
      ? `required Endurance test (substituting for the listed ${effectDef.toxinSave.label} test)`
      : "listed effect";
    noteRows.push(_alchemyNoteHtml(effectDef.label, `SL ${sl} — GM resolves the ${substitutedSave} and outcome manually.`, "is-warning"));
  } else if (key === "drainHealth") {
    damageToApply += magnitude;
    noteRows.push(_alchemyNoteHtml(effectDef.label, `${magnitude} Health drained.`, "is-danger"));
  } else if (key === "drainMagicka") {
    magickaDrain += 4 * magnitude;
    noteRows.push(_alchemyNoteHtml(effectDef.label, `${4 * magnitude} Magicka drained.`));
  } else if (key === "fatigue") {
    staminaDrain += 1;
    noteRows.push(_alchemyNoteHtml(effectDef.label, "1 Stamina Point lost."));
  } else if (key === "drainStamina") {
    staminaDrain += magnitude;
    noteRows.push(_alchemyNoteHtml(effectDef.label, `${magnitude} Stamina drained.`));
  } else if (key === "paralyze") {
    aeCreates.push(_buildConditionAEData("Paralyzed", `Paralyze Toxin SL${sl}`, durationRounds, combatActive));
    noteRows.push(_alchemyNoteHtml(effectDef.label, `Paralyzed for ${durationRounds} rounds.`, "is-danger"));
  } else if (key === "silence") {
    aeCreates.push(_buildConditionAEData("Silenced", `Silence Toxin SL${sl}`, durationRounds, combatActive));
    noteRows.push(_alchemyNoteHtml(effectDef.label, `Silenced for ${durationRounds} rounds.`));
  } else if (key === "frenzy") {
    aeCreates.push(_buildConditionAEData("Frenzied", `Frenzy Toxin SL${sl}`, durationRounds, combatActive));
    noteRows.push(_alchemyNoteHtml(effectDef.label, `Frenzied for ${durationRounds} rounds.`, "is-danger"));
  } else if (key === "calm") {
    aeCreates.push(_buildConditionAEData("Calmed", `Calm Toxin SL${sl}`, durationRounds, combatActive));
    noteRows.push(_alchemyNoteHtml(effectDef.label, `Calmed for ${durationRounds} rounds.`));
  } else if (key === "demoralize") {
    aeCreates.push(_buildConditionAEData("Frightened", `Demoralize Toxin SL${sl}`, durationRounds, combatActive));
    noteRows.push(_alchemyNoteHtml(effectDef.label, `Frightened for ${durationRounds} rounds.`, "is-danger"));
  } else {
    noteRows.push(_alchemyNoteHtml(effectDef.label, `SL ${sl} — GM resolves effect.`, "is-warning"));
  }

  return { ok: true, aeCreates, noteRows, damageToApply, magickaDrain, staminaDrain };
}

async function _applyFailedToxinEffect(targetActor, effectEntry, {
  casterActor = null,
  potency = 1,
  durationRounds = 10,
  combatActive = false,
  parentApplication = null,
} = {}) {
  if (String(effectEntry?.effectSource ?? "catalog") === "spell") {
    const normalizedResult = await _normalizeStoredSpellEffect(effectEntry, { mode: "toxin" });
    if (!normalizedResult?.ok) return normalizedResult;
    const normalizedEffect = _cloneEffectEntryWithPotency(normalizedResult.effectEntry, potency);
    const syntheticSpell = _buildSyntheticSpellFromPayload(normalizedEffect);
    if (!syntheticSpell) {
      return { ok: false, reason: `${_effectLabel(effectEntry)} is missing its serialized spell payload.` };
    }

    const spellConfig = normalizeSpellConfig(syntheticSpell);
    if (spellConfig?.defenseModel === "characteristic") {
      const report = await applyConsequences(targetActor, spellConfig?.consequences ?? {}, {
        source: syntheticSpell.name,
        origin: syntheticSpell.uuid,
        sourceActorUuid: casterActor?.uuid ?? targetActor.uuid,
        halveFactor: 1,
      });
      return {
        ok: true,
        noteHtml: _alchemyNoteHtml(
          `${_effectLabel(effectEntry)} [Toxin]`,
          `Failed Endurance save. ${formatConsequenceReport(report, "Consequences")}`
        ),
      };
    }

    return _applySerializedSpellEffect(targetActor, normalizedEffect, {
      casterActor,
      potency,
      mode: "toxin",
      noteLabelSuffix: "Toxin",
      parentApplication,
    });
  }

  const applied = await _applyCatalogToxinEffect(targetActor, effectEntry, {
    durationRounds,
    combatActive,
    backfired: potency < 1,
  });
  if (!applied?.ok) return applied;

  const outcome = createChatOutcome({ adapter: "alchemy.toxin", kind: applied.damageToApply > 0 ? "damage" : "effect",
    sourceActorUuid: casterActor?.uuid ?? targetActor.uuid, targetUuid: targetActor.uuid,
    label: _effectLabel(effectEntry), payload: applied });
  return { ok: true, outcome, noteHtml: applied.noteRows.join("\n") };
}

async function _executePreparedToxin(outcome, context) {
  const applied = outcome.payload;
  const targetActor = context.actor;
  if (applied.damageToApply > 0) {
    const result = await context.stage("health", async () => _requireApplication(await applyDamage(targetActor, applied.damageToApply, "physical", {
      ignoreReduction: true, source: "Drain Health (Toxin)", receiptId: context.receiptId, skipChatMessage: true, outcomeContext: context,
      chatContext: { alchemyOnHitSuppressed: true, suppressStandaloneSummary: true },
    }), "Toxin damage"));
    await resumeDamageAftermath(result, context);
  }
  if (applied.magickaDrain > 0 || applied.staminaDrain > 0) {
    await context.stage("resources", async () => {
      let changed = false;
      const confirmed = await requestAtomicUpdateDocument(targetActor, fresh => {
        const update = {};
        if (applied.magickaDrain > 0) update["system.magicka.value"] = Math.max(0, Number(fresh.system?.magicka?.value ?? 0) - applied.magickaDrain);
        if (applied.staminaDrain > 0) {
          const pool = _resolveStaminaPaths(fresh);
          update[pool.valuePath] = Math.max(0, pool.value - applied.staminaDrain);
        }
        changed = Object.keys(foundry.utils.diffObject(fresh.toObject(), foundry.utils.expandObject(update))).length > 0;
        return update;
      });
      if (!confirmed && changed) throw new Error("Toxin resource change was not confirmed.");
      return { ok: true };
    });
  }
  if (applied.aeCreates?.length) {
    await context.stage("effects", async () => {
      const created = await requestCreateEmbeddedDocuments(targetActor, "ActiveEffect", applied.aeCreates);
      if (created?.length !== applied.aeCreates.length) throw new Error("Toxin effects were not fully created.");
      return { ok: true, effectsApplied: true };
    });
  }
  return { ok: true };
}

async function _postToxinResistanceCard(targetActor, weaponItem, applied, context = {}, saveEffects = [], directNotesHtml = "", directOutcomes = []) {
  const endTN = _getEnduranceTN(targetActor);
  if (endTN <= 0) {
    ui.notifications.warn(tf("UESRPG.Notifications.Alchemy.NoEnduranceTN", { target: targetActor?.name ?? t("UESRPG.UI.Target") }));
    return null;
  }

  const effectsHtml = saveEffects.map((effectEntry) =>
    _alchemyNoteHtml(_effectLabel(effectEntry), `Save-gated toxin effect (SL ${Number(effectEntry?.spellLevel ?? 1) || 1}).`)
  ).join("\n");

  const state = {
    kind: "toxinResistance",
    targetActorUuid: String(targetActor?.uuid ?? "").trim(),
    weaponUuid: String(weaponItem?.uuid ?? "").trim(),
    sourceActorUuid: weaponItem?.parent?.uuid ?? "",
    weaponName: String(weaponItem?.name ?? "Weapon").trim() || "Weapon",
    parentMessageId: String(context?.chatContext?.parentMessageId ?? "").trim() || null,
    resolving: false,
    resolved: false,
    endTN,
    finalTN: null,
    rollTotal: null,
    passed: null,
    statusNote: "",
    effects: _cloneData(saveEffects),
    directNotesHtml: String(directNotesHtml ?? ""),
    combatActive: Boolean(game.combat?.active),
    durationRounds: Number(applied?.durationRounds ?? 10) || 10,
    backfired: Boolean(applied?.backfired),
  };

  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: renderToxinResistanceCard({
      actorName: targetActor.name,
      actorUuid: targetActor.uuid,
      weaponName: weaponItem?.name ?? "Weapon",
      endTN,
      effectsHtml,
      directNotesHtml,
      resolving: false,
      resolved: false,
    }),
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    whisper: _getWhisperRecipientsForActor(targetActor),
    flags: {
      [FLAG_NS]: {
        [ALCHEMY_TOXIN_CARD_KEY]: state,
        chatOutcomes: { version: 1, entries: directOutcomes },
      },
    },
  });
}

/**
 * Apply toxin effects on hit and decrement remaining hits.
 * Batches all actor stat updates into one requestUpdateDocument call and
 * all AE creations into one createEmbeddedDocuments call to reduce lag.
 * When hitsRemaining reaches 0, the toxin is cleared from the weapon.
 */
async function _resolveToxinOnHit(targetActor, weaponItem, applied, context = {}, { strict = false } = {}) {
  const effects = applied.effects ?? [];
  const combatActive = !!game.combat?.active;
  const durationRounds = applied.durationRounds ?? 10;

  const hitsRemaining = Math.max(0, Number(applied.hitsRemaining ?? 1) - 1);
  if (hitsRemaining <= 0) {
    if (!await _clearAppliedAlchemy(weaponItem, applied)) throw new Error("Toxin consumption failed.");
  } else {
    if (!await _updateAppliedAlchemyHits(weaponItem, applied, hitsRemaining)) throw new Error("Toxin hit count was not confirmed.");
  }

  const saveEffects = [];
  const directNotes = [];
  const directOutcomes = [];
  const failures = [];
  const casterActor = weaponItem?.parent?.documentName === "Actor" ? weaponItem.parent : targetActor;

  for (const effectEntry of effects) {
    if (_isSaveGatedToxinEffect(effectEntry)) {
      saveEffects.push(effectEntry);
      continue;
    }

    const resolved = await _applyFailedToxinEffect(targetActor, effectEntry, {
      casterActor,
      potency: applied.backfired ? 0.5 : 1,
      durationRounds,
      combatActive,
      parentApplication: context?._parentApplication ?? null,
    });
    if (resolved.outcome) directOutcomes.push(resolved.outcome);
    if (!resolved?.ok) {
      failures.push(resolved?.reason ?? "Toxin effect failed.");
      directNotes.push(_alchemyNoteHtml(_effectLabel(effectEntry), resolved?.reason ?? "Toxin effect could not be applied.", "is-warning"));
    } else if (resolved.noteHtml) {
      directNotes.push(resolved.noteHtml);
    }
  }

  if (saveEffects.length) {
    if (!await _postToxinResistanceCard(targetActor, weaponItem, applied, context, saveEffects, directNotes.join("\n"), directOutcomes)) failures.push("Toxin resistance card failed.");
    if (strict && failures.length) throw new Error(failures.join("; "));
    return;
  }

  const gmIds = game.users?.filter((u) => u.isGM).map((u) => u.id) ?? [];
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: `
      <div class="uesrpg-alchemy-brew-card">
        <div class="hdr">
          <div class="hdr-text">
            <div class="title">${targetActor.name} - Toxin Delivered</div>
            <div class="sub">GM-visible toxin resolution</div>
          </div>
        </div>
        <div class="body">
          ${directNotes.join("\n") || _alchemyNoteHtml("Effects", "No toxin effects resolved.")}
          ${_alchemyNoteHtml("Hits Remaining", `${hitsRemaining}`)}
        </div>
      </div>
    `,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    whisper: gmIds,
    blind: true,
    flags: chatOutcomeFlags(directOutcomes),
  });
  if (strict && failures.length) throw new Error(failures.join("; "));
  return;
}

// ── §7.4 Round tick-down ──────────────────────────────────────────────────────

/**
 * Called on `updateCombat` when the round advances.
 * The Foundry AE duration system decrements `remaining` each round automatically.
 * This hook exists as an extension point for custom countdown chat messages.
 */
export async function resolveToxinResistanceFromChat({ messageId, action } = {}) {
  if (String(action ?? "").trim().toLowerCase() !== "roll") return;
  const message = game.messages?.get?.(String(messageId ?? "").trim()) ?? null;
  if (!message) return;

  const state = _cloneData(message?.flags?.[FLAG_NS]?.[ALCHEMY_TOXIN_CARD_KEY] ?? {});
  if (state?.resolved || state?.resolving) return;

  const targetActor = await fromUuid(String(state?.targetActorUuid ?? "").trim()).catch(() => null);
  if (!targetActor) {
    ui.notifications.warn(t("UESRPG.Notifications.Alchemy.ToxinResistanceNoTarget"));
    return;
  }

  const weaponItem = state?.weaponUuid
    ? await fromUuid(String(state.weaponUuid).trim()).catch(() => null)
    : null;
  const baseTN = Math.max(0, Number(state?.endTN ?? _getEnduranceTN(targetActor)) || _getEnduranceTN(targetActor));
  const effectsHtml = Array.isArray(state?.effects)
    ? state.effects.map((effectEntry) =>
      _alchemyNoteHtml(_effectLabel(effectEntry), `Save-gated toxin effect (SL ${Number(effectEntry?.spellLevel ?? 1) || 1}).`)
    ).join("\n")
    : "";

  await requestUpdateChatMessage(message, {
    content: renderToxinResistanceCard({
      actorName: targetActor.name,
      actorUuid: targetActor.uuid,
      weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
      endTN: baseTN,
      effectsHtml,
      directNotesHtml: String(state?.directNotesHtml ?? ""),
      resolving: true,
      resolved: false,
    }),
    ..._toxinCardFlagPatch({
      ...state,
      resolving: true,
      resolved: false,
    }),
  });

  const endurance = await _rollEnduranceTest(targetActor, { label: "Toxin Resistance" });
  if (!endurance?.ok) {
    const failedState = {
      ...state,
      resolving: false,
      resolved: true,
      finalTN: baseTN,
      rollTotal: null,
      passed: null,
      statusNote: endurance?.reason ?? "Toxin resistance test could not be rolled.",
    };
    await requestUpdateChatMessage(message, {
      content: renderToxinResistanceCard({
        actorName: targetActor.name,
        actorUuid: targetActor.uuid,
        weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
        endTN: baseTN,
        effectsHtml,
        directNotesHtml: String(state?.directNotesHtml ?? ""),
        finalTN: failedState.finalTN,
        rollTotal: failedState.rollTotal,
        passed: failedState.passed,
        resolving: false,
        resolved: true,
        statusNote: failedState.statusNote,
      }),
      ..._toxinCardFlagPatch(failedState),
    });
    return;
  }

  const outcomes = foundry.utils.deepClone(message.flags?.[FLAG_NS]?.chatOutcomes?.entries ?? []);
  const noteRows = [];
  if (!endurance.success) {
    for (const effectEntry of Array.isArray(state?.effects) ? state.effects : []) {
      const resolved = await _applyFailedToxinEffect(targetActor, effectEntry, {
        casterActor: resolveActorFromUuidSync(state.sourceActorUuid) ?? (weaponItem?.parent?.documentName === "Actor" ? weaponItem.parent : targetActor),
        potency: state?.backfired ? 0.5 : 1,
        durationRounds: Number(state?.durationRounds ?? 10) || 10,
        combatActive: state?.combatActive === true,
      });
      if (resolved.outcome) outcomes.push(resolved.outcome);
      if (!resolved?.ok) {
        noteRows.push(_alchemyNoteHtml(_effectLabel(effectEntry), resolved?.reason ?? "Toxin effect could not be applied.", "is-warning"));
      } else if (resolved.noteHtml) {
        noteRows.push(resolved.noteHtml);
      }
    }
  }

  const statusNote = endurance.success
    ? `${targetActor.name} resisted the save-gated toxin effects.`
    : `${targetActor.name} failed the Endurance test; toxin effects resolved.`;
  const combinedEffectsHtml = [
    effectsHtml,
    !endurance.success ? noteRows.join("\n") : "",
  ].filter(Boolean).join("\n");

  const nextState = {
    ...state,
    resolving: false,
    resolved: true,
    finalTN: endurance.tn,
    rollTotal: endurance.total,
    passed: endurance.success,
    statusNote,
  };
  await requestUpdateChatMessage(message, {
    content: renderToxinResistanceCard({
      actorName: targetActor.name,
      actorUuid: targetActor.uuid,
      weaponName: state?.weaponName ?? weaponItem?.name ?? "Weapon",
      endTN: baseTN,
      effectsHtml: combinedEffectsHtml,
      directNotesHtml: String(state?.directNotesHtml ?? ""),
      finalTN: nextState.finalTN,
      rollTotal: nextState.rollTotal,
      passed: nextState.passed,
      resolving: false,
      resolved: true,
      statusNote,
    }),
    ..._toxinCardFlagPatch(nextState),
    [`flags.${FLAG_NS}.chatOutcomes`]: { version: 1, entries: outcomes },
  });
}

function _onUpdateCombat(combat, updateData) {
  if (!("round" in updateData)) return;
  if (!game.user?.isGM) return;

  for (const actor of game.actors?.contents ?? []) {
    for (const item of actor?.items ?? []) {
      const applied = _getAppliedAlchemy(item);
      if (!applied) continue;
      if (_isAppliedAlchemyExpired(applied)) {
        _clearAppliedAlchemy(item, applied).catch((err) => {
          console.warn("UESRPG | Failed to clear expired alchemy coating", err);
        });
      }
    }
  }
}

// ── §7.5 Chat button handler ──────────────────────────────────────────────────

/**
 * Prompt the actor's owner to pick an equipped weapon from a simple dialog.
 * @param {Actor} actor
 * @returns {Promise<Item|null>}
 */
export async function pickAlchemyWeapon(actor) {
  return pickAlchemyWeaponImpl(actor);
}

export async function pickAlchemyCoatingTarget(actor) {
  return pickAlchemyCoatingTargetImpl(actor);
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function _postAlchemyUseMessage(actor, item, title, bodyHtml, flags = {}) {
  const created = await _postAlchemyUseMessageImpl(actor, item, title, bodyHtml, flags);
  if (!created) throw new Error("Alchemy summary creation was not confirmed.");
  return created;
}

// ── Initialization ────────────────────────────────────────────────────────────

/**
 * Register all alchemy runtime hooks.
 * Call once from the system.js ready handler.
 * Idempotent — safe to call multiple times; duplicate registrations are silently skipped.
 */
export function initializeAlchemyRuntime() {
  registerAlchemyRuntimeHooks({
    onDamageApplied: _onDamageApplied,
    onUpdateCombat: _onUpdateCombat,
  });
}
