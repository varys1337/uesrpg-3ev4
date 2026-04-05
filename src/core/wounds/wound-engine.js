/**
 * src/core/wounds/wound-engine.js
 *
 * Wound persistence + blood loss automation (Chapter 5).
 * 
 * This module is now a thin façade delegating to:
 *  - engine/calc.js    (pure computation helpers)
 *  - engine/state.js   (state transition logic)
 *  - engine/apply.js   (document mutation orchestration)
 *  - engine/format.js  (text formatting and data transformation)
 *
 * All behavior is unchanged; this refactor improves modularity and testability.
 */

import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments, requestUpdateDocument, requestUpdateEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { registerWoundSocket, requestWoundsGM } from "./wound-socket.js";
import { registerWoundCombatTicker } from "./wound-ticker.js";
import { normalizeHitLocation, isActiveGMUser } from "./wound-schema.js";
import { SYSTEM_ID, FLAG_SCOPE } from "../constants.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { deleteOwnedEffects, getCurrentWorldTimeSeconds } from "./shared.js";
import {
  collectHealingTestCandidates,
  findHealerKit,
  promptTreatWoundRollOptions,
  resolveHealingTestTarget,
} from "./treatment-helpers.js";

// Import from segmented modules
import { 
  canNaturalHeal as calcCanNaturalHeal,
  findEffectsByKind,
  findFirstEffectByKind,
  findFirstEffectByAppId,
  hasAnyWoundEffects,
  toNumber
} from "./engine/calc.js";

import { makeEffect } from "./engine/format.js";
import { getWoundState, isDerivedWounded, resolveActorLike, getBloodLossStatus, WOUND_STATES } from "./engine/state.js";

import {
  applyShockUnconditional,
  postShockTestChatCard,
  enforceWoundInvariants,
  cleanupWoundStateIfNoWounds,
  applyMaimedOutcomeForWound,
  evaluateUntreatedWoundDeadlines,
  resolveShockTestFromChat as applyResolveShockTestFromChat,
  tickForestall,
  tickBloodLoss,
  tickShockMarkers,
  applyHealingForestall,
  advanceTreatedWoundHealing,
  removeShockMarkersForApplication
} from "./engine/apply.js";
import { tickDeathTestsEndTurn } from "./death-tests.js";
import { doTestRoll } from "../../utils/degree-roll-helper.js";

// ===== INTERNAL STATE =====

let _woundHooksRegistered = false;
const FLAG_PATH = `flags.${FLAG_SCOPE}`;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

async function _postWoundWorkflowCard({ title, actor, healer, lines = [] } = {}) {
  try {
    const content = `<div class="uesrpg-chat-card"><header class="card-header"><h3>${esc(title)}</h3></header><div class="card-content"><p><strong>Target:</strong> ${esc(actor?.name ?? "Actor")}</p><p><strong>Healer:</strong> ${esc(healer?.name ?? "N/A")}</p>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div></div>`;
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: actor ?? null }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
  } catch (_e) {
    // Non-blocking.
  }
}

function _currentLongRestCounter(actor) {
  const v = Number(actor?.getFlag?.(FLAG_SCOPE, "wounds.longRestCounter") ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function _isCrippleRelatedWound(actor, woundEffect) {
  const w = woundEffect?.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
  const appId = String(w?.applicationId ?? "").trim();
  if (!appId) return false;
  const markers = actor?.effects?.contents ?? [];
  return markers.some((ef) => {
    const wf = ef?.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
    if (String(wf?.applicationId ?? "").trim() !== appId) return false;
    const kind = String(wf?.kind ?? "");
    return kind === "shockCripple" || kind === "shockCrippleBody" || kind === "shockCrippledLimb";
  });
}

// ===== PUBLIC API: WOUND CRUD OPERATIONS =====

/**
 * Create wound from damage application
 */
export async function createWoundFromDamage(actor, { damage = 0, hitLocation = "Body", origin = null, source = "Attack", applicationId = null } = {}) {
  if (!actor) return;

  const amt = Math.max(0, toNumber(damage, 0));
  if (amt <= 0) return;

  const loc = normalizeHitLocation(hitLocation ?? "Body");
  const locLabel = loc?.label ?? "Body";
  const ts = Date.now();
  const worldNow = getCurrentWorldTimeSeconds();
  const endTotal = Number(actor?.system?.characteristics?.end?.total ?? 0) || 0;
  const endBonusDays = Math.max(0, Math.floor(endTotal / 10));
  const treatmentDeadlineMs = endBonusDays * 24 * 60 * 60 * 1000;
  const expiresAtForTreatment = ts + treatmentDeadlineMs;
  const expiresAtForTreatmentWorldTime = worldNow + (endBonusDays * 24 * 60 * 60);

  const appId = applicationId ? String(applicationId) : null;
  if (appId) {
    const existingByApp = findFirstEffectByAppId(actor, appId);
    if (existingByApp) return existingByApp;
  }

  const woundEffect = makeEffect({
    name: `Wound (${locLabel})`,
    img: "icons/svg/skull.svg",
    origin,
    flags: {
      wounds: {
        kind: "wound",
        applicationId: appId,
        hitLocation: locLabel,
        damage: amt,
        treated: false,
        progress: 0,
        createdAt: ts,
        createdAtWorldTime: worldNow,
        source,
        shockResolved: false,
        shockResolvedAt: null,
        shockPassed: null,
        shockFailed: false,
        maimed: false,
        maimedAt: null,
        expiresAtForTreatment,
        expiresAtForTreatmentWorldTime,
        treatmentDeadlineDays: endBonusDays,
        limbTreatAttemptLongRest: false,
        limbTreatLongRestId: null
      }
    }
  });

  const created = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [woundEffect]);
  const woundDoc = Array.isArray(created) ? (created[0] ?? null) : null;

  // Passive Effects + Blood Loss begin after Shock Test resolution
  return woundDoc;
}

/**
 * Create or update blood loss effect
 */
export async function upsertBloodLoss(actor, { resetTo = 5 } = {}) {
  if (!actor) return;
  const existing = findFirstEffectByKind(actor, "bloodLoss");
  const next = Math.max(0, toNumber(resetTo, 5));

  if (!existing) {
    const effect = makeEffect({
      name: `Blood Loss (${next})`,
      img: "icons/svg/blood.svg",
      flags: {
        wounds: {
          kind: "bloodLoss",
          remainingRounds: next
        }
      }
    });
    await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [effect]);
    return;
  }

  await requestUpdateDocument(existing, {
    name: `Blood Loss (${next})`,
    [`${FLAG_PATH}.wounds.remainingRounds`]: next
  });
}

