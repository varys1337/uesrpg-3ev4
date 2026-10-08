import { resolveMagicCastContext } from "../../magic/opposed/cast-context.js";
import { updateCard as updateMagicCard } from "../../magic/opposed/updater.js";
import { _renderCard as renderCombatCard } from "../opposed/render.js";
import { getOwnerAndGmRecipientIds as getWhisperRecipients } from '../../../utils/chat-recipients.js';
export { getWhisperRecipients };
/**
 * src/core/combat/chat-handlers/combat-chat-apply.js
 *
 * Damage / healing application handlers for chat card buttons.
 * Also exports resolveActor and getWhisperRecipients for use by other chat-handler modules.
 */

import { DAMAGE_TYPES } from "../damage-automation.js";
import { canUserUpdateChatMessage } from "../../../utils/authority-proxy.js";
import { ChatOutcomeApplicationService } from "../../../application/combat/chat-outcome-application-service.js";

import {
  getMessageState as getMagicMessageState,
  getMagicDefenderDamage, setMagicDefenderDamage,
  getDefenderEntries as getMagicDefenderEntries,
} from "../../magic/opposed/schema.js";
import { renderCard as renderMagicCard } from "../../magic/opposed/render.js";
import { applyMagicDamage, applyMagicHealing } from "../../magic/damage-application.js";
import { applyResolvedSpellEffects } from "../../magic/effects/spell-effects.js";
import { applySpellResourceRestoration, hasSpellResourceRestoration, getSpellResourceRestorationRecipient } from "../../magic/services/resource-restoration-service.js";

import { _getDefenderDamage, _setDefenderDamage, _getDefenderEntries } from "../opposed/schema.js";

import { updateCard } from "../opposed/cards/updater.js";

import { resolveActorFromUuidSync, resolveUuidSync } from "../../../utils/uuid-cache.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { ApplyDamageService } from "../../../application/combat/apply-damage-service.js";
import { isPerfEnabled, monoMs, perfRecord } from "../../../utils/perf-tracker.js";
import { resumeDamageAftermath } from "../damage/deferred-operations.js";
import { restoreOutcomeItem } from "../../../utils/item-outcome-snapshot.js";

const _FLAG_NS = FLAG_SCOPE;
export function registerCombatOutcomeAuthorityIntent() {
  ChatOutcomeApplicationService.register();
}

function _mergeSupplementalGmDamageReport(existing, supplemental) {
  if (!supplemental || typeof supplemental !== "object") return existing ? foundry.utils.deepClone(existing) : null;
  if (!existing || typeof existing !== "object") return foundry.utils.deepClone(supplemental);

  const merged = foundry.utils.deepClone(existing);
  const extra = foundry.utils.deepClone(supplemental);

  merged.panelKey = String(existing?.panelKey ?? supplemental?.panelKey ?? "").trim() || `gm-damage:${Date.now()}`;
  merged.totalDamage = Math.max(0, Number(existing?.totalDamage ?? 0) || 0) + Math.max(0, Number(extra?.totalDamage ?? 0) || 0);

  const existingHp = existing?.hp ?? {};
  const extraHp = extra?.hp ?? {};
  merged.hp = {
    value: Number(extraHp?.value ?? existingHp?.value ?? 0) || 0,
    max: Number(existingHp?.max ?? extraHp?.max ?? 0) || 0,
    delta: Math.max(0, Number(existingHp?.delta ?? 0) || 0) + Math.max(0, Number(extraHp?.delta ?? 0) || 0),
  };

  if (existing?.tempHp || extra?.tempHp) {
    const existingTemp = existing?.tempHp ?? {};
    const extraTemp = extra?.tempHp ?? {};
    merged.tempHp = {
      value: Number(extraTemp?.value ?? existingTemp?.value ?? 0) || 0,
      absorbed: Math.max(0, Number(existingTemp?.absorbed ?? 0) || 0) + Math.max(0, Number(extraTemp?.absorbed ?? 0) || 0),
    };
  } else {
    merged.tempHp = null;
  }

  merged.buffers = Array.isArray(extra?.buffers) ? extra.buffers : (Array.isArray(existing?.buffers) ? existing.buffers : []);
  merged.defeated = Boolean(existing?.defeated) || Boolean(extra?.defeated);
  merged.woundTriggered = Boolean(existing?.woundTriggered) || Boolean(extra?.woundTriggered);
  merged.woundThreshold = Number(extra?.woundThreshold ?? existing?.woundThreshold ?? 0) || 0;

  const traitNotes = [
    ...(Array.isArray(existing?.traitNotes) ? existing.traitNotes : []),
    ...(Array.isArray(extra?.traitNotes) ? extra.traitNotes : []),
  ].map((note) => String(note ?? "").trim()).filter(Boolean);
  merged.traitNotes = Array.from(new Set(traitNotes));

  const extraSegments = (Array.isArray(extra?.segments) ? extra.segments : []).map((segment) => {
    const cloned = foundry.utils.deepClone(segment);
    const sourceLabel = String(extra?.source ?? "Follow-up").trim();
    cloned.sourceNotes = [
      `Follow-up: ${sourceLabel}`,
      ...(Array.isArray(cloned?.sourceNotes) ? cloned.sourceNotes : []),
    ];
    return cloned;
  });
  merged.segments = [
    ...(Array.isArray(existing?.segments) ? foundry.utils.deepClone(existing.segments) : []),
    ...extraSegments,
  ];

  return merged;
}

