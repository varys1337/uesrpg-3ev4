import { isOverTimeTickStateOnlyUpdate } from "../active-effects/metadata.js";
import { getEffectGroup } from "../../utils/ae-helpers.js";
import { TimeService } from "../time/time-service.js";
import { MagicTimekeeping } from "../magic/timekeeping-helper.js";
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
import { confirmDialog, customDialog } from "../../utils/dialog-v2-helper.js";
import { acquireLock, releaseLock } from "../../utils/authority-proxy/shared.js";
import { canUserRollActor } from "../../utils/permissions.js";
import { t } from "../../utils/i18n.js";
import { deleteOwnedEffects, getCurrentWorldTimeSeconds } from "./shared.js";
import {
  collectHealingTestCandidates,
  findHealerKit,
  promptTreatWoundRollOptions,
  resolveHealingTestTarget,
  woundTreatmentNeedsReview,
} from "./treatment-helpers.js";

// Import from segmented modules
import { 
  canNaturalHeal as calcCanNaturalHeal,
  findEffectsByKind,
  findFirstEffectByKind,
  findFirstEffectByAppId,
  hasAnyWoundEffects,
  toNumber,
  getWoundsFlag
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
import { tickDeathTestsEndTurn, syncNpcDeathState, noteNpcDeathStateEffectChange, clearDeathState, hasDeathState } from "./death-tests.js";
import { doTestRoll } from "../../utils/degree-roll-helper.js";
import { isPerfEnabled, monoMs, perfRecord } from "../../utils/perf-tracker.js";

// ===== INTERNAL STATE =====

let _woundHooksRegistered = false;
const FLAG_PATH = `flags.${FLAG_SCOPE}`;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

function _hasWoundDomainState(actor) {
  return actor?.system?.wounded === true || isDerivedWounded(actor)
    || actor?.effects?.some(effect => getWoundsFlag(effect) || getEffectGroup(effect) === "wounds.passive");
}

function _isWoundDomainEffect(effect, changed = null) {
  if (changed && isOverTimeTickStateOnlyUpdate(changed)) return false;
  if (getWoundsFlag(effect) || getEffectGroup(effect) === "wounds.passive") return true;
  // Include removal of prior wound metadata and unknown edits to that domain.
  const prefix = `flags.${FLAG_SCOPE}.`;
  return changed && Object.keys(foundry.utils.flattenObject(changed)).some(key =>
    key === `${prefix}-=wounds` || key === `${prefix}wounds` || key.startsWith(`${prefix}wounds.`)
    || key === `${prefix}effectGroup` || key === `${prefix}-=effectGroup`);
}


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
  if (!actor || !effectId) return { ok: false, reason: "invalidTarget" };
  const ef = actor.effects?.get?.(effectId) ?? null;
  const data = ef?.getFlag?.(FLAG_SCOPE, "wounds");
  if (!ef || data?.kind !== "wound") return { ok: false, reason: "invalidWound" };
  if (woundTreatmentNeedsReview(data.treatmentAttempt)
    && (!meta?.treatmentAttemptId || data.treatmentAttempt?.id !== meta.treatmentAttemptId || data.treatmentAttempt?.status !== "applying")) return { ok: false, reason: "needsReview" };

  if (data.treated === true) return { ok: true, alreadyTreated: true };

  const updated = await requestUpdateDocument(ef, {
    [`${FLAG_PATH}.wounds.treated`]: true,
    [`${FLAG_PATH}.wounds.treatedAt`]: Date.now(),
    [`${FLAG_PATH}.wounds.progress`]: 0,
    [`${FLAG_PATH}.wounds.treatedBy`]: String(meta?.treatedBy ?? ""),
    [`${FLAG_PATH}.wounds.treatmentMethod`]: String(meta?.method ?? "medicine"),
    [`${FLAG_PATH}.wounds.gmOverride`]: meta?.gmOverride === true,
    [`${FLAG_PATH}.wounds.treatmentDurationHours`]: 1
  });
  if (!updated || ef.getFlag?.(FLAG_SCOPE, "wounds")?.treated !== true) return { ok: false, reason: "needsReview" };
  try { await enforceWoundInvariants(actor, { context: "treatWound", strict: true }); }
  catch (error) {
    console.warn("UESRPG | Wound was treated but follow-up reconciliation needs review", error);
    return { ok: false, reason: "needsReview", treated: true };
  }
  return { ok: true, treated: true };
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

async function saveWoundTreatmentAttempt(effect, attempt, extra = {}) {
  const ok = await requestUpdateDocument(effect, { ...extra, [`${FLAG_PATH}.wounds.treatmentAttempt`]: attempt });
  const saved = effect?.getFlag?.(FLAG_SCOPE, "wounds")?.treatmentAttempt;
  return Boolean(ok && saved?.id === attempt.id && saved?.status === attempt.status);
}

function woundTreatmentReview(reasonText = "Treatment could not be confirmed. Stop other processing; the GM must inspect the wound and chat before resolving it.") {
  return { ok: false, reason: "needsReview", reasonText };
}

export async function attemptTreatWound(actorLike, woundEffectId, { healerActor = null, bypass = false } = {}) {
  const actor = await resolveActorLike(actorLike);
  const effect = actor?.effects?.get?.(String(woundEffectId)) ?? null;
  if (!actor) return { ok: false, reason: "invalidTarget" };
  if (!effect || effect.getFlag?.(FLAG_SCOPE, "wounds")?.kind !== "wound") return { ok: false, reason: "invalidWound", reasonText: "Invalid wound target." };
  if (bypass && !game.user?.isGM) return { ok: false, reason: "gmOnly", reasonText: "Only the GM can override treatment." };
  const lock = `wound-treatment:${actor.uuid}:${effect.id}`;
  if (!await acquireLock(lock, { wait: false })) return { ok: false, reason: "processing", reasonText: "This wound is already being treated on this client." };
  try {
    const woundData = effect.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
    if (woundTreatmentNeedsReview(woundData.treatmentAttempt)) return woundTreatmentReview();
    if (woundData.treated === true) return { ok: false, reason: "alreadyTreated", reasonText: "This wound is already treated." };
    const healer = await resolveActorLike(healerActor) ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? actor;
    if (!bypass && !canUserRollActor(game.user, healer)) return { ok: false, reason: "permission", reasonText: "You do not have permission to roll for the healer." };
    const candidates = collectHealingTestCandidates(healer, { medicineOnly: true });
    if (!bypass && !candidates.length) return { ok: false, reason: "invalidTestTarget", reasonText: "No recognized Profession [Medicine] test target." };

    const crippleRelated = _isCrippleRelatedWound(actor, effect);
    const currentRestId = _currentLongRestCounter(actor);
    const recordedRestId = woundData.limbTreatLongRestId;
    const priorRestId = recordedRestId == null ? null : Number(recordedRestId);
    const invalidRestRecord = (recordedRestId != null && (String(recordedRestId).trim() === "" || !Number.isInteger(priorRestId) || priorRestId < 0))
      || (woundData.limbTreatAttemptLongRest === true && recordedRestId == null);
    if (!bypass && crippleRelated && invalidRestRecord) return woundTreatmentReview("The earlier cripple-related treatment record is incomplete; the GM must review it before another attempt.");
    if (!bypass && crippleRelated && Number.isFinite(priorRestId) && priorRestId === currentRestId) {
      return { ok: false, reason: "longRestLimit", reasonText: "This cripple-related wound can only be treated once per long rest." };
    }

    const options = bypass ? null : await promptTreatWoundRollOptions(healer, candidates);
    if (!bypass && !options) return { ok: false, reason: "cancelled", suppressUiWarning: true };
    const tn = bypass ? 0 : Math.max(0, Number(options.target ?? 0) || 0);
    if (!bypass && tn <= 0) return { ok: false, reason: "invalidTestTarget", reasonText: "No valid Profession [Medicine] test target." };
    const latest = actor.effects?.get?.(effect.id)?.getFlag?.(FLAG_SCOPE, "wounds");
    const latestCandidate = bypass ? null : collectHealingTestCandidates(healer, { medicineOnly: true }).find(candidate => candidate.id === options.candidate?.id);
    if (!latest || latest.treated === true || woundTreatmentNeedsReview(latest.treatmentAttempt)
      || latest.limbTreatLongRestId !== recordedRestId
      || (!bypass && (!canUserRollActor(game.user, healer) || !latestCandidate || latestCandidate.tn !== options.candidate?.tn))
      || _currentLongRestCounter(actor) !== currentRestId || _isCrippleRelatedWound(actor, effect) !== crippleRelated) {
      return woundTreatmentReview("The wound or its treatment record changed. Inspect it before starting treatment again.");
    }

    let attempt = {
      id: foundry.utils.randomID(), status: bypass ? "applying" : "rolling", healerUuid: healer?.uuid ?? "",
      userId: game.user.id, target: tn, lane: String(options?.candidate?.label ?? "GM override"),
      crippleRelated, longRestId: currentRestId, startedAt: Date.now(), result: null,
      completedAt: null, reviewReason: null, reviewedAt: null, reviewedBy: null, reviewDecision: null
    };
    if (!await saveWoundTreatmentAttempt(effect, attempt)) return woundTreatmentReview("The treatment record could not be confirmed; inspect the wound before retrying.");

    let roll = null;
    if (!bypass) {
      try { roll = await doTestRoll(healer, { target: tn, rollFormula: "1d100" }); }
      catch (error) {
        console.warn("UESRPG | Wound treatment roll needs review", error);
        return woundTreatmentReview();
      }
      const total = Number(roll?.rollTotal);
      if (typeof roll?.isSuccess !== "boolean" || !Number.isInteger(total) || total < 1 || total > 100) return woundTreatmentReview();
      const changed = _currentLongRestCounter(actor) !== currentRestId || _isCrippleRelatedWound(actor, effect) !== crippleRelated;
      const dramaticDecision = !roll.isSuccess && crippleRelated;
      attempt = { ...attempt, status: changed || dramaticDecision ? "review" : roll.isSuccess ? "applying" : "completed",
        result: { rollTotal: total, isSuccess: roll.isSuccess, isCriticalFailure: roll.isCriticalFailure === true, degree: Number(roll.degree ?? 0) || 0 },
        reviewReason: changed ? "context-changed" : dramaticDecision ? "dramatic-decision" : null };
      const restFlags = crippleRelated ? {
        [`${FLAG_PATH}.wounds.limbTreatAttemptLongRest`]: true,
        [`${FLAG_PATH}.wounds.limbTreatLongRestId`]: currentRestId,
        [`${FLAG_PATH}.wounds.limbTreatAttemptAt`]: Date.now()
      } : {};
      if (!await saveWoundTreatmentAttempt(effect, attempt, restFlags)) return woundTreatmentReview();
      try {
        await roll.roll?.toMessage?.({ speaker: ChatMessage.getSpeaker({ actor: healer }),
          flavor: `Treat Wound Test - ${esc(healer.name)} (${esc(attempt.lane)}, TN ${tn})` });
      } catch (error) { console.warn("UESRPG | Treatment roll message could not be posted; the result remains on the wound", error); }
      if (changed) return woundTreatmentReview("The treatment context changed during the roll. The GM must inspect the wound and recorded result.");
      if (dramaticDecision) return woundTreatmentReview("The test failed. The GM must decide whether it was a dramatic failure and review this wound.");
      if (!roll.isSuccess) {
        await _postWoundWorkflowCard({ title: "Treat Wound", actor, healer, lines: [`Failed test (TN ${tn}).`] });
        return { ok: false, reason: "failedTest", reasonText: `Treat Wound test failed (TN ${tn}).`, tn };
      }
    }

    const treated = await treatWound(actor, effect.id, { treatedBy: healer?.id ?? healer?.name ?? "", method: "profession-medicine", gmOverride: bypass === true, treatmentAttemptId: attempt.id });
    if (!treated?.ok || treated.alreadyTreated) return woundTreatmentReview();
    attempt = { ...attempt, status: "completed", completedAt: Date.now() };
    if (!await saveWoundTreatmentAttempt(effect, attempt)) return woundTreatmentReview("The wound may have been treated, but the final record was not confirmed. Inspect it before retrying.");
    await _postWoundWorkflowCard({ title: "Treat Wound", actor, healer,
      lines: [`Success${bypass ? " (GM override)" : ""}. Wound marked treated; the GM confirms the approximately one-hour treatment.`, `Test Lane: ${attempt.lane}${tn ? ` (TN ${tn})` : ""}`] });
    return { ok: true, tn, bypass: bypass === true };
  } finally { releaseLock(lock); }
}

/** The GM inspects interrupted treatment before releasing its hold. */
export async function reviewWoundTreatment(actorLike, woundEffectId) {
  if (!game.user?.isGM) return { ok: false, reason: "gmOnly", reasonText: "Only the GM can review treatment." };
  const actor = await resolveActorLike(actorLike);
  const effect = actor?.effects?.get?.(String(woundEffectId)) ?? null;
  const record = effect?.getFlag?.(FLAG_SCOPE, "wounds");
  const attempt = record?.treatmentAttempt;
  if (!effect || record?.kind !== "wound" || !woundTreatmentNeedsReview(attempt)) return { ok: false, reason: "invalidAttempt", reasonText: "No unresolved treatment record was found." };
  if (!attempt || typeof attempt !== "object" || !String(attempt.id ?? "").trim()) return woundTreatmentReview("The treatment record is malformed. The GM must inspect and repair it before another attempt.");
  const lock = `wound-treatment:${actor.uuid}:${effect.id}`;
  if (!await acquireLock(lock, { wait: false })) return { ok: false, reason: "processing", reasonText: "This wound is still being processed on this client." };
  try {
    const dramaticDecision = attempt.status === "review" && attempt.reviewReason === "dramatic-decision" && attempt.result?.isSuccess === false;
    const notice = "Stop other clients processing this wound. Inspect its recorded roll, the wound, related conditions and chat before continuing.";
    let decision;
    if (dramaticDecision) {
      decision = await customDialog({ title: "Review wound treatment", layout: "workflow",
        content: `<p>${esc(notice)}</p><p>The book says a dramatic failure maims the affected body part. Decide whether this recorded failure was dramatic.</p><p>Roll: ${Number(attempt.result.rollTotal) || 0}; TN: ${Number(attempt.target) || 0}.</p>`,
        buttons: {
          dramatic: { label: "Dramatic: apply maiming", callback: () => "dramatic" },
          ordinary: { label: "Not dramatic", callback: () => "ordinary" },
          cancel: { label: "Cancel", callback: () => null }
        }, default: "cancel", width: 460 });
    } else {
      const confirmed = await confirmDialog({ title: "Review wound treatment", layout: "workflow",
        content: `<p>${esc(notice)}</p><p>Resolve any incomplete consequences manually. Confirm only after inspection; this releases the hold and does not replay the previous action.</p>`,
        yesLabel: "Reviewed", noLabel: "Cancel" });
      decision = confirmed ? "inspected" : null;
    }
    if (!decision) return { ok: false, reason: "cancelled", suppressUiWarning: true };
    const live = actor.effects?.get?.(effect.id)?.getFlag?.(FLAG_SCOPE, "wounds")?.treatmentAttempt;
    if (live?.id !== attempt.id || live?.status !== attempt.status) return woundTreatmentReview("The treatment record changed during review. Inspect it again before continuing.");
    let updated = attempt;
    if (decision === "dramatic") {
      updated = { ...attempt, status: "applying", reviewDecision: decision };
      if (!await saveWoundTreatmentAttempt(effect, updated)) return woundTreatmentReview();
      try { await applyMaimedOutcomeForWound(actor, effect, { reason: "dramatic-failure", immediate: true, strict: true }); }
      catch (error) {
        console.warn("UESRPG | Maiming requires review", error);
        return woundTreatmentReview("Maiming may be partially applied. Inspect the wound and conditions before resolving it manually.");
      }
    }
    updated = { ...updated, status: "reviewed", reviewDecision: decision, reviewedAt: Date.now(), reviewedBy: game.user.id };
    if (!await saveWoundTreatmentAttempt(effect, updated)) return woundTreatmentReview("The review could not be confirmed. Inspect the wound and conditions before retrying.");
    return { ok: true, decision };
  } finally { releaseLock(lock); }
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

export async function applyNaturalHealingToWounds(actorLike, healedAmount, { source = "rest", strict = false } = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { ok: false, reason: "invalidTarget" };
  const heal = Math.max(0, Math.floor(Number(healedAmount ?? 0) || 0));
  if (heal <= 0) return { ok: true, advanced: 0, source };
  await advanceTreatedWoundHealing(actor, heal, { strict });
  await enforceWoundInvariants(actor, { context: `naturalHealing:${String(source ?? "rest")}`, strict });
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
    layout: "workflow",
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
    layout: "workflow",
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

export async function attemptTreatAllWounds(actorLike, { healerActor = null, bypass = false } = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { ok: false, reason: "invalidTarget" };
  const allWounds = findEffectsByKind(actor, "wound");
  if (allWounds.some(ef => woundTreatmentNeedsReview(ef.getFlag?.(FLAG_SCOPE, "wounds")?.treatmentAttempt))) return woundTreatmentReview();
  const wounds = allWounds.filter((ef) => (ef.getFlag?.(FLAG_SCOPE, "wounds")?.treated !== true));
  if (!wounds.length) return { ok: true, treated: 0 };
  let treated = 0;
  let failed = 0;
  for (const wound of wounds) {
    const result = await attemptTreatWound(actor, wound.id, { healerActor, bypass });
    if (result?.ok) { treated++; continue; }
    if (result?.reason === "failedTest") { failed++; continue; }
    return { ...result, treated, failed, partial: treated > 0 || failed > 0 };
  }
  if (failed) return { ok: false, reason: "failedTest", reasonText: `Treated ${treated} wounds; ${failed} treatment tests failed.`, treated, failed };
  return { ok: true, treated, failed };
}

export async function reconcileWoundState(actorLike, { reason = "manual", emitLog = false, strict = false } = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { ok: false, reason: "invalidTarget" };
  const before = {
    woundState: getWoundState(actor),
    wounded: actor.system?.wounded === true,
    woundCount: findEffectsByKind(actor, "wound").length
  };
  await enforceWoundInvariants(actor, { context: `reconcile:${reason}`, strict });
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
export async function tickWoundsEndTurn(actor, { strict = false } = {}) {
  if (!actor) return;

  await enforceWoundInvariants(actor, { context: "tickWoundsEndTurn", strict });

  // Shock markers tick even if wounds were cleared mid-combat
  await tickShockMarkers(actor, { strict });

  // Defensive invariant: Blood Loss / Forestall should not persist when no wounds exist.
  if (!hasAnyWoundEffects(actor)) {
    await cleanupWoundStateIfNoWounds(actor, { strict });
    await tickDeathTestsEndTurn(actor, { strict });
    return;
  }

  await tickBloodLoss(actor, { strict });
  // Blood loss must see any active Forestall protection for the whole current
  // turn. Forestall then decrements/expires after that protected blood-loss check.
  await tickForestall(actor, { strict });
  await tickDeathTestsEndTurn(actor, { strict });
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

/** Awaited healing and legacy notifications share the same wound rules. */
export async function applyHealingWoundInteractions(actor, data, { strict = false } = {}) {
  try {
    if (!actor) return;
    if (!_hasWoundDomainState(actor)) return;
    if (!isActiveGMUser(game.user)) {
      const ok = await requestWoundsGM("healingApplied", { actorUuid: actor.uuid,
        data: { ...data, coreAftermathStage: "wounds", strictCompletion: strict } });
      if (strict && !ok) throw new Error("Wound healing authority did not confirm completion.");
      return ok;
    }

    await enforceWoundInvariants(actor, { context: "uesrpgHealingApplied", strict });
    if (!isDerivedWounded(actor) && !hasAnyWoundEffects(actor)) {
      await cleanupWoundStateIfNoWounds(actor, { strict });
      await enforceWoundInvariants(actor, { context: "uesrpgHealingApplied:cleanup", strict });
      return;
    }
    const untreatedBefore = findEffectsByKind(actor, "wound")
      .filter(effect => effect.getFlag?.(FLAG_SCOPE, "wounds")?.treated !== true);
    const effectiveHealed = Math.max(0, toNumber(data?.effectiveHealed ?? 0, 0));
    if (effectiveHealed > 0) {
      const hpCur = Number(actor.system?.hp?.value ?? 0) || 0;
      const hpMax = Number(actor.system?.hp?.max ?? 0) || 0;
      // HP has already committed before this notification. Do not heal twice.
      const committedHP = Number(data?.newHP ?? hpCur);
      const hpAfter = Number.isFinite(committedHP) ? committedHP : hpCur;
      if (untreatedBefore.length && hpMax > 0 && hpAfter >= hpMax) {
        for (const woundEf of untreatedBefore) {
          await applyMaimedOutcomeForWound(actor, woundEf, { reason: "healed-to-full-untreated", immediate: true, strict });
        }
      }
      await applyHealingForestall(actor, effectiveHealed, { strict });
      await advanceTreatedWoundHealing(actor, effectiveHealed, { strict });
    } else {
      await enforceWoundInvariants(actor, { context: "uesrpgHealingApplied:post", strict });
    }
  } catch (err) {
    if (strict) throw err;
    console.warn("UESRPG | Wound healing interaction failed", err);
    return false;
  }
}

export async function settleHealingTargetState(actor, data, { strict = false } = {}) {
  if (!actor) return;
  const npc = String(actor.type ?? "").toLowerCase() === "npc";
  if (!npc && (!(Number(actor.system?.hp?.value) > 0) || !hasDeathState(actor))) return;
  if (!isActiveGMUser(game.user)) {
    const ok = await requestWoundsGM("healingApplied", { actorUuid: actor.uuid,
      data: { ...data, coreAftermathStage: "targetState", strictCompletion: strict } });
    if (strict && !ok) throw new Error("Healing target-state authority did not confirm completion.");
    return ok;
  }
  if (npc) return syncNpcDeathState(actor, { strict });
  return clearDeathState(actor, { strict });
}

export async function applyDamageWoundInteractions(actor, data, { strict = false } = {}) {
  if (actor && data?.woundTriggered === true && !isActiveGMUser(game.user)) {
    const ok = await requestWoundsGM("damageApplied", { actorUuid: actor.uuid, data: { ...data, strictCompletion: strict } });
    if (strict && !ok) throw new Error("Wound damage authority did not confirm completion.");
    return ok;
  }
    const startedAt = actor && data?.woundTriggered === true && isPerfEnabled() ? monoMs() : null;
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

      if (!woundDoc) {
        if (strict) throw new Error("Wound creation was not confirmed.");
        return;
      }

      const w = woundDoc.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
      // Guard: post at most one shock card per wound application.
      if (w.shockPosted === true) return;

      // Ensure every wound has a stable applicationId for linking Shock markers + cleanup.
      let appId = String(w.applicationId ?? data?.applicationId ?? "").trim();
      if (!appId) appId = String(woundDoc.id ?? "");
      if (appId && !String(w.applicationId ?? "").trim()) {
        try {
          if (!await requestUpdateDocument(woundDoc, { [`${FLAG_PATH}.wounds.applicationId`]: appId }, { render: false })) throw new Error("Wound application identity was not saved.");
        } catch (_e) {
          if (strict) throw _e;
          // Non-blocking; proceed with local appId.
        }
      }

      const hitLocation = normalizeHitLocation(w.hitLocation ?? data?.hitLocation ?? "Body");
      const damageAppliedByType = data?.damageAppliedByType ?? null;

      // Persist details for later resolution (button click). This also provides idempotency.
      try {
        const confirmed = await requestUpdateDocument(woundDoc, {
          [`${FLAG_PATH}.wounds.shockPosted`]: true,
          [`${FLAG_PATH}.wounds.shockPostedAt`]: Date.now(),
          [`${FLAG_PATH}.wounds.damageAppliedByType`]: damageAppliedByType
        }, { render: false });
        if (strict && !confirmed) throw new Error("Wound shock claim was not saved.");
      } catch (_e) {
        if (strict) throw _e;
        // Non-blocking; idempotency is best-effort.
      }

      // Apply immediate (non-conditional) shock effects at wound time.
      await applyShockUnconditional(actor, {
        hitLocation,
        applicationId: appId || null, strict
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
        if (strict) throw err;
        console.warn("UESRPG | Failed to post shock test card", err);
      }
    } catch (err) {
      if (strict) throw err;
      console.warn("UESRPG | Wound application failed", err);
    } finally {
      // Direct stages and legacy notification adapters share this workflow.
      if (startedAt !== null) perfRecord({
        event: "damage.woundWorkflow",
        actorUuid: actor?.uuid ?? null,
        applicationId: data?.applicationId ?? null,
        durationMs: monoMs() - startedAt,
      });
    }
}

/** Register wound hooks once from the system initialization workflow. */
export function registerWoundHooks() {
  if (_woundHooksRegistered) return;
  _woundHooksRegistered = true;


  registerWoundSocket({
    onDamageApplied: async (actor, data) => data.coreAftermathStage === "deathState"
      ? (await import("./death-tests.js")).settleDamageDeathState(actor, data, { strict: data.strictCompletion === true })
      : applyDamageWoundInteractions(actor, data, { strict: data.strictCompletion === true }),
    onHealingApplied: (actor, data) => data?.coreAftermathStage === "targetState"
      ? settleHealingTargetState(actor, data, { strict: data.strictCompletion === true })
      : applyHealingWoundInteractions(actor, data, { strict: data?.strictCompletion === true }),
    onResolveShock: async (actor, data) => {
      const woundEffectId = data?.woundEffectId ?? null;
      const action = data?.action ?? "shock-roll";
      await resolveShockTestFromChat({ actorUuid: actor.uuid, woundEffectId, action });
    }
  });

  registerWoundCombatTicker({ tickActorEndTurn: tickWoundsEndTurn });

  Hooks.on("uesrpgDamageApplied", (actor, data) => {
    if (data?.handledDomains?.includes("wounds")) return;
    void applyDamageWoundInteractions(actor, data).catch(error => console.warn("UESRPG | Wound creation failed", error));
  });

  Hooks.on("uesrpgHealingApplied", async (actor, data) => {
    try {
      if (data?.coreAftermathHandled) return;
      if (!actor) return;
      await applyHealingWoundInteractions(actor, data);
    } catch (err) {
      console.warn("UESRPG | Wound healing interaction failed", err);
    }
  });

  TimeService.registerOwnedWorldTimeStage({ id: "wound-deadlines", order: 300, handle: async (payload) => {
    if (!isActiveGMUser(game.user)) return;
    const worldTime = Number(payload?.worldTime ?? getCurrentWorldTimeSeconds());
    if (!Number.isFinite(worldTime)) return;

    const actors = MagicTimekeeping.collectRelevantActors();
    for (const actor of actors) {
      if (!actor) continue;
      const hasWounds = findEffectsByKind(actor, "wound").length > 0;
      if (!hasWounds) continue;

      const last = Number(actor.getFlag(FLAG_SCOPE, "wounds.lastDeadlineCheckWorldTime") ?? 0) || 0;
      if (last > 0 && (worldTime - last) < 86400) continue;

      await evaluateUntreatedWoundDeadlines(actor, { nowWorldTimeSeconds: worldTime, strict: true });
      try {
        if (!await requestUpdateDocument(actor, { [`${FLAG_PATH}.wounds.lastDeadlineCheckWorldTime`]: worldTime }, { render: false })) throw new Error("Wound deadline checkpoint was not confirmed.");
      } catch (_e) {
        throw _e;
      }
    }
  } });

  Hooks.on("updateActor", (actor, changed) => {
    if (!isActiveGMUser(game.user)) return;
    const keys = Object.keys(foundry.utils.flattenObject(changed ?? {}));
    const woundedChanged = keys.includes("system.wounded");
    const hpChanged = keys.some(key => key === "system.hp" || key.startsWith("system.hp."));
    if ((!woundedChanged && !hpChanged) || !_hasWoundDomainState(actor)) return;

    if (keys.includes("system.hp.value")) {
      const hpValue = Number(actor?.system?.hp?.value ?? 0) || 0;
      const hpMax = Number(actor?.system?.hp?.max ?? 0) || 0;
      if (hpMax > 0 && hpValue >= hpMax) {
        const untreated = findEffectsByKind(actor, "wound").filter(ef => getWoundsFlag(ef)?.treated !== true);
        for (const woundEf of untreated) {
          applyMaimedOutcomeForWound(actor, woundEf, { reason: "healed-to-full-untreated", immediate: true }).catch(() => {});
        }
      }
    }
    void enforceWoundInvariants(actor, { markDirty: true,
      context: woundedChanged ? "updateActor:woundedChanged" : "updateActor:hpChanged" });
  });

  const reconcileFromEffect = async (effect, context, changed = null) => {
    try {
      if (!isActiveGMUser(game.user)) return;
      const actor = effect?.parent?.documentName === "Actor" ? effect.parent : null;
      if (!actor) return;
      noteNpcDeathStateEffectChange(actor, effect, { context, changed });
      if (!_isWoundDomainEffect(effect, changed)) return;
      await enforceWoundInvariants(actor, { context, markDirty: true });
    } catch (error) {
      console.warn("UESRPG | Wound effect reconciliation adapter failed", { actorUuid: effect?.parent?.uuid, context, error });
    }
  };

  Hooks.on("createActiveEffect", effect => { void reconcileFromEffect(effect, "createActiveEffect"); });
  Hooks.on("updateActiveEffect", (effect, changed) => { void reconcileFromEffect(effect, "updateActiveEffect", changed); });
  Hooks.on("deleteActiveEffect", effect => { void reconcileFromEffect(effect, "deleteActiveEffect"); });
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
  reviewWoundTreatment,
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