/**
 * Apply first aid to actor (remove blood loss, suppress wound penalties)
 */
export async function firstAid(actorLike) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { removedBloodLoss: 0, createdFirstAid: false };

  let removedBloodLoss = 0;

  // Remove blood loss countdown
  const bloodLossEffects = findEffectsByKind(actor, "bloodLoss");
  if (bloodLossEffects.length) {
    const deleted = await deleteOwnedEffects(actor, bloodLossEffects.map((ef) => ef.id), { reason: "firstAid:bloodLoss" });
    removedBloodLoss = deleted ? bloodLossEffects.length : 0;
  }

  // Create a persistent suppression marker
  const existing = findFirstEffectByKind(actor, "firstAid");
  if (existing) return { removedBloodLoss, createdFirstAid: false };

  const effect = makeEffect({
    name: "First Aid (Stabilized)",
    img: "icons/svg/regen.svg",
    flags: {
      wounds: {
        kind: "firstAid",
        suppressWoundPenalty: true,
        stabilized: true,
        stabilizedAt: Date.now()
      }
    }
  });

  await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [effect]);
  
  await enforceWoundInvariants(actor, { context: "firstAid" });

  return { removedBloodLoss, createdFirstAid: true };
}

export async function removeFirstAid(actorLike) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { removed: 0 };
  const markers = findEffectsByKind(actor, "firstAid");
  if (!markers.length) return { removed: 0 };
  await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", markers.map((m) => m.id));
  await enforceWoundInvariants(actor, { context: "removeFirstAid" });
  return { removed: markers.length };
}

/**
 * Treat a specific wound
 */
export async function treatWound(actorLike, effectId, meta = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor || !effectId) return;
  const ef = actor.effects?.get?.(effectId) ?? null;
  const data = ef?.getFlag?.(FLAG_SCOPE, "wounds");
  if (!ef || data?.kind !== "wound") return;

  if (data.treated === true) return;

  await requestUpdateDocument(ef, {
    [`${FLAG_PATH}.wounds.treated`]: true,
    [`${FLAG_PATH}.wounds.treatedAt`]: Date.now(),
    [`${FLAG_PATH}.wounds.progress`]: 0,
    [`${FLAG_PATH}.wounds.treatedBy`]: String(meta?.treatedBy ?? ""),
    [`${FLAG_PATH}.wounds.treatmentMethod`]: String(meta?.method ?? "medicine"),
    [`${FLAG_PATH}.wounds.gmOverride`]: meta?.gmOverride === true,
    [`${FLAG_PATH}.wounds.treatmentDurationHours`]: 1
  });
  await enforceWoundInvariants(actor, { context: "treatWound" });
}

/**
 * Treat all wounds on actor
 */
export async function treatAllWounds(actorLike) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return;
  const treatedAt = Date.now();
  const updates = [];
  for (const ef of findEffectsByKind(actor, "wound")) {
    const data = ef.getFlag(FLAG_SCOPE, "wounds") ?? {};
    if (data.treated === true) continue;
    updates.push({
      _id: ef.id,
      [`${FLAG_PATH}.wounds.treated`]: true,
      [`${FLAG_PATH}.wounds.treatedAt`]: treatedAt,
      [`${FLAG_PATH}.wounds.progress`]: 0,
      [`${FLAG_PATH}.wounds.treatedBy`]: "",
      [`${FLAG_PATH}.wounds.treatmentMethod`]: "medicine",
      [`${FLAG_PATH}.wounds.gmOverride`]: false,
      [`${FLAG_PATH}.wounds.treatmentDurationHours`]: 1
    });
  }
  if (!updates.length) return;
  try {
    const ok = await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", updates);
    if (!ok) {
      for (const update of updates) {
        const live = actor.effects?.get?.(String(update._id)) ?? null;
        if (!live) continue;
        const fallback = { ...update };
        delete fallback._id;
        await requestUpdateDocument(live, fallback);
      }
    }
  } catch (err) {
    console.warn("UESRPG | Failed to batch treat wounds", err);
    for (const update of updates) {
      const live = actor.effects?.get?.(String(update._id)) ?? null;
      if (!live) continue;
      const fallback = { ...update };
      delete fallback._id;
      await requestUpdateDocument(live, fallback);
    }
  }
  await enforceWoundInvariants(actor, { context: "treatAllWounds" });
}