// ── Shared helpers (exported for use by other chat-handler modules) ───────────

/**
 * Resolve an Actor from a UUID or speaker.
 * @param {ChatMessage} message
 * @param {string|null} uuid
 * @returns {Actor|null}
 */
export function resolveActor(message, uuid) {
  if (uuid) {
    return resolveActorFromUuidSync(uuid);
  }
  const sp = message?.speaker;
  if (sp?.token) return canvas?.tokens?.get(sp.token)?.actor ?? null;
  if (sp?.actor) return game.actors?.get(sp.actor) ?? null;
  return null;
}

/**
 * Build the whisper recipient list for a given actor (all GMs + actor owners).
 * @param {Actor} actor
 * @returns {string[]}
 */


// ── Opposed card inline-damage marking ──────────────────────────────────────

function _resolvedDamageComponents(components) {
  if (!Array.isArray(components)) return null;
  const normalized = components
    .map((component) => ({
      kind: String(component?.kind ?? "external"),
      sourceLabel: String(component?.sourceLabel ?? "").trim() || null,
      displayLabel: String(component?.displayLabel ?? "").trim() || null,
      damageType: String(component?.damageType ?? "physical").trim().toLowerCase() || "physical",
      amount: Math.max(0, Number(component?.rawDamage ?? component?.amount ?? 0) || 0),
    }))
    .filter((component) => component.amount > 0);
  return normalized.length ? normalized : null;
}

function inlineApplicationLane(data, magic, targetUuid, options = {}) {
  const entries = magic ? getMagicDefenderEntries(data) : _getDefenderEntries(data);
  const defender = entries.find(entry => options.defenderTokenUuid ? entry.tokenUuid === options.defenderTokenUuid
    : entry.actorUuid === targetUuid || entry.tokenUuid === targetUuid)
    ?? ((!targetUuid || entries.length <= 1) ? data.defender : null);
  if (!defender) throw new Error('Application target is no longer on this card.');
  const damage = magic ? getMagicDefenderDamage(data, defender) : _getDefenderDamage(data, defender);
  if (!damage) throw new Error('No resolved outcome is available for this target.');
  return { defender, damage };
}

async function _updateInlineApplication(message, targetUuid, mutate, options = {}) {
  const magic = Boolean(getMagicMessageState(message));
  const updater = magic ? updateMagicCard : updateCard;
  const startedAt = isPerfEnabled() ? monoMs() : null;
  let kind = null;
  try {
    return await updater(message, (data) => {
      const { defender, damage } = inlineApplicationLane(data, magic, targetUuid, options);
      kind = damage._magicPayload?.isHealing === true || damage.mode === "healing" ? "healing" : "damage";
      mutate(damage);
      if (magic) setMagicDefenderDamage(data, defender, damage);
      else _setDefenderDamage(data, defender, damage);
      return data;
    }, magic ? renderMagicCard : renderCombatCard, options);
  } finally {
    if (startedAt !== null) perfRecord({
      event: "damage.chat.cardUpdate",
      messageId: message?.id ?? null,
      targetUuid,
      kind, family: magic ? "magic" : "combat",
      renderContent: options.renderContent !== false,
      durationMs: monoMs() - startedAt,
    });
  }
}

export async function appendSupplementalDamageReportToMessage(message, targetUuid, { gmDamageReport = null } = {}) {
  if (!message || !targetUuid || !gmDamageReport || typeof gmDamageReport !== "object") return false;
  if (!message.flags?.[_FLAG_NS]?.opposed && !getMagicMessageState(message)) return false;
  await _updateInlineApplication(message, targetUuid, (damage) => {
    damage.applied = true;
    damage.gmDamageReport = _mergeSupplementalGmDamageReport(damage.gmDamageReport, gmDamageReport);
  });
  return true;
}

