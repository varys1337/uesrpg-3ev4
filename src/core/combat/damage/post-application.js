import {
  requestCreateActiveEffect,
  requestUpdateDocument
} from "../../../utils/authority-proxy.js";
import { isPerfEnabled, monoMs, perfRecord, perfExpectHealthRefresh, perfApplicationContext } from "../../../utils/perf-tracker.js";
import { acquireLock, releaseLock } from "../../../utils/authority-proxy/shared.js";
import { snapshotDamageHookData, targetStateDocuments } from "./deferred-operations.js";
import { getAlchemyOnHitCarrier } from "../../alchemy/carrier-state.js";

function _isNpcActor(actor) {
  return String(actor?.type ?? "").trim().toLowerCase() === "npc";
}

export function resolveDamageUpdateTarget(actor) {
  // A synthetic Actor already belongs to its TokenDocument. Never redirect a
  // world Actor to an arbitrary placed token based on prototype-token defaults.
  return actor ?? null;
}

/** Common Temp HP -> HP arithmetic, after each source's own mitigation. */
export function calculateHealthDamage(currentHP, currentTempHP, damage) {
  const remaining = Math.max(0, Number(damage) || 0);
  const tempHPAbsorbed = Math.min(Math.max(0, Number(currentTempHP) || 0), remaining);
  return {
    newHP: Math.max(0, (Number(currentHP) || 0) - (remaining - tempHPAbsorbed)),
    newTempHP: Math.max(0, Number(currentTempHP) || 0) - tempHPAbsorbed,
    tempHPAbsorbed,
  };
}

export function readDamageReceipts(actor) {
  const value = actor?.flags?.[game.system.id]?.damageApplications;
  return Array.isArray(value) ? value.filter(entry => entry && typeof entry.id === "string") : [];
}

export function retainDamageReceipts(receipts) {
  const pending = receipts.filter(entry => entry?.outcomeId && entry.cardSynchronized !== true);
  const settled = receipts.filter(entry => !pending.includes(entry)).slice(-50);
  return [...settled, ...pending];
}

export async function updateDamageReceipt(actor, id, update) {
  const lockKey = `DamageReceipt:${actor.uuid}`;
  await acquireLock(lockKey);
  try {
    const receipts = readDamageReceipts(actor);
    const current = receipts.find(entry => entry.id === id) ?? null;
    const next = typeof update === "function" ? update(foundry.utils.deepClone(current)) : update;
    if (!next) return current;
    const saved = { ...next, id, at: next.at ?? Date.now() };
    if (current && !Object.keys(foundry.utils.diffObject(current, saved)).length) return current;
    const startedAt = isPerfEnabled() ? monoMs() : null;
    let updated;
    try {
      updated = await requestUpdateDocument(actor, {
        [`flags.${game.system.id}.damageApplications`]: retainDamageReceipts([
          ...receipts.filter(entry => entry.id !== id), saved,
        ]),
      }, { render: false });
    } finally {
      if (startedAt !== null) perfRecord({ event: "outcome.receipt.persist", actorUuid: actor.uuid,
        receiptId: id, messageId: saved.messageId ?? perfApplicationContext(actor).messageId ?? null,
        outcomeId: saved.outcomeId ?? perfApplicationContext(actor).outcomeId ?? null,
        status: saved.status, writeAttemptCount: 1, writeCount: updated ? 1 : 0, durationMs: monoMs() - startedAt });
    }
    if (!updated) throw new Error("The application receipt could not be saved.");
    return saved;
  } finally {
    releaseLock(lockKey);
  }
}