export async function attemptFirstAid(actorLike, { healerActor = null, skill = null, hasKit = null, bypass = false } = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { ok: false, reason: "invalidTarget" };
  const healer = await resolveActorLike(healerActor) ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? actor;
  const resolvedHasKit = (typeof hasKit === "boolean") ? hasKit : findHealerKit(healer);
  const tn = Math.max(0, Number(skill ?? resolveHealingTestTarget(healer)) || 0);

  if (!bypass && !resolvedHasKit) {
    await _postWoundWorkflowCard({ title: "First Aid", actor, healer, lines: ["Failed: missing healer's kit/supplies."] });
    return { ok: false, reason: "missingKit" };
  }
  if (!bypass && tn <= 0) {
    await _postWoundWorkflowCard({ title: "First Aid", actor, healer, lines: ["Failed: no valid Survival/Medicine test target."] });
    return { ok: false, reason: "invalidTestTarget" };
  }

  let passed = true;
  if (!bypass) {
    const roll = await doTestRoll(healer, { target: tn, rollFormula: "1d100" });
    passed = Boolean(roll?.isSuccess);
    try {
      await roll?.roll?.toMessage?.({
        speaker: ChatMessage.getSpeaker({ actor: healer }),
        flavor: `First Aid Test - ${healer.name} (TN ${tn})`
      });
    } catch (_e) {
      // Non-blocking.
    }
  }

  if (!passed) {
    await _postWoundWorkflowCard({ title: "First Aid", actor, healer, lines: [`Failed test${tn ? ` (TN ${tn})` : ""}.`] });
    return { ok: false, reason: "failedTest", tn };
  }

  const result = await firstAid(actor);
  await _postWoundWorkflowCard({
    title: "First Aid",
    actor,
    healer,
    lines: [
      `Success${bypass ? " (GM override)" : ""}.`,
      `Removed Blood Loss effects: ${Number(result?.removedBloodLoss ?? 0)}`,
      `Applied stabilization marker: ${result?.createdFirstAid ? "Yes" : "Already present"}`
    ]
  });
  return { ok: true, ...result, tn, bypass: bypass === true };
}

export async function attemptTreatWound(actorLike, woundEffectId, { healerActor = null, hasKit = null, bypass = false } = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { ok: false, reason: "invalidTarget" };
  const woundEffect = actor.effects?.get?.(String(woundEffectId)) ?? null;
  const woundData = woundEffect?.getFlag?.(FLAG_SCOPE, "wounds") ?? null;
  if (!woundEffect || woundData?.kind !== "wound") return { ok: false, reason: "invalidWound", reasonText: "Invalid wound target." };

  const healer = await resolveActorLike(healerActor) ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? actor;
  const resolvedHasKit = (typeof hasKit === "boolean") ? hasKit : findHealerKit(healer);
  const candidates = collectHealingTestCandidates(healer);
  const baseTn = Math.max(0, resolveHealingTestTarget(healer));
  let tn = baseTn;
  let selectedLaneLabel = "Auto";
  const crippleRelated = _isCrippleRelatedWound(actor, woundEffect);
  const currentRestId = _currentLongRestCounter(actor);
  const priorRestId = Number(woundData?.limbTreatLongRestId ?? null);

  if (!bypass && !resolvedHasKit) {
    await _postWoundWorkflowCard({ title: "Treat Wound", actor, healer, lines: ["Failed: missing healer's kit/supplies."] });
    return { ok: false, reason: "missingKit", reasonText: "Missing healer's kit/supplies." };
  }
  if (!bypass && !candidates.length) {
    await _postWoundWorkflowCard({ title: "Treat Wound", actor, healer, lines: ["Failed: no valid Profession[Medicine] / Survival test target."] });
    return { ok: false, reason: "invalidTestTarget", reasonText: "No valid Profession[Medicine] / Survival test target." };
  }
  if (!bypass && crippleRelated && Number.isFinite(priorRestId) && priorRestId === currentRestId) {
    await _postWoundWorkflowCard({
      title: "Treat Wound",
      actor,
      healer,
      lines: ["Blocked: this cripple-related wound can only be treated once per long rest."]
    });
    return { ok: false, reason: "longRestLimit", reasonText: "This cripple-related wound can only be treated once per long rest." };
  }

  let passed = true;
  let dramaticFailure = false;
  if (!bypass) {
    const opts = await promptTreatWoundRollOptions(healer, candidates);
    if (!opts) return { ok: false, reason: "cancelled", suppressUiWarning: true };
    tn = Math.max(0, Number(opts.target ?? 0) || 0);
    selectedLaneLabel = String(opts?.candidate?.label ?? "Skill");
    if (tn <= 0) {
      await _postWoundWorkflowCard({ title: "Treat Wound", actor, healer, lines: ["Failed: resulting test target is 0 or lower."] });
      return { ok: false, reason: "invalidTestTarget", reasonText: "No valid Profession[Medicine] / Survival test target." };
    }
    const roll = await doTestRoll(healer, { target: tn, rollFormula: "1d100" });
    passed = Boolean(roll?.isSuccess);
    dramaticFailure = roll?.isCriticalFailure === true;
    try {
      await roll?.roll?.toMessage?.({
        speaker: ChatMessage.getSpeaker({ actor: healer }),
        flavor: `Treat Wound Test - ${healer.name} (${esc(selectedLaneLabel)}, TN ${tn})`
      });
    } catch (_e) {
      // Non-blocking.
    }
  }

  if (crippleRelated) {
    try {
      await requestUpdateDocument(woundEffect, {
        [`${FLAG_PATH}.wounds.limbTreatAttemptLongRest`]: true,
        [`${FLAG_PATH}.wounds.limbTreatLongRestId`]: currentRestId,
        [`${FLAG_PATH}.wounds.limbTreatAttemptAt`]: Date.now()
      });
    } catch (_e) {
      // Non-blocking.
    }
  }

  if (!bypass && dramaticFailure && crippleRelated) {
    await applyMaimedOutcomeForWound(actor, woundEffect, { reason: "dramatic-failure", immediate: true });
    await _postWoundWorkflowCard({
      title: "Treat Wound",
      actor,
      healer,
      lines: ["Dramatic failure: the affected body part immediately becomes maimed."]
    });
    return { ok: false, reason: "dramaticFailure", reasonText: "Dramatic failure: body part immediately maimed.", tn };
  }

  if (!passed) {
    await _postWoundWorkflowCard({ title: "Treat Wound", actor, healer, lines: [`Failed test (TN ${tn}).`] });
    return { ok: false, reason: "failedTest", reasonText: `Treat Wound test failed (TN ${tn}).`, tn };
  }

  await treatWound(actor, woundEffectId, {
    treatedBy: healer?.id ?? healer?.name ?? "",
    method: "profession-medicine",
    gmOverride: bypass === true
  });
  await _postWoundWorkflowCard({
    title: "Treat Wound",
    actor,
    healer,
    lines: [`Success${bypass ? " (GM override)" : ""}. Wound marked treated (1-hour treatment workflow).`, `Test Lane: ${selectedLaneLabel}${tn ? ` (TN ${tn})` : ""}`]
  });
  return { ok: true, tn, bypass: bypass === true };
}

