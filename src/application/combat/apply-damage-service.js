import { applyDamage, applyHealing } from "../../core/combat/damage/apply.js";
import { DAMAGE_TYPES } from "../../core/combat/damage/types.js";
import { applyDamageResolved } from "../../core/combat/damage/resolver/resolve.js";
import { readDamageReceipts, updateDamageReceipt } from "../../core/combat/damage/post-application.js";
import { acquireLock, releaseLock } from "../../utils/authority-proxy/shared.js";
import { applyHybridDamageToWarfareUnit, isWarfareActor } from "../../core/combat/opposed/hybrid.js";
import { resolveActorDocument } from "../foundry/adapters.js";
import { requireMassCombatEnabled } from "../../core/homebrew/settings.js";
import { isPerfEnabled, monoMs, perfRecord, perfTrackApplication } from "../../utils/perf-tracker.js";
import { createActionResult, withActionResult, addActionErrorContext } from "../action-results.js";

const _activeApplications = new WeakMap();

async function resolveTargetActor(targetActorOrUuid) {
  try {
    const actor = await resolveActorDocument(targetActorOrUuid);
    if (actor?.documentName === "Actor") return actor;
    throw new Error("Invalid target actor for damage application.");
  } catch (error) { throw addActionErrorContext(error, { owner: "damage", scope: "target resolution", status: "rejected",
    reason: String(error.message ?? error), references: { actorUuid: typeof targetActorOrUuid === "string" ? targetActorOrUuid : targetActorOrUuid?.uuid } }); }
}

/** Damage and healing enter here; source calculators retain their rules. */
async function executeResult(targetActorOrUuid, options, run, kind = "damage") {
  const actor = await resolveTargetActor(targetActorOrUuid);
  if (isWarfareActor(actor) && !requireMassCombatEnabled()) return { value: null, actionResult: createActionResult({
    owner: "damage", scope: kind, status: "blocked", reason: "Mass Warfare is disabled.", references: { actorUuid: actor.uuid } }) };
  const application = {
    id: String(options.applicationId ?? "").trim() || foundry.utils.randomID(),
    receiptId: String(options.receiptId ?? "").trim(),
    additionalReceipts: Array.isArray(options._additionalDamageReceipts) ? options._additionalDamageReceipts : [],
    kind,
    source: options.source ?? (kind === "healing" ? "Healing" : "Attack"),
    messageId: options.messageId ?? null,
    requestId: options.requestId ?? null,
    committed: null,
    writeAttempted: false, writeConfirmed: false, noEffect: false,
  };
  const describe = (status, commitment, reason = null) => createActionResult({ owner: "damage", scope: kind, status, commitment, reason,
    references: { applicationId: application.id, receiptId: application.receiptId, requestId: application.requestId,
      messageId: application.messageId, actorUuid: actor.uuid } });
  const lockKey = `DamageApplication:${actor.uuid}`;
  const startedAt = isPerfEnabled() ? monoMs() : null;
  // Only a live, committed application created here can authorize a child for
  // this same Actor. Public options cannot manufacture a lock bypass.
  const parent = options._parentApplication;
  const child = Boolean(parent?.committed && _activeApplications.get(parent) === actor.uuid);
  if (!child) await acquireLock(lockKey);
  const lockWaitMs = startedAt !== null ? monoMs() - startedAt : null;
  let outcome = "failed";
  _activeApplications.set(application, actor.uuid);
  const stopPerfApplication = perfTrackApplication(actor, application);
  try {
    const receipt = application.receiptId
      ? readDamageReceipts(actor).find((entry) => entry.id === application.receiptId)
      : null;
    if (receipt) {
      outcome = "replayed";
      // Replaying a receipt performs no new health write. Older receipts do not
      // carry a separate write acknowledgement; a truthy result cannot add one.
      const confirmed = receipt.result?.execution?.committed === true;
      const status = receipt.status === "applied" ? "complete" : receipt.status === "waitingGM" ? "pending"
        : receipt.status === "processing" ? "processing" : receipt.status === "failed" ? "rejected" : "needsReview";
      const actionResult = describe(status, receipt.status === "partial" ? "uncertain" : confirmed ? "confirmed" : "none");
      const value = withActionResult({ ...receipt.result, actor, execution: { status: receipt.status, kind, committed: confirmed, replayed: true } }, actionResult);
      return { value, actionResult };
    }
    let value;
    let error = null;
    const engineStartedAt = startedAt !== null ? monoMs() : null;
    try {
      value = await run(actor, { ...options, applicationId: application.id, _application: application });
    } catch (cause) {
      if (!application.committed) throw cause;
      error = cause;
      value = application.committed;
      console.error("UESRPG | Damage committed but aftermath failed", cause);
    } finally {
      if (engineStartedAt !== null) perfRecord({
        event: "damage.engine",
        kind, source: application.source, messageId: application.messageId, requestId: application.requestId,
        actorUuid: actor.uuid,
        applicationId: application.id,
        committed: Boolean(application.committed),
        durationMs: monoMs() - engineStartedAt,
      });
    }
    if (!value) {
      outcome = "skipped";
      return { value: null, actionResult: describe(application.writeAttempted && !application.writeConfirmed ? "needsReview"
        : application.noEffect ? "complete" : "blocked", application.writeAttempted && !application.writeConfirmed ? "uncertain"
          : application.writeConfirmed ? "confirmed" : "none", application.noEffect ? "No health change is required by this result." : "The health application was not confirmed.") };
    }
    value.settledHP = Number(actor.system?.hp?.value ?? value.newHP ?? 0) || 0;
    value.settledTempHP = Number(actor.system?.tempHP ?? value.newTempHP ?? 0) || 0;
    value.pendingStages = value.aftermathSummary?.pending ?? [];
    const status = error || value.aftermathSummary?.failed?.length ? "partial" : value.pendingStages.length ? "waitingGM" : "applied";
    value.execution = { status, kind, committed: application.writeConfirmed, applicationId: application.id };
    if (application.receiptId && application.committed) {
      const receiptStartedAt = startedAt !== null ? monoMs() : null;
      const updated = await updateDamageReceipt(actor, application.receiptId, entry => entry ? {
        ...entry, status,
        result: { ...entry.result, gmDamageReport: value.gmDamageReport ?? null, settledHP: value.settledHP, settledTempHP: value.settledTempHP, pendingStages: value.pendingStages },
      } : null);
      if (receiptStartedAt !== null) perfRecord({
        event: "damage.receipt.finalize",
        kind, messageId: application.messageId, requestId: application.requestId,
        actorUuid: actor.uuid,
        applicationId: application.id,
        ok: Boolean(updated),
        writeCount: 1,
        durationMs: monoMs() - receiptStartedAt,
      });
      if (!updated) {
        value.execution.status = "partial";
      }
    }
    outcome = value.execution.status;
    const uncertain = Boolean(error && error.committed !== false)
      || value.aftermathSummary?.failed?.some(stage => stage.key !== "chatSummary");
    const actionResult = describe(value.execution.status === "partial" ? "partial" : value.execution.status === "waitingGM" ? "pending" : "complete",
      uncertain ? "uncertain" : application.writeConfirmed ? "confirmed" : "none", error ? String(error.message ?? error) : null);
    return { value: withActionResult(value, actionResult), actionResult };
  } catch (error) {
    const uncertain = application.writeAttempted && !application.writeConfirmed || application.committed && error.committed !== false;
    throw addActionErrorContext(error, describe(uncertain ? "needsReview"
      : application.writeConfirmed ? "partial" : "rejected", uncertain ? "uncertain"
        : application.writeConfirmed ? "confirmed" : "none", String(error.message ?? error)));
  } finally {
    stopPerfApplication();
    _activeApplications.delete(application);
    if (!child) releaseLock(lockKey);
    if (startedAt !== null) perfRecord({
      event: "damage.application",
      kind, source: application.source, messageId: application.messageId, requestId: application.requestId,
      actorUuid: actor.uuid,
      applicationId: application.id,
      receiptId: application.receiptId,
      status: outcome,
      lockWaitMs,
      durationMs: monoMs() - startedAt,
    });
  }
}