/** Commit a resource write and its chat-operation receipt together. */
export async function commitHealthUpdate(actor, updateData, { application = null, result = {}, receiptStatus = "partial" } = {}) {
  const lockKey = `DamageReceipt:${actor.uuid}`;
  await acquireLock(lockKey);
  try {
    const receiptId = application?.receiptId;
    const updates = { ...updateData };
    const pendingReceipts = Array.isArray(application?.additionalReceipts)
      ? application.additionalReceipts.filter((entry) => typeof entry?.id === "string" && entry.id)
      : [];
    const receipts = new Map(pendingReceipts.map((entry) => [entry.id, entry]));
    if (receiptId) {
      receipts.set(receiptId, { id: receiptId, at: Date.now(), status: receiptStatus, result });
    }
    if (receipts.size) {
      updates[`flags.${game.system.id}.damageApplications`] = retainDamageReceipts([
        ...readDamageReceipts(actor).filter((entry) => !receipts.has(entry.id)),
        ...receipts.values(),
      ]);
    }
    const hasUpdates = Object.keys(updates).length > 0;
    if (hasUpdates) {
      const startedAt = isPerfEnabled() ? monoMs() : null;
      const confirmRefresh = perfExpectHealthRefresh(actor, application, updateData["system.hp.value"]);
      let updated;
      try { updated = await requestUpdateDocument(actor, updates, { render: Object.keys(updateData).length > 0 }); }
      finally { confirmRefresh(Boolean(updated)); }
      if (startedAt !== null) perfRecord({
        event: "damage.health.commit",
        kind: application?.kind ?? "damage",
        messageId: application?.messageId ?? null,
        requestId: application?.requestId ?? null,
        writeCount: 1,
        actorUuid: actor?.uuid ?? null,
        applicationId: application?.id ?? null,
        receiptId: receiptId ?? null,
        ok: Boolean(updated),
        durationMs: monoMs() - startedAt,
      });
      const context = perfApplicationContext(actor);
      if (updated && context.outcomeStartedAt != null) perfRecord({
        event: "outcome.healthCommit", kind: application?.kind ?? "damage",
        actorUuid: actor.uuid, outcomeId: context.outcomeId, messageId: context.messageId,
        applicationId: application?.id ?? null, receiptId: receiptId ?? null,
        durationMs: monoMs() - context.outcomeStartedAt,
      });
      if (!updated) return false;
    }
    if (application) application.committed = { ...result, actor };
    return true;
  } finally {
    releaseLock(lockKey);
  }
}

export async function applyPostDamageUpdate(actor, { newHP, newTempHP, extraUpdates = {}, application = null, result = {} } = {}) {
  const updateTarget = resolveDamageUpdateTarget(actor);
  if (!updateTarget) return null;

  const updateData = {
    "system.hp.value": Number(newHP ?? updateTarget.system?.hp?.value ?? 0) || 0
  };

  if (newTempHP !== undefined) {
    updateData["system.tempHP"] = Number(newTempHP ?? updateTarget.system?.tempHP ?? 0) || 0;
  }

  for (const [key, value] of Object.entries(extraUpdates ?? {})) {
    updateData[key] = value;
  }

  const updated = await commitHealthUpdate(updateTarget, updateData, { application, result });
  return updated ? updateTarget : null;
}

export async function ensureUnconsciousEffect(targetActor) {
  if (!targetActor) return;
  const hasUnconscious = targetActor.effects?.some(
    (e) => e?.statuses?.has?.("unconscious") || e?.name === "Unconscious"
  );
  if (hasUnconscious) return;
  const created = await requestCreateActiveEffect(targetActor, {
    name: "Unconscious",
    icon: "icons/svg/unconscious.svg",
    duration: {},
    statuses: ["unconscious"],
    flags: { core: { statusId: "unconscious" } },
  });
  if (!created) throw new Error("The unconscious effect was not created.");
}

export async function finalizeDamageTargetState(targetActor, { newHP } = {}) {
  if (!targetActor) return;
  if (Number(targetActor.system?.hp?.value ?? newHP ?? 0) === 0 && !_isNpcActor(targetActor)) {
    await ensureUnconsciousEffect(targetActor);
  }
  if (_isNpcActor(targetActor)) {
    const { syncNpcDeathState } = await import("../../wounds/death-tests.js");
    await syncNpcDeathState(targetActor, { strict: true });
  }
}