export async function setWoundProgress(actorLike, woundEffectId, progress, { by = "gm", reason = "manual" } = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { ok: false, reason: "invalidTarget" };
  if (!game.user?.isGM) return { ok: false, reason: "gmOnly" };
  const woundEffect = actor.effects?.get?.(String(woundEffectId)) ?? null;
  const woundData = woundEffect?.getFlag?.(FLAG_SCOPE, "wounds") ?? null;
  if (!woundEffect || woundData?.kind !== "wound") return { ok: false, reason: "invalidWound" };

  const next = Math.max(0, Math.floor(Number(progress ?? 0) || 0));
  const damage = Math.max(0, Number(woundData?.damage ?? 0) || 0);
  const appId = String(woundData?.applicationId ?? "").trim();

  if (damage > 0 && next >= damage) {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [woundEffect.id]);
    if (appId) await removeShockMarkersForApplication(actor, appId, { removeLost: false });
    if (!hasAnyWoundEffects(actor)) await cleanupWoundStateIfNoWounds(actor);
    await enforceWoundInvariants(actor, { context: "setWoundProgress:cured" });
    return { ok: true, cured: true, progress: next, damage, by, reason };
  }

  await requestUpdateDocument(woundEffect, {
    [`${FLAG_PATH}.wounds.progress`]: next,
    [`${FLAG_PATH}.wounds.progressEditedBy`]: String(by ?? "gm"),
    [`${FLAG_PATH}.wounds.progressEditedAt`]: Date.now(),
    [`${FLAG_PATH}.wounds.progressEditReason`]: String(reason ?? "manual")
  });
  await enforceWoundInvariants(actor, { context: "setWoundProgress" });
  return { ok: true, cured: false, progress: next, damage, by, reason };
}

export async function setWoundDamage(actorLike, woundEffectId, damage, { by = "gm", reason = "manual" } = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { ok: false, reason: "invalidTarget" };
  if (!game.user?.isGM) return { ok: false, reason: "gmOnly" };
  const woundEffect = actor.effects?.get?.(String(woundEffectId)) ?? null;
  const woundData = woundEffect?.getFlag?.(FLAG_SCOPE, "wounds") ?? null;
  if (!woundEffect || woundData?.kind !== "wound") return { ok: false, reason: "invalidWound" };

  const nextDamage = Math.max(0, Math.floor(Number(damage ?? 0) || 0));
  const progress = Math.max(0, Number(woundData?.progress ?? 0) || 0);
  const appId = String(woundData?.applicationId ?? "").trim();

  // If GM sets damage at/below current progress, treat as cured via canonical cleanup.
  if (nextDamage <= 0 || progress >= nextDamage) {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [woundEffect.id]);
    if (appId) await removeShockMarkersForApplication(actor, appId, { removeLost: false });
    if (!hasAnyWoundEffects(actor)) await cleanupWoundStateIfNoWounds(actor);
    await enforceWoundInvariants(actor, { context: "setWoundDamage:cured" });
    return { ok: true, cured: true, progress, damage: nextDamage, by, reason };
  }

  await requestUpdateDocument(woundEffect, {
    [`${FLAG_PATH}.wounds.damage`]: nextDamage,
    [`${FLAG_PATH}.wounds.damageEditedBy`]: String(by ?? "gm"),
    [`${FLAG_PATH}.wounds.damageEditedAt`]: Date.now(),
    [`${FLAG_PATH}.wounds.damageEditReason`]: String(reason ?? "manual")
  });
  await enforceWoundInvariants(actor, { context: "setWoundDamage" });
  return { ok: true, cured: false, progress, damage: nextDamage, by, reason };
}

export async function applyNaturalHealingToWounds(actorLike, healedAmount, { source = "rest" } = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { ok: false, reason: "invalidTarget" };
  const heal = Math.max(0, Math.floor(Number(healedAmount ?? 0) || 0));
  if (heal <= 0) return { ok: true, advanced: 0, source };
  await advanceTreatedWoundHealing(actor, heal);
  await enforceWoundInvariants(actor, { context: `naturalHealing:${String(source ?? "rest")}` });
  return { ok: true, advanced: heal, source };
}

async function _promptActorChoice(title, actors = [], defaultId = "") {
  if (!actors.length) return null;
  const options = actors.map((a, idx) => {
    const selected = String(a.id) === String(defaultId) || (idx === 0 && !defaultId) ? "selected" : "";
    return `<option value="${esc(a.id)}" ${selected}>${esc(a.name ?? a.id)}</option>`;
  }).join("\n");
  const content = `
    <div class="uesrpg-skill-roll">
      <div class="form-group">
        <label><b>Actor</b></label>
        <select name="actorId" style="width:100%;">${options}</select>
      </div>
    </div>
  `;
  const picked = await customDialog({
    title,
    content,
    buttons: {
      ok: {
        label: "Select",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return String(root?.querySelector('select[name="actorId"]')?.value ?? "").trim();
        }
      },
      cancel: { label: "Cancel", callback: () => "" }
    },
    default: "ok",
    width: 420
  });
  if (!picked) return null;
  return actors.find((a) => String(a.id) === String(picked)) ?? null;
}

