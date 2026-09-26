import {
  requestCreateActiveEffect,
  requestUpdateDocument
} from "../../../utils/authority-proxy.js";
import { syncNpcDeathState } from "../../wounds/death-tests.js";

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
  return Array.isArray(value) ? value : [];
}

/** Commit a resource write and its chat-operation receipt together. */
export async function commitHealthUpdate(actor, updateData, { application = null, result = {}, receiptStatus = "partial" } = {}) {
  const receiptId = application?.receiptId;
  const updates = { ...updateData };
  if (receiptId) {
    updates[`flags.${game.system.id}.damageApplications`] = [
      ...readDamageReceipts(actor).filter((entry) => entry.id !== receiptId).slice(-49),
      { id: receiptId, at: Date.now(), status: receiptStatus, result },
    ];
  }
  if (Object.keys(updates).length && !await requestUpdateDocument(actor, updates)) return false;
  if (application) application.committed = { ...result, actor };
  return true;
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
  if (Number(newHP ?? 0) === 0 && !_isNpcActor(targetActor)) {
    await ensureUnconsciousEffect(targetActor);
  }
  if (_isNpcActor(targetActor)) {
    await syncNpcDeathState(targetActor);
  }
}

export function dispatchDamageAppliedHook(
  targetActor,
  payload,
  { logPrefix = "UESRPG | uesrpgDamageApplied hook dispatch failed", logLevel = "error" } = {}
) {
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