export function needsDamageTargetState(targetActor, { newHP } = {}) {
  if (!targetActor) return true;
  // NPC synchronization can also remove stale death state at positive HP.
  if (_isNpcActor(targetActor)) return true;
  return Number(targetActor.system?.hp?.value ?? newHP ?? 0) === 0;
}

export async function dispatchDamageAppliedHook(
  targetActor,
  payload,
  { logPrefix = "UESRPG | uesrpgDamageApplied hook dispatch failed", logLevel = "error", aftermathBundle = null, parentApplication = null } = {}
) {
  if (aftermathBundle) {
    const stored = snapshotDamageHookData(payload);
    const carrier = getAlchemyOnHitCarrier(payload);
    const absorbs = payload.strikeEnchantmentSideEffects?.some(effect => effect.effectType === "absorb");
    if (payload.woundTriggered) aftermathBundle.stage({ key: "damageWounds", label: "Damage wound consequences",
      operation: { type: "wounds.damage", documentUuids: [targetActor.uuid], payload: stored }, run: async () =>
      (await import("../../wounds/wound-engine.js")).applyDamageWoundInteractions(targetActor, payload, { strict: true }) });
    aftermathBundle.stage({ key: "strikeOnHit", label: "Strike enchantment on-hit consequences",
      applicable: async () => (await import("../../enchanting/runtime/strike-on-hit.js")).hasStrikeOnHitEffects(payload),
      operation: { type: "strike.onHit", documentUuids: [targetActor.uuid, ...(absorbs && payload.weapon?.actor ? [payload.weapon.actor.uuid] : [])], payload: stored }, run: async () =>
      (await import("../../enchanting/runtime/strike-on-hit.js")).applyStrikeOnHit(targetActor, payload, { strict: true }) });
    aftermathBundle.stage({ key: "alchemyOnHit", label: "Alchemy on-hit consequences",
      applicable: () => Boolean(getAlchemyOnHitCarrier(payload)),
      operation: { type: "alchemy.onHit", documentUuids: [targetActor.uuid, ...(carrier?.parent ? [carrier.parent.uuid] : [])], payload: stored }, run: async () =>
      (await import("../../alchemy/runtime.js")).applyAlchemyOnHit(targetActor, { ...payload, _parentApplication: parentApplication }, { strict: true }) });
    aftermathBundle.stage({ key: "damageDeathState", label: "Damage death-state consequences",
      applicable: () => Number(payload.amountApplied ?? 0) > 0,
      operation: { type: "damage.deathState", documentUuids: targetStateDocuments(targetActor).map(doc => doc.uuid), payload: stored }, run: async () =>
      (await import("../../wounds/death-tests.js")).settleDamageDeathState(targetActor, payload, { strict: true }) });
    await aftermathBundle.commit();
    payload = { ...payload, handledDomains: [...(payload.handledDomains ?? []), "wounds", "strike", "alchemy", "deathState"] };
  }
  try {
    Hooks.callAll("uesrpgDamageApplied", targetActor, payload);
  } catch (err) {
    const logger = console?.[logLevel];
    if (typeof logger === "function") logger(logPrefix, err);
    else console.error(logPrefix, err);
  }
}

export function dispatchDamageLifecycleHook(
  stage,
  payload,
  { logPrefix = "UESRPG | Damage lifecycle hook failed", logLevel = "warn" } = {}
) {
  const key = String(stage ?? "").trim();
  if (!key) return;
  try {
    Hooks.callAll(`uesrpg.damage.${key}`, payload);
  } catch (err) {
    const logger = console?.[logLevel];
    if (typeof logger === "function") logger(`${logPrefix}: ${key}`, err);
    else console.warn(`${logPrefix}: ${key}`, err);
  }
}