async function _promptWoundChoice(title, wounds = []) {
  if (!wounds.length) return null;
  const options = wounds.map((w, idx) => {
    const selected = idx === 0 ? "selected" : "";
    const label = `${w.hitLocation} (${w.progress}/${w.damage})${w.treated ? " [Treated]" : " [Untreated]"}`;
    return `<option value="${esc(w.id)}" ${selected}>${esc(label)}</option>`;
  }).join("\n");
  const content = `
    <div class="uesrpg-skill-roll">
      <div class="form-group">
        <label><b>Wound</b></label>
        <select name="woundId" style="width:100%;">${options}</select>
      </div>
    </div>
  `;
  const picked = await customDialog({
    title,
    content,
    buttons: {
      ok: {
        label: "Select",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return String(root?.querySelector('select[name="woundId"]')?.value ?? "").trim();
        }
      },
      cancel: { label: "Cancel", callback: () => "" }
    },
    default: "ok",
    width: 420
  });
  if (!picked) return null;
  return wounds.find((w) => String(w.id) === String(picked)) ?? null;
}

export async function openTreatWoundsMacroDialog(opts = {}) {
  const healerActor = await resolveActorLike(opts?.healerActorId)
    ?? canvas?.tokens?.controlled?.[0]?.actor
    ?? null;
  if (!healerActor) {
    ui.notifications?.warn?.("Select a source token (healer) first.");
    return { ok: false, reason: "missingHealer" };
  }

  const targetActor = await resolveActorLike(opts?.targetActorId)
    ?? Array.from(game?.user?.targets ?? [])[0]?.actor
    ?? null;
  if (!targetActor) {
    ui.notifications?.warn?.("Target a token to treat.");
    return { ok: false, reason: "missingTarget" };
  }

  const wounds = findEffectsByKind(targetActor, "wound").map((ef) => {
    const w = ef.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
    return {
      id: String(ef.id),
      hitLocation: String(w?.hitLocation ?? "Body"),
      damage: Math.max(0, Number(w?.damage ?? 0) || 0),
      progress: Math.max(0, Number(w?.progress ?? 0) || 0),
      treated: w?.treated === true
    };
  });
  if (!wounds.length) {
    ui.notifications?.warn?.(`${targetActor.name}: no wounds to treat.`);
    return { ok: false, reason: "noWounds" };
  }

  const selectedWound = await _promptWoundChoice("Treat Wounds - Select Wound", wounds);
  if (!selectedWound) return { ok: false, reason: "cancelled" };

  const res = await attemptTreatWound(targetActor, selectedWound.id, { healerActor });
  if (res?.ok === false && !res?.suppressUiWarning) {
    ui.notifications?.warn?.(String(res?.reasonText ?? "Treat Wound failed."));
  }
  return res ?? { ok: false, reason: "unknown" };
}

export async function attemptTreatAllWounds(actorLike, { healerActor = null, hasKit = null, bypass = false } = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { ok: false, reason: "invalidTarget" };
  const wounds = findEffectsByKind(actor, "wound").filter((ef) => (ef.getFlag?.(FLAG_SCOPE, "wounds")?.treated !== true));
  if (!wounds.length) return { ok: true, treated: 0 };

  const healer = await resolveActorLike(healerActor) ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? actor;
  const resolvedHasKit = (typeof hasKit === "boolean") ? hasKit : findHealerKit(healer);
  const tn = Math.max(0, resolveHealingTestTarget(healer));
  if (!bypass && !resolvedHasKit) return { ok: false, reason: "missingKit" };
  if (!bypass && tn <= 0) return { ok: false, reason: "invalidTestTarget" };

  let passed = true;
  if (!bypass) {
    const roll = await doTestRoll(healer, { target: tn, rollFormula: "1d100" });
    passed = Boolean(roll?.isSuccess);
    try {
      await roll?.roll?.toMessage?.({
        speaker: ChatMessage.getSpeaker({ actor: healer }),
        flavor: `Treat All Wounds Test - ${healer.name} (TN ${tn})`
      });
    } catch (_e) {}
  }
  if (!passed) return { ok: false, reason: "failedTest", tn };

  const treatedAt = Date.now();
  const updates = wounds.map((ef) => ({
    _id: ef.id,
    [`${FLAG_PATH}.wounds.treated`]: true,
    [`${FLAG_PATH}.wounds.treatedAt`]: treatedAt,
    [`${FLAG_PATH}.wounds.progress`]: 0,
    [`${FLAG_PATH}.wounds.treatedBy`]: String(healer?.id ?? healer?.name ?? ""),
    [`${FLAG_PATH}.wounds.treatmentMethod`]: "profession-medicine",
    [`${FLAG_PATH}.wounds.gmOverride`]: bypass === true,
    [`${FLAG_PATH}.wounds.treatmentDurationHours`]: 1
  }));

  if (updates.length) {
    try {
      const ok = await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", updates);
      if (!ok) {
        for (const update of updates) {
          const live = actor.effects?.get?.(String(update._id)) ?? null;
          if (!live) continue;
          const fallback = { ...update };
          delete fallback._id;
          await requestUpdateDocument(live, fallback);
        }
      }
    } catch (err) {
      console.warn("UESRPG | Failed to batch attemptTreatAllWounds updates", err);
      for (const update of updates) {
        const live = actor.effects?.get?.(String(update._id)) ?? null;
        if (!live) continue;
        const fallback = { ...update };
        delete fallback._id;
        await requestUpdateDocument(live, fallback);
      }
    }
  }
  const treated = updates.length;
  await enforceWoundInvariants(actor, { context: "attemptTreatAllWounds" });
  await _postWoundWorkflowCard({
    title: "Treat Wounds",
    actor,
    healer,
    lines: [`Success${bypass ? " (GM override)" : ""}. Treated wounds: ${treated}.`]
  });
  return { ok: true, treated, tn };
}

