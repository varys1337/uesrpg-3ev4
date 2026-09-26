import { applyDamage, applyHealing } from "../../core/combat/damage/apply.js";
import { DAMAGE_TYPES } from "../../core/combat/damage/types.js";
import { applyDamageResolved } from "../../core/combat/damage/resolver/resolve.js";
import { readDamageReceipts } from "../../core/combat/damage/post-application.js";
import { acquireLock, releaseLock } from "../../utils/authority-proxy/shared.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { applyHybridDamageToWarfareUnit, isWarfareActor } from "../../core/combat/opposed/hybrid.js";
import { resolveActorDocument } from "../foundry/adapters.js";
import { requireMassCombatEnabled } from "../../core/homebrew/settings.js";

async function resolveTargetActor(targetActorOrUuid) {
  const actor = await resolveActorDocument(targetActorOrUuid);
  if (actor?.documentName === "Actor") return actor;
  throw new Error("Invalid target actor for damage application.");
}

/** Damage and healing enter here; source calculators retain their rules. */
async function execute(targetActorOrUuid, options, run) {
  const actor = await resolveTargetActor(targetActorOrUuid);
  if (isWarfareActor(actor) && !requireMassCombatEnabled()) return null;
  const application = {
    id: String(options.applicationId ?? "").trim() || foundry.utils.randomID(),
    receiptId: String(options.receiptId ?? "").trim(),
    committed: null,
  };
  const lockKey = `DamageApplication:${actor.uuid}`;
  await acquireLock(lockKey);
  try {
    const receipt = application.receiptId
      ? readDamageReceipts(actor).find((entry) => entry.id === application.receiptId)
      : null;
    if (receipt) {
      return { ...receipt.result, actor, execution: { status: receipt.status, committed: true, replayed: true } };
    }
    let value;
    let error = null;
    try {
      value = await run(actor, { ...options, applicationId: application.id, _application: application });
    } catch (cause) {
      if (!application.committed) throw cause;
      error = cause;
      value = application.committed;
      console.error("UESRPG | Damage committed but aftermath failed", cause);
    }
    if (!value) return null;
    const status = error || value.aftermathSummary?.failed?.length ? "partial" : "applied";
    value.execution = { status, committed: true, applicationId: application.id };
    if (application.receiptId && application.committed) {
      const receipts = readDamageReceipts(actor).map((entry) => entry.id === application.receiptId
        ? { ...entry, status, result: { ...entry.result, gmDamageReport: value.gmDamageReport ?? null } }
        : entry);
      if (!await requestUpdateDocument(actor, { [`flags.${game.system.id}.damageApplications`]: receipts })) {
        value.execution.status = "partial";
      }
    }
    return value;
  } finally {
    releaseLock(lockKey);
  }
}

export const ApplyDamageService = {
  async applySimple(targetActorOrUuid, damage, damageType = DAMAGE_TYPES.PHYSICAL, options = {}) {
    return execute(targetActorOrUuid, options, (actor, context) => applyDamage(actor, damage, damageType, context));
  },

  async applyResolved(targetActorOrUuid, payload = {}) {
    return execute(targetActorOrUuid, payload, (actor, context) => applyDamageResolved(actor, context));
  },

  async applyHealing(targetActorOrUuid, amount, options = {}) {
    return execute(targetActorOrUuid, options, (actor, context) => applyHealing(actor, amount, context));
  },

  async applyChatCard({
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
      if (!requireMassCombatEnabled()) return null;
      return execute(actor, payload, (target, context) => applyHybridDamageToWarfareUnit(target, {
        ...context,
        rawDamage,
        damageType,
        magicSource,
      }));
    }

    return ApplyDamageService.applyResolved(actor, {
      rawDamage,
      damageType,
      magicSource,
      ...payload,
    });
  },
};
