import { getEffectDropRestriction } from "./drop-eligibility.js";
import { applyGenericStackPolicyTransaction, effectSourceSignature } from "./stack-policy.js";
import { requestDeleteEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { acquireLock, releaseLock } from "../../utils/authority-proxy/shared.js";
import { tf } from "../../utils/i18n.js";
import { getEffectChanges, normalizeActiveEffectOrigin } from "../../utils/compat.js";

const ACTOR_TYPES = new Set(["Player Character", "NPC"]);
const FAILURE_CODES = new Set(["Unavailable", "Expired", "Managed", "Permission", "Changed", "Failed", "DeleteFailed"]);
const pendingDrops = new Map();

function notify(code, effect, actor) {
  const message = tf(`UESRPG.EffectTransfer.${code}`, { effect: effect?.name ?? "", actor: actor?.name ?? "" });
  globalThis.ui?.notifications?.[code === "Moved" || code === "Applied" ? "info" : "warn"]?.(message);
}

function canWrite(actor) {
  return actor?.isOwner === true && actor.canUserModify(game.user, "update") === true;
}

/** Shared sheet/canvas receiver. UUID-only live sources prevent stale chat resurrection. */
export function transferDroppedEffect(effect, targetActor) {
  const key = `${effect?.uuid}|${targetActor?.uuid}`;
  if (pendingDrops.has(key)) return pendingDrops.get(key);
  const operation = performTransfer(effect, targetActor).finally(() => pendingDrops.delete(key));
  pendingDrops.set(key, operation);
  return operation;
}

async function performTransfer(effect, targetActor) {
  if (!ACTOR_TYPES.has(targetActor?.type)) return null;
  const sourceParent = effect?.parent;
  const move = sourceParent?.documentName === "Actor";
  if (!effect?.id || !["Actor", "Item"].includes(sourceParent?.documentName)) {
    notify("Unavailable", effect, targetActor);
    return null;
  }
  if (move && sourceParent.uuid === targetActor.uuid) return null;
  const keys = [...new Set([`effect-drop:${effect.uuid}`, `effect-drop:${targetActor.uuid}`])].sort();
  const held = [];
  let transaction = null;
  try {
    for (const key of keys) { await acquireLock(key); held.push(key); }
    const signature = effectSourceSignature(effect);
    const validateSource = () => {
      const live = sourceParent.effects?.get(effect.id);
      if (!live || live.uuid !== effect.uuid || effectSourceSignature(live) !== signature) throw new Error("Changed");
      const restriction = getEffectDropRestriction(live);
      if (restriction) throw new Error(restriction);
      if (!canWrite(targetActor) || (move && (!canWrite(sourceParent) || !live.canUserModify(game.user, "delete")))) throw new Error("Permission");
      if (!move && sourceParent.testUserPermission(game.user, "OBSERVER") !== true) throw new Error("Permission");
    };
    validateSource();
    const data = effect.toObject();
    delete data._id;
    data.sort = Math.max(0, ...Array.from(targetActor.effects ?? [], row => Number(row.sort) || 0)) + 1;
    if (!move) {
      data.start = CONFIG.ActiveEffect.documentClass.getEffectStart();
      data.transfer = false;
      data.origin = normalizeActiveEffectOrigin(effect.origin) || sourceParent.uuid;
    }
    transaction = await applyGenericStackPolicyTransaction(targetActor, data, {
      // Definitions use a fresh native anchor; moves keep their original anchor.
      preserveTiming: true,
      validateSource,
      validateEffect: row => {
        const restriction = getEffectDropRestriction(row);
        if (restriction) throw new Error(restriction);
      },
    });
    if (!transaction.applied) {
      const restored = await transaction.rollback();
      notify(restored ? "Retained" : "RecoveryFailed", effect, targetActor);
      return null;
    }
    validateSource();
    transaction.verify();
    const applied = transaction.effect.toObject();
    for (const key of ["name", "img", "description", "duration", "start", "disabled", "flags", "statuses", "origin", "transfer", "tint", "showIcon", "type", "system"]) {
      if (data[key] !== undefined && effectSourceSignature({ value: applied[key] }) !== effectSourceSignature({ value: data[key] })) throw new Error("Failed");
    }
    if (effectSourceSignature({ value: getEffectChanges(applied) }) !== effectSourceSignature({ value: getEffectChanges(data) })) throw new Error("Failed");
    if (move) {
      const deleted = await requestDeleteEmbeddedDocuments(sourceParent, "ActiveEffect", [effect.id], { requireDeleted: true });
      if (!deleted) throw new Error("DeleteFailed");
    }
    notify(move ? "Moved" : "Applied", effect, targetActor);
    return transaction.effect;
  } catch (error) {
    const recovered = transaction ? await transaction.rollback() : error.rollbackComplete !== false;
    // A failed deletion with a missing source cannot be distinguished from another client's removal.
    // Do not recreate that source; explicitly report the uncertainty instead.
    const restored = recovered && !(error.message === "DeleteFailed" && !sourceParent.effects?.get(effect.id));
    const code = restored ? (FAILURE_CODES.has(error.message) ? error.message : "Failed") : "RecoveryFailed";
    notify(code, effect, targetActor);
    return null;
  } finally {
    for (const key of held.reverse()) releaseLock(key);
  }
}

export async function handleEffectDropData(data, targetActor, onDrop = effect => transferDroppedEffect(effect, targetActor)) {
  if (data?.type !== "ActiveEffect") return null;
  try {
    // Resolve only the live UUID even if a foreign payload also includes stale data.
    if (!data.uuid) throw new Error("Unavailable");
    const effect = await CONFIG.ActiveEffect.documentClass.fromDropData({ type: "ActiveEffect", uuid: data.uuid });
    return await onDrop(effect);
  } catch (_error) {
    notify("Unavailable", null, targetActor);
    return null;
  }
}