export async function reconcileWoundState(actorLike, { reason = "manual", emitLog = false } = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { ok: false, reason: "invalidTarget" };
  const before = {
    woundState: getWoundState(actor),
    wounded: actor.system?.wounded === true,
    woundCount: findEffectsByKind(actor, "wound").length
  };
  await enforceWoundInvariants(actor, { context: `reconcile:${reason}` });
  const after = {
    woundState: getWoundState(actor),
    wounded: actor.system?.wounded === true,
    woundCount: findEffectsByKind(actor, "wound").length
  };
  if (emitLog) {
    console.log("UESRPG | Wounds reconcile", { actor: actor.name, reason, before, after });
  }
  return { ok: true, before, after };
}

export async function runWorldWoundMigration({ dryRun = false } = {}) {
  if (!game.user?.isGM) return { ok: false, reason: "gmOnly" };
  const actors = game.actors?.contents ?? [];
  let touched = 0;
  for (const actor of actors) {
    const before = actor.system?.wounded === true;
    if (!dryRun) await enforceWoundInvariants(actor, { context: "worldMigration" });
    const after = actor.system?.wounded === true;
    if (before !== after) touched++;
  }
  return { ok: true, actors: actors.length, touched, dryRun: dryRun === true };
}

function _buildWoundStatusLabel(state, data = {}) {
  if (state === WOUND_STATES.SUPPRESSED) return "Wounded (Suppressed)";
  if (state === WOUND_STATES.TREATED) return "Wounded (Treated)";
  if (state === WOUND_STATES.ACTIVE) return "Wounded (Untreated)";
  if (state === WOUND_STATES.SHOCK_PENDING) return "Wound Pending Shock";
  return "No Wounds";
}

export function getWoundManagerData(actorLike) {
  const actor = (actorLike?.documentName === "Actor") ? actorLike : null;
  if (!actor) return null;
  const wounds = findEffectsByKind(actor, "wound");
  const forestall = findFirstEffectByKind(actor, "forestall");
  const firstAidMarker = findFirstEffectByKind(actor, "firstAid");
  const bloodLossStatus = getBloodLossStatus(actor);
  const state = getWoundState(actor);
  const rows = wounds.map((ef) => {
    const w = ef.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
    const damage = Math.max(0, Number(w.damage ?? 0) || 0);
    const progress = Math.max(0, Number(w.progress ?? 0) || 0);
    return {
      id: ef.id,
      name: ef.name,
      hitLocation: String(w.hitLocation ?? "Body"),
      damage,
      treated: w.treated === true,
      shockResolved: w.shockResolved === true,
      progress,
      remainingToCure: Math.max(0, damage - progress)
    };
  });
  return {
    state,
    label: _buildWoundStatusLabel(state),
    hasWounds: rows.length > 0,
    bloodLossRounds: bloodLossStatus.remainingRounds,
    bloodLossPaused: bloodLossStatus.paused,
    bloodLossPauseReason: bloodLossStatus.pauseReason,
    bloodLossPauseLabel: bloodLossStatus.pauseLabel,
    forestallRounds: Math.max(0, Number(forestall?.getFlag?.(FLAG_SCOPE, "wounds")?.remainingRounds ?? 0) || 0),
    hasFirstAid: Boolean(firstAidMarker),
    wounds: rows
  };
}

/**
 * Stabilize actor (stop blood loss, suppress penalties, mark wounds)
 */
export async function stabilize(actorLike) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { stabilizedWounds: 0, firstAid: { removedBloodLoss: 0, createdFirstAid: false } };

  const firstAidResult = await attemptFirstAid(actor, { bypass: true });

  const now = Date.now();
  let stabilizedWounds = 0;

  const woundUpdates = [];
  for (const ef of findEffectsByKind(actor, "wound")) {
    woundUpdates.push({
      _id: ef.id,
      [`${FLAG_PATH}.wounds.stabilized`]: true,
      [`${FLAG_PATH}.wounds.stabilizedAt`]: now
    });
  }

  if (woundUpdates.length) {
    try {
      const ok = await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", woundUpdates);
      if (ok) {
        stabilizedWounds = woundUpdates.length;
      } else {
        for (const update of woundUpdates) {
          const live = actor.effects?.get?.(String(update._id)) ?? null;
          if (!live) continue;
          const fallback = { ...update };
          delete fallback._id;
          await requestUpdateDocument(live, fallback);
          stabilizedWounds += 1;
        }
      }
    } catch (err) {
      console.warn("UESRPG | Failed to mark wounds stabilized", err);
      for (const update of woundUpdates) {
        const live = actor.effects?.get?.(String(update._id)) ?? null;
        if (!live) continue;
        const fallback = { ...update };
        delete fallback._id;
        try {
          await requestUpdateDocument(live, fallback);
          stabilizedWounds += 1;
        } catch (_fallbackErr) {}
      }
    }
  }

  return { stabilizedWounds, firstAid: firstAidResult };
}

/**
 * Clear a single wound effect
 */
export async function clearWound(actorLike, effectId) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return;
  const ef = actor.effects?.get?.(String(effectId)) ?? null;
  if (!ef) return;

  const w = ef.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
  const kind = String(w.kind ?? "");
  if (!["wound", "bloodLoss", "forestall", "firstAid"].includes(kind)) return;

  const appId = kind === "wound" ? String(w.applicationId ?? "").trim() : "";

  await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [ef.id]);

  // When a wound is cleared, also clear associated Shock markers (except lost limbs/eyes/ears).
  if (kind === "wound" && appId) {
    await removeShockMarkersForApplication(actor, appId, { removeLost: false });
  }

  // Defensive invariant: when wounds are fully healed/cleared, remove lingering blood loss / forestall.
  if (!hasAnyWoundEffects(actor)) {
    await cleanupWoundStateIfNoWounds(actor);
  }
  await enforceWoundInvariants(actor, { context: "clearWound" });
}