function applyInlineReceipt(damage, receipt) {
  damage.applicationStatus = receipt.status;
  damage.applicationError = receipt.error ?? "";
  damage.applied = ["applied", "partial"].includes(receipt.status) || receipt.stages?.health?.status === "applied";
  const result = receipt.result ?? receipt.stages?.health?.result;
  const components = _resolvedDamageComponents(result?.components);
  if (components) damage.damageComponents = components;
  if (result?.gmDamageReport) damage.gmDamageReport = foundry.utils.deepClone(result.gmDamageReport);
  const castContext = receipt.stages?.castContext?.result?.castContext;
  if (castContext && damage._magicPayload) damage._magicPayload.castContext = castContext;
}

export async function synchronizeInlineChatOutcome(message, outcome, receipt) {
  if (!canUserUpdateChatMessage(message, game.user)) return false;
  const live = game.messages.get(message.id) ?? message;
  const magic = getMagicMessageState(live);
  const options = { defenderTokenUuid: outcome.defenderTokenUuid };
  const { damage } = inlineApplicationLane(magic ?? live.flags?.[_FLAG_NS]?.opposed ?? {}, Boolean(magic), outcome.targetUuid, options);
  const next = foundry.utils.deepClone(damage);
  applyInlineReceipt(next, receipt);
  if (!Object.keys(foundry.utils.diffObject(damage, next)).length) return { ok: true, changed: false };
  return _updateInlineApplication(live, outcome.targetUuid, damage => applyInlineReceipt(damage, receipt), options);
}

function requireResult(result) {
  if (result == null) throw Object.assign(new Error("The outcome could not be applied."), { committed: false });
  return result;
}

async function applyMagicOutcome(outcome, context) {
  const { message, actor: targetActor } = context;
  const payload = foundry.utils.deepClone(outcome.damage._magicPayload);
  if (outcome.damage.followupsStarted) throw new Error("Previously started spell consequences require manual review.");
  if (!payload) throw Object.assign(new Error("The stored spell result is unavailable."), { committed: false });
  const casterActor = resolveActorFromUuidSync(payload.casterUuid);
  const spell = payload.alchemySpell ? payload.spellSnapshot : payload.spellSnapshot
    ? restoreOutcomeItem(payload.spellSnapshot, payload.spellSnapshotContext)
    : payload.spellUuid ? resolveUuidSync(payload.spellUuid) : null;
  if (payload.needsEffects && (!spell || !casterActor)) {
    throw Object.assign(new Error("The spell or caster is no longer available."), { committed: false });
  }
  if (!payload.castContext?.spellStrengthResolved && spell) {
    const resolved = await context.stage("castContext", async () => ({ castContext: await resolveMagicCastContext({
      castContext: payload.castContext, spellOptions: payload.spellOptions, scalingChoices: payload.scalingChoices,
    }, spell, { actor: casterActor, message, user: message.author }) }));
    payload.castContext = resolved.castContext;
  }
  let result = {};
  if (outcome.kind === "healing" && Number(payload.damage ?? 0) <= 0) result = { healing: 0 };
  else if (outcome.kind !== "effect") {
    result = await context.stage("health", async () => requireResult(outcome.kind === "healing"
      ? await applyMagicHealing(targetActor, Number(payload.damage ?? 0), spell, {
          ...payload, messageId: message.id, receiptId: context.receiptId, casterActor, outcomeContext: context,
          isTemporary: Boolean(payload.isTemporary),
        })
      : await applyMagicDamage(targetActor, Number(payload.damage ?? 0), payload.damageType || "magic", spell, {
          ...payload, receiptId: context.receiptId, casterActor, skipChatMessage: true, outcomeContext: context,
        })));
  }
  result = await resumeDamageAftermath(result, context);
  if (result.spellAbsorbed) return result;
  const { getSpellConsequenceDocuments, settleSpellOwnedStages } = await import("../../magic/spell-runtime.js");
  let effectsApplied = false;
  if (payload.needsEffects) {
    const { findOriginAE } = await import("../../magic/effects/origin-effect.js");
    const origin = findOriginAE(casterActor, payload.spellUuid ?? spell.uuid);
    const applied = await context.stage("effects", async () => applyResolvedSpellEffects({
      casterActor, targetActor, spell, payload: { ...payload, message }, strict: true, deferOwnedStages: true, chatOutcomeExecution: true,
    }), { documents: origin ? [targetActor, origin] : [targetActor] });
    effectsApplied = Boolean(applied.effects?.length || applied.effectsApplied);
    await context.stage("spellConsequences", async () => {
      const effects = Array.from(targetActor.effects ?? []).filter(effect =>
        effect.flags?.[FLAG_SCOPE]?.spellUuid === (payload.spellUuid ?? spell.uuid)
        && effect.flags?.[FLAG_SCOPE]?.casterUuid === casterActor.uuid);
      return settleSpellOwnedStages({ caster: casterActor, target: targetActor, spell, effects,
        castContext: payload.castContext, message }, { kind: "effects" });
    }, { documents: getSpellConsequenceDocuments({ caster: casterActor, target: targetActor, spell }) });
  }
  if (outcome.kind !== "healing") {
    await context.stage("spellHit", async () => {
      const hit = { caster: casterActor, target: targetActor, spell, ...payload, message, effectsApplied };
      const completion = await settleSpellOwnedStages(hit, { kind: "hit" });
      hit.handledDomains = completion.handledDomains;
      hit.completion = completion;
      Hooks.callAll("uesrpg.spell.spellHitTarget", hit);
      Hooks.callAll("uesrpg.spellHitTarget", hit);
      return completion;
    }, { documents: getSpellConsequenceDocuments({ caster: casterActor, target: targetActor, spell }) });
  }
  if (hasSpellResourceRestoration(spell, payload)) {
    await context.stage("restoration", async () => {
      await applySpellResourceRestoration({ caster: casterActor, target: targetActor, spell, payload, message, strict: true });
      return { ok: true };
    }, { documents: [getSpellResourceRestorationRecipient({ caster: casterActor, target: targetActor, spell, payload })] });
  }
  return { ...result, effectsApplied };
}

