import { resolveUuidSync } from "../../../utils/uuid-cache.js";
import { requestUpdateDocument, requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";

export function snapshotDamageHookData(payload) {
  const { weapon, ammo, origin, ...data } = payload;
  return { ...foundry.utils.deepClone(data), weaponUuid: weapon?.uuid ?? null, ammoUuid: ammo?.uuid ?? null,
    origin: typeof origin === "string" ? origin : origin?.uuid ?? null };
}

function restoreHookData(data) {
  return { ...data, weapon: resolveUuidSync(data.weaponUuid), ammo: resolveUuidSync(data.ammoUuid) };
}

export function targetStateDocuments(actor) {
  const documents = [actor];
  if (String(actor.type).toLowerCase() !== "npc") return documents;
  for (const combat of game.combats?.contents ?? []) {
    for (const combatant of combat.combatants?.contents ?? []) {
      if (combatant.actor?.uuid === actor.uuid) documents.push(combatant);
    }
  }
  return documents;
}

async function executeOperation(actor, operation) {
  const data = operation.payload ?? {};
  if (operation.type === "document.update") {
    const document = resolveUuidSync(operation.documentUuids[0]);
    if (!document) throw Object.assign(new Error("A pending document no longer exists."), { committed: false });
    return requestUpdateDocument(document, data);
  }
  if (operation.type === "effect.delete") {
    const effect = resolveUuidSync(operation.documentUuids[0]);
    if (!effect) return { ok: true };
    return requestDeleteEmbeddedDocuments(effect.parent, "ActiveEffect", [effect.id]);
  }
  if (operation.type === "strike.charge") {
    const weapon = resolveUuidSync(operation.documentUuids[0]);
    if (!weapon) throw Object.assign(new Error("The pending strike weapon is unavailable."), { committed: false });
    await (await import("../../enchanting/runtime/strike-runtime.js")).consumeStrikeCharge(weapon, { strict: true });
    return { ok: true };
  }
  if (operation.type === "alchemy.onHit") return (await import("../../alchemy/runtime.js")).applyAlchemyOnHit(actor, restoreHookData(data), { strict: true });
  if (operation.type === "strike.onHit") return (await import("../../enchanting/runtime/strike-on-hit.js")).applyStrikeOnHit(actor, restoreHookData(data), { strict: true });
  if (operation.type === "damage.deathState") return (await import("../../wounds/death-tests.js")).settleDamageDeathState(actor, restoreHookData(data), { strict: true });
  if (operation.type === "wounds.damage") return (await import("../../wounds/wound-engine.js")).applyDamageWoundInteractions(actor, restoreHookData(data), { strict: true });
  if (operation.type === "healing.bleeding") return (await import("../../conditions/engine/index.js")).applyHealingToBleeding(actor, data, { strict: true });
  if (operation.type === "healing.wounds") return (await import("../../wounds/wound-engine.js")).applyHealingWoundInteractions(actor, data, { strict: true });
  if (operation.type === "damage.targetState") return (await import("./post-application.js")).finalizeDamageTargetState(actor, data);
  if (operation.type === "healing.targetState") return (await import("../../wounds/wound-engine.js")).settleHealingTargetState(actor, data, { strict: true });
  throw Object.assign(new Error("This pending consequence requires manual review."), { committed: false });
}

export async function resumeDamageAftermath(result, context) {
  for (const pending of result?.pendingStages ?? []) {
    const operation = pending.operation;
    await context.stage(pending.stageKey, () => executeOperation(context.actor, operation), {
      documents: (operation.documentUuids ?? [context.actor.uuid]).map(resolveUuidSync), requiresGM: operation.requiresGM === true,
    });
  }
  if (result?.pendingStages?.length) {
    const { updateDamageReceipt } = await import("./post-application.js");
    await updateDamageReceipt(context.actor, context.receiptId, current => current ? { ...current, status: "applied",
      result: { ...current.result, pendingStages: [] } } : null);
    return { ...result, pendingStages: [], execution: { ...result.execution, status: "applied" } };
  }
  return result;
}