/**
 * Clear all wounds from actor
 */
export async function clearAllWounds(actorLike) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return;

  const kinds = new Set(["wound", "bloodLoss", "forestall", "firstAid"]);
  const toDelete = actor.effects?.contents.filter(e => kinds.has(String(e?.getFlag?.(FLAG_SCOPE, "wounds")?.kind ?? ""))) ?? [];

  if (!toDelete.length) return;
  await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", toDelete.map(e => e.id));

  await enforceWoundInvariants(actor, { context: "clearAllWounds" });
}

/**
 * Tick wounds at end of turn (forestall, blood loss, shock markers)
 */
export async function tickWoundsEndTurn(actor) {
  if (!actor) return;

  await enforceWoundInvariants(actor, { context: "tickWoundsEndTurn" });

  // Shock markers tick even if wounds were cleared mid-combat
  await tickShockMarkers(actor);

  // Defensive invariant: Blood Loss / Forestall should not persist when no wounds exist.
  if (!hasAnyWoundEffects(actor)) {
    await cleanupWoundStateIfNoWounds(actor);
    await tickDeathTestsEndTurn(actor);
    return;
  }

  await tickBloodLoss(actor);
  // Blood loss must see any active Forestall protection for the whole current
  // turn. Forestall then decrements/expires after that protected blood-loss check.
  await tickForestall(actor);
  await tickDeathTestsEndTurn(actor);
}

/**
 * Check if actor can naturally heal (no untreated wounds)
 * Delegates to calc module
 */
export function canNaturalHeal(actor) {
  return calcCanNaturalHeal(actor);
}

/**
 * Resolve shock test from chat card
 * Delegates to apply module
 */
export async function resolveShockTestFromChat(...args) {
  return applyResolveShockTestFromChat(...args);
}

// ===== HOOK REGISTRATION =====

/**
 * Register wound hooks (called from src/hooks/init.js or src/core/wounds/index.js)
 */