/** Execute canonical flag data only; button datasets never supply mechanics. */
export async function executeInlineChatOutcome(outcome, context) {
  if (outcome.magic) return applyMagicOutcome(outcome, context);
  if (outcome.damage.mode === "coup") {
    const { executeChatOutcome } = await import("../opposed/actions/damage.js");
    return executeChatOutcome({ payload: { mode: outcome.damage.coupMode } }, context);
  }
  const { message, actor: targetActor } = context;
  const payload = outcome.payload;
  if (outcome.kind === "healing") {
    const result = await context.stage("health", async () => requireResult(await ApplyDamageService.applyHealing(targetActor,
      Number(payload.healing ?? 0), {
        source: payload.source ?? "Healing", isTemporary: String(payload.tempHp ?? "0") === "1",
        messageId: message.id, receiptId: context.receiptId, outcomeContext: context,
      })));
    return resumeDamageAftermath(result, context);
  }
  let damageComponents = payload.damageComponents;
  if (typeof damageComponents === "string") {
    try { damageComponents = JSON.parse(damageComponents); } catch { damageComponents = null; }
  }
  const attackerActor = resolveActorFromUuidSync(payload.attackerActorUuid);
  const weapon = payload.weaponUuid ? resolveUuidSync(payload.weaponUuid) : null;
  const result = await context.stage("health", async () => requireResult(await ApplyDamageService.applyChatCard({
    targetActor, receiptId: context.receiptId, outcomeContext: context,
    rawDamage: Number(payload.damage ?? 0), damageType: payload.damageType || DAMAGE_TYPES.PHYSICAL,
    dosBonus: Number(payload.dosBonus ?? 0), penetration: Number(payload.penetration ?? 0),
    hitLocation: payload.hitLocation || "Body", damagedValue: Number(payload.damagedValue ?? 0),
    source: payload.source || message.speaker?.alias || "Unknown",
    ignoreReduction: String(payload.ignoreReduction ?? "0") === "1",
    penetrateArmorForTriggers: String(payload.penetrateArmor ?? "0") === "1",
    forcefulImpact: String(payload.forcefulImpact ?? "0") === "1",
    pressAdvantage: String(payload.pressAdvantage ?? "0") === "1",
    magicSource: String(payload.magicSource ?? "0") === "1",
    sourceItemUuid: payload.sourceItemUuid || null, attackMode: payload.attackMode || null,
    movementAction: payload.movementAction || null,
    attackFromHidden: String(payload.attackHidden ?? "") === "1" ? true : String(payload.attackHidden ?? "") === "0" ? false : null,
    ammoUuid: payload.ammoUuid || null, damageComponents: Array.isArray(damageComponents) ? damageComponents : null,
    attackerActor, weapon, targetDomain: payload.targetDomain || "",
    chatContext: { parentMessageId: message.id, suppressStandaloneSummary: true },
  })));
  return resumeDamageAftermath(result, context);
}

export async function onApplyDamage(event, message) {
  event.preventDefault();
  return ChatOutcomeApplicationService.apply(message, { targetUuid: event.currentTarget.dataset.targetUuid, kind: "damage" });
}

export async function onApplyHealing(event, message) {
  event.preventDefault();
  return ChatOutcomeApplicationService.apply(message, { targetUuid: event.currentTarget.dataset.targetUuid, kind: "healing" });
}
