import {
  requestCreateActiveEffect,
  requestUpdateDocument
} from "../../../utils/authority-proxy.js";
import { syncNpcDeathState } from "../../wounds/death-tests.js";

function _isNpcActor(actor) {
  return String(actor?.type ?? "").trim().toLowerCase() === "npc";
}

export function resolveDamageUpdateTarget(actor) {
  if (!actor) return null;
  const activeToken = actor.token ?? actor.getActiveTokens?.()[0] ?? null;
  const isUnlinkedToken = Boolean(
    activeToken &&
    actor.prototypeToken &&
    actor.prototypeToken.actorLink === false &&
    activeToken.actor
  );
  return isUnlinkedToken ? activeToken.actor : actor;
}

export async function applyPostDamageUpdate(actor, { newHP, newTempHP, extraUpdates = {} } = {}) {
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

  await requestUpdateDocument(updateTarget, updateData);
  return updateTarget;
}

export async function ensureUnconsciousEffect(targetActor) {
  try {
    if (!targetActor) return;

    const hasUnconscious = targetActor.effects?.some(
      (e) => e?.statuses?.has?.("unconscious") || e?.name === "Unconscious"
    );
    if (hasUnconscious) return;

    await requestCreateActiveEffect(targetActor, {
      name: "Unconscious",
      icon: "icons/svg/unconscious.svg",
      duration: {},
      statuses: ["unconscious"],
      flags: { core: { statusId: "unconscious" } },
    });
  } catch (err) {
    console.error("UESRPG | Failed to apply unconscious effect:", err);
  }
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