export function registerWoundHooks() {
  if (_woundHooksRegistered) return;
  _woundHooksRegistered = true;

  const onDamageApplied = async (actor, data) => {
    try {
      if (!actor) return;
      if (data?.woundTriggered !== true) return;
      const woundDoc = await createWoundFromDamage(actor, {
        damage: data?.amountApplied ?? 0,
        hitLocation: data?.hitLocation ?? "Body",
        origin: data?.origin ?? null,
        source: data?.source ?? "Attack",
        applicationId: data?.applicationId ?? null
      });

      if (!woundDoc) return;

      const w = woundDoc.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
      // Guard: post at most one shock card per wound application.
      if (w.shockPosted === true) return;

      // Ensure every wound has a stable applicationId for linking Shock markers + cleanup.
      let appId = String(w.applicationId ?? data?.applicationId ?? "").trim();
      if (!appId) appId = String(woundDoc.id ?? "");
      if (appId && !String(w.applicationId ?? "").trim()) {
        try {
          await requestUpdateDocument(woundDoc, { [`${FLAG_PATH}.wounds.applicationId`]: appId });
        } catch (_e) {
          // Non-blocking; proceed with local appId.
        }
      }

      const hitLocation = normalizeHitLocation(w.hitLocation ?? data?.hitLocation ?? "Body");
      const damageAppliedByType = data?.damageAppliedByType ?? null;

      // Persist details for later resolution (button click). This also provides idempotency.
      try {
        await requestUpdateDocument(woundDoc, {
          [`${FLAG_PATH}.wounds.shockPosted`]: true,
          [`${FLAG_PATH}.wounds.shockPostedAt`]: Date.now(),
          [`${FLAG_PATH}.wounds.damageAppliedByType`]: damageAppliedByType
        });
      } catch (_e) {
        // Non-blocking; idempotency is best-effort.
      }

      // Apply immediate (non-conditional) shock effects at wound time.
      await applyShockUnconditional(actor, {
        hitLocation,
        applicationId: appId || null
      });

      // Post the shock test card to allow the target to roll END and apply conditional consequences.
      try {
        await postShockTestChatCard({
          actor,
          woundEffect: woundDoc,
          hitLocation,
          damageAppliedByType,
          applicationId: appId || null
        });
      } catch (err) {
        console.warn("UESRPG | Failed to post shock test card", err);
      }
    } catch (err) {
      console.warn("UESRPG | Wound application failed", err);
    }
  };

  const onHealingApplied = async (actor, data) => {
    try {
      if (!actor) return;

      await enforceWoundInvariants(actor, { context: "uesrpgHealingApplied" });
      await evaluateUntreatedWoundDeadlines(actor);

      // Only apply wound healing interactions when the actor is currently wounded or has wound effects.
      const hasWound = isDerivedWounded(actor) || hasAnyWoundEffects(actor);
      if (!hasWound) return;

      const untreatedBefore = findEffectsByKind(actor, "wound").filter((ef) => ef.getFlag?.(FLAG_SCOPE, "wounds")?.treated !== true);
      const effectiveHealed = Math.max(0, toNumber(data?.effectiveHealed ?? 0, 0));
      if (effectiveHealed > 0) {
        const hpCur = Number(actor.system?.hp?.value ?? 0) || 0;
        const hpMax = Number(actor.system?.hp?.max ?? 0) || 0;
        const hpAfter = Math.min(hpMax, hpCur + effectiveHealed);

        if (untreatedBefore.length && hpMax > 0 && hpAfter >= hpMax) {
          for (const woundEf of untreatedBefore) {
            await applyMaimedOutcomeForWound(actor, woundEf, { reason: "healed-to-full-untreated", immediate: true });
          }
        }

        await applyHealingForestall(actor, effectiveHealed);
        await advanceTreatedWoundHealing(actor, effectiveHealed);
      }
      await enforceWoundInvariants(actor, { context: "uesrpgHealingApplied:post" });
    } catch (err) {
      console.warn("UESRPG | Wound healing interaction failed", err);
    }
  };

  registerWoundSocket({
    onDamageApplied,
    onHealingApplied,
    onResolveShock: async (actor, data) => {
      const woundEffectId = data?.woundEffectId ?? null;
      const action = data?.action ?? "shock-roll";
      await resolveShockTestFromChat({ actorUuid: actor.uuid, woundEffectId, action });
    }
  });

  registerWoundCombatTicker({ tickActorEndTurn: tickWoundsEndTurn });

  Hooks.on("uesrpgDamageApplied", async (actor, data) => {
    try {
      if (!actor) return;
      if (data?.woundTriggered !== true) return;
      if (!isActiveGMUser(game.user)) {
        requestWoundsGM("damageApplied", { actorUuid: actor.uuid, data });
        return;
      }
      await onDamageApplied(actor, data);
    } catch (err) {
      console.warn("UESRPG | Wound creation failed", err);
    }
  });

  Hooks.on("uesrpgHealingApplied", async (actor, data) => {
    try {
      if (!actor) return;
      if (!isActiveGMUser(game.user)) {
        requestWoundsGM("healingApplied", { actorUuid: actor.uuid, data });
        return;
      }
      await onHealingApplied(actor, data);
    } catch (err) {
      console.warn("UESRPG | Wound healing interaction failed", err);
    }
  });

  Hooks.on("uesrpg.timeChanged", async (payload) => {
    if (!isActiveGMUser(game.user)) return;
    const worldTime = Number(payload?.worldTime ?? getCurrentWorldTimeSeconds());
    if (!Number.isFinite(worldTime)) return;

    const actors = game.actors?.contents ?? [];
    for (const actor of actors) {
      if (!actor) continue;
      const hasWounds = findEffectsByKind(actor, "wound").length > 0;
      if (!hasWounds) continue;

      const last = Number(actor.getFlag(FLAG_SCOPE, "wounds.lastDeadlineCheckWorldTime") ?? 0) || 0;
      if (last > 0 && (worldTime - last) < 86400) continue;

      await evaluateUntreatedWoundDeadlines(actor, { nowWorldTimeSeconds: worldTime });
      try {
        await requestUpdateDocument(actor, { [`${FLAG_PATH}.wounds.lastDeadlineCheckWorldTime`]: worldTime });
      } catch (_e) {
        // Non-blocking.
      }
    }
  });

  Hooks.on("updateActor", (actor, changed) => {
    if (!isActiveGMUser(game.user)) return;
    if (!Object.prototype.hasOwnProperty.call(changed ?? {}, "system")) return;
    const systemChanged = changed?.system ?? {};
    const woundedChanged = Object.prototype.hasOwnProperty.call(systemChanged, "wounded");
    const hpChanged = Object.prototype.hasOwnProperty.call(systemChanged, "hp");
    if (!woundedChanged && !hpChanged) return;

    if (hpChanged) {
      const hpValueChanged = Object.prototype.hasOwnProperty.call(systemChanged?.hp ?? {}, "value");
      if (hpValueChanged) {
        const hpValue = Number(actor?.system?.hp?.value ?? 0) || 0;
        const hpMax = Number(actor?.system?.hp?.max ?? 0) || 0;
        if (hpMax > 0 && hpValue >= hpMax) {
          const untreated = findEffectsByKind(actor, "wound").filter((ef) => ef.getFlag?.(FLAG_SCOPE, "wounds")?.treated !== true);
          for (const woundEf of untreated) {
            applyMaimedOutcomeForWound(actor, woundEf, { reason: "healed-to-full-untreated", immediate: true }).catch(() => {});
          }
        }
      }
    }

    enforceWoundInvariants(actor, { context: woundedChanged ? "updateActor:woundedChanged" : "updateActor:hpChanged" }).catch(() => {});
  });

  const reconcileFromEffect = async (effect, context) => {
    try {
      const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
      if (!actor) return;
      const w = effect?.getFlag?.(FLAG_SCOPE, "wounds") ?? null;
      const group = String(effect?.flags?.[FLAG_SCOPE]?.effectGroup ?? "");
      if (!w && group !== "wounds.passive") return;
      await enforceWoundInvariants(actor, { context });
    } catch (_e) {
      // Non-blocking.
    }
  };

  Hooks.on("createActiveEffect", (effect) => {
    if (!isActiveGMUser(game.user)) return;
    reconcileFromEffect(effect, "createActiveEffect");
  });
  Hooks.on("updateActiveEffect", (effect) => {
    if (!isActiveGMUser(game.user)) return;
    reconcileFromEffect(effect, "updateActiveEffect");
  });
  Hooks.on("deleteActiveEffect", (effect) => {
    if (!isActiveGMUser(game.user)) return;
    const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
    if (!actor) return;
    enforceWoundInvariants(actor, { context: "deleteActiveEffect" }).catch(() => {});
  });
}

// ===== EXPORTED API OBJECT =====

export const WoundsAPI = {
  createWoundFromDamage,
  upsertBloodLoss,
  firstAid,
  removeFirstAid,
  attemptFirstAid,
  stabilize,
  treatWound,
  treatAllWounds,
  attemptTreatWound,
  attemptTreatAllWounds,
  setWoundProgress,
  setWoundDamage,
  applyNaturalHealingToWounds,
  openTreatWoundsMacroDialog,
  clearWound,
  clearAllWounds,
  canNaturalHeal,
  getWoundState,
  getWoundManagerData,
  reconcileWoundState,
  runWorldWoundMigration
};