export const ApplyDamageService = {
  async applySimple(targetActorOrUuid, damage, damageType = DAMAGE_TYPES.PHYSICAL, options = {}) {
    return (await ApplyDamageService.applySimpleResult(targetActorOrUuid, damage, damageType, options)).value;
  },
  async applySimpleResult(targetActorOrUuid, damage, damageType = DAMAGE_TYPES.PHYSICAL, options = {}) {
    return executeResult(targetActorOrUuid, options, (actor, context) => applyDamage(actor, damage, damageType, context));
  },

  async applyResolved(targetActorOrUuid, payload = {}) {
    return (await ApplyDamageService.applyResolvedResult(targetActorOrUuid, payload)).value;
  },
  async applyResolvedResult(targetActorOrUuid, payload = {}) {
    return executeResult(targetActorOrUuid, payload, (actor, context) => applyDamageResolved(actor, context));
  },

  async applyHealing(targetActorOrUuid, amount, options = {}) {
    return (await ApplyDamageService.applyHealingResult(targetActorOrUuid, amount, options)).value;
  },
  async applyHealingResult(targetActorOrUuid, amount, options = {}) {
    return executeResult(targetActorOrUuid, options, (actor, context) => applyHealing(actor, amount, context), "healing");
  },

  async applyChatCard(payload = {}) {
    return (await ApplyDamageService.applyChatCardResult(payload)).value;
  },
  async applyChatCardResult({
    targetActor,
    rawDamage = 0,
    damageType = DAMAGE_TYPES.PHYSICAL,
    magicSource = false,
    targetDomain = "",
    ...payload
  } = {}) {
    const actor = await resolveTargetActor(targetActor);
    const warfareTarget = String(targetDomain ?? "").trim().toLowerCase() === "warfare" || isWarfareActor(actor);

    if (warfareTarget) {
      return executeResult(actor, payload, (target, context) => applyHybridDamageToWarfareUnit(target, {
        ...context,
        rawDamage,
        damageType,
        magicSource,
      }));
    }

    return ApplyDamageService.applyResolvedResult(actor, {
      rawDamage,
      damageType,
      magicSource,
      ...payload,
    });
  },
};
