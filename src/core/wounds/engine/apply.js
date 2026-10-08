import { renderTNSummary, bindTNEstimates } from "../../../ui/shared/tn-presentation.js";
import { emitSuppressedSubRollDice } from "../../../utils/dice-visualization.js";
/**
 * src/core/wounds/engine/apply.js
 *
 * Document mutation orchestration for wound engine.
 * All functions that update actors, create/delete effects, etc.
 */

import { doTestRoll, formatResultOutcomeLabel } from "../../../utils/degree-roll-helper.js";
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments, requestUpdateChatMessage, requestUpdateDocument, requestUpdateEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { createSeverityDebugLogger } from "../../../utils/debug.js";
import { t, tf } from "../../../utils/i18n.js";
import { createUuidResolver } from "../../../utils/uuid-cache.js";
import { isActorUndead, isActorUndeadBloodless } from "../../traits/trait-registry.js";
import { hasTalent } from "../../traits/talents-api.js";
import { applyGroupedEffect, getEffectGroup } from "../../../utils/ae-helpers.js";
import { normalizeHitLocation, isActiveGMUser, normalizeDamageTypeKey, canonicalizeShockKind, isShockKind, SHOCK_KINDS } from "../wound-schema.js";
import { requestWoundsGM } from "../wound-socket.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { SYSTEM_ID, FLAG_SCOPE } from "../../constants.js";
import { getDifficultyByKey } from "../../skills/skill-tn.js";
import { 
  findEffectsByKind, 
  findFirstEffectByKind, 
  findFirstEffectByAppId,
  hasAnyWoundEffects,
  getEffects,
  toNumber,
  getWoundsFlag,
  computeDominantMagicType
} from "./calc.js";
import { makeEffect, getWhisperRecipientsForActor } from "./format.js";
import { getWoundState, isDerivedWounded, getBloodLossStatus, WOUND_STATES } from "./state.js";
import { buildDifficultyOptionsHtml, deleteOwnedEffects, getCurrentWorldTimeSeconds } from "../shared.js";
import { buildEffectChange, buildEffectChangesData } from "../../../utils/compat.js";
import { hasCondition } from "../../conditions/engine/queries.js";

import { isPerfEnabled, monoMs, perfRecord, perfTrackDocumentActivity } from "../../../utils/perf-tracker.js";

const FLAG_PATH = `flags.${FLAG_SCOPE}`;
const _SHOCK_IN_FLIGHT = new Set();
const _INVARIANTS_IN_FLIGHT = new Map();
const _MAIMED_IN_FLIGHT = new Map();
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const _debugWounds = createSeverityDebugLogger("woundsDebug", "[UESRPG][Wounds]", "debug");

function confirmWoundWrite(result, strict, label) {
  if (strict && (!result || (Array.isArray(result) && !result.length))) {
    throw new Error(`${label} was not confirmed.`);
  }
  return result;
}

async function _promptShockRollOptions(actor, baseTn) {
  const baseTNLabel = t("UESRPG.Dialogs.ShockTest.BaseTNEND");
  const difficultyLabel = t("UESRPG.UI.Difficulty");
  const manualModifierLabel = t("UESRPG.UI.ManualModifier");
  const readShockOptions = (root) => {
  const baseValue = String(root?.querySelector('input[name="baseTn"]')?.value ?? "").trim();
  const manualValue = String(root?.querySelector('input[name="manualMod"]')?.value ?? "").trim();
  const difficultyKey = String(root?.querySelector('select[name="difficultyKey"]')?.value ?? "average");
  const baseTN = Number(baseValue);
  const manualMod = Number(manualValue);
  const difficulty = getDifficultyByKey(difficultyKey);
  const target = Math.max(0, baseTN + difficulty.mod + manualMod);
  if (!baseValue || !manualValue || baseTN < 0 || !Number.isFinite(baseTN)
    || !Number.isFinite(manualMod) || !Number.isFinite(target)) {
    return null;
  }
  return { declaration: { difficulty, manualMod, target }, estimate: { finalTN: target, breakdown: [
    { key: "base", label: baseTNLabel, value: baseTN }, { label: difficulty.label, value: difficulty.mod }, { label: manualModifierLabel, value: manualMod },
  ] } };
  };
  const content = `
    <div class="uesrpg-skill-roll">
      ${renderTNSummary(t("UESRPG.Chat.Shock.HeaderTest", "Shock Test"))}
      <div class="form-group">
        <label><b>${baseTNLabel}</b></label>
        <input name="baseTn" type="number" min="0" step="any" required value="${Number(baseTn) || 0}" style="width:100%;" />
      </div>
      <div class="form-group" style="margin-top:8px;">
        <label><b>${difficultyLabel}</b></label>
        <select name="difficultyKey" style="width:100%;">${buildDifficultyOptionsHtml("average")}</select>
      </div>
      <div class="form-group" style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <label style="margin:0;"><b>${manualModifierLabel}</b></label>
        <input name="manualMod" type="number" step="any" required value="0" style="width:120px;" />
      </div>
    </div>
  `;
  const picked = await customDialog({
    layout: "workflow",
    title: tf("UESRPG.Dialogs.ShockTest.Title", { actor: esc(actor?.name ?? "Actor") }),
    content,
    render: (_event, dialog) => bindTNEstimates(dialog.element, () => readShockOptions(dialog.element)?.estimate ?? { reason: t("UESRPG.Notifications.Shock.InvalidRollOptions") }),
    buttons: {
      roll: {
        label: t("UESRPG.UI.Roll"),
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const options = readShockOptions(root);
          if (!options) ui.notifications?.warn?.(t("UESRPG.Notifications.Shock.InvalidRollOptions"));
          return options?.declaration ?? null;
        }
      },
      cancel: { label: t("UESRPG.UI.Cancel"), callback: () => null }
    },
    default: "roll",
    width: 420
  });
  return picked ?? null;
}

function _findShockMarker(actor, { applicationId = "", kind = "", hitLocation = "" } = {}) {
  const appId = String(applicationId ?? "").trim();
  const targetKind = canonicalizeShockKind(kind);
  if (!appId || !targetKind) return null;
  const targetLoc = String(hitLocation ?? "").trim().toLowerCase();
  const effects = getEffects(actor);
  for (const ef of effects) {
    const wf = getWoundsFlag(ef) ?? {};
    if (String(wf.applicationId ?? "").trim() !== appId) continue;
    if (canonicalizeShockKind(wf.kind) !== targetKind) continue;
    if (!targetLoc) return ef;
    const efLoc = String(wf.hitLocation ?? "").trim().toLowerCase();
    if (!efLoc || efLoc === targetLoc) return ef;
  }
  return null;
}

function _statusesForShockKind(kind) {
  const canonical = canonicalizeShockKind(kind);
  if (canonical === "shockStunned") return ["stunned"];
  return [];
}

async function _upsertShockMarker(actor, { applicationId = "", kind = "", hitLocation = null, name = "Marker", img = "icons/svg/skull.svg", changes = [], extraWoundFlags = {}, strict = false } = {}) {
  if (!actor) return null;
  const appId = String(applicationId ?? "").trim();
  const canonicalKind = canonicalizeShockKind(kind);
  if (!canonicalKind) return null;
  if (appId) {
    const existing = _findShockMarker(actor, { applicationId: appId, kind: canonicalKind, hitLocation });
    if (existing) {
      if (strict) {
        const current = getWoundsFlag(existing) ?? {};
        const patch = Object.fromEntries(Object.entries(extraWoundFlags)
          .filter(([key, value]) => current[key] !== value).map(([key, value]) => [`${FLAG_PATH}.wounds.${key}`, value]));
        if (Object.keys(patch).length) confirmWoundWrite(await requestUpdateDocument(existing, patch), strict, "Maimed marker update");
        await _applyPersistentConditionForLostMarker(actor, { kind: canonicalKind, hitLocation, strict });
      }
      return existing;
    }
  }

  const woundFlags = {
    kind: canonicalKind,
    ...(appId ? { applicationId: appId } : {}),
    ...(hitLocation ? { hitLocation: String(hitLocation) } : {}),
    ...(extraWoundFlags ?? {})
  };
  const docs = await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [{
    name: String(name ?? "Marker"),
    img,
    statuses: _statusesForShockKind(canonicalKind),
    ...buildEffectChangesData(Array.isArray(changes) ? changes : []),
    flags: { [FLAG_SCOPE]: { wounds: woundFlags } }
  }]);
  const created = Array.isArray(docs) ? (docs[0] ?? null) : null;
  confirmWoundWrite(created, strict, "Shock marker creation");
  if (created) await _applyPersistentConditionForLostMarker(actor, { kind: canonicalKind, hitLocation, strict });
  return created;
}

function _lostKindForLocation(loc) {
  const key = String(loc?.key ?? "").toLowerCase();
  if (key.includes("eye")) return "shockLostEye";
  if (key.includes("ear")) return "shockLostEar";
  return "shockLostLimb";
}

async function _applyPersistentConditionForLostMarker(actor, { kind = "", hitLocation = "", strict = false } = {}) {
  const api = game?.uesrpg?.conditions;
  if (!api?.setConditionValue && !strict) return;

  const setCondition = async (key) => {
    if (strict && hasCondition(actor, key)) return;
    if (typeof api?.setConditionValue !== "function") throw new Error("The condition engine is unavailable.");
    await api.setConditionValue(actor, key, 1);
    if (strict && !hasCondition(actor, key)) throw new Error(`The ${key} condition was not confirmed.`);
  };

  const effects = getEffects(actor);
  const countKind = (k) => effects.filter((ef) => canonicalizeShockKind(getWoundsFlag(ef)?.kind) === k).length;

  if (kind === "shockLostEye") {
    if (countKind("shockLostEye") >= 2) await setCondition("blinded");
    return;
  }
  if (kind === "shockLostEar") {
    if (countKind("shockLostEar") >= 2) await setCondition("deafened");
    return;
  }
  if (kind !== "shockLostLimb") return;

  const label = String(hitLocation ?? "").toLowerCase();
  const isLegLike = label.includes("leg") || label.includes("foot");
  if (!isLegLike) return;

  await setCondition("slowed");
  const legLossCount = effects.filter((ef) => {
    const wf = getWoundsFlag(ef) ?? {};
    if (canonicalizeShockKind(wf?.kind) !== "shockLostLimb") return false;
    const loc = String(wf?.hitLocation ?? "").toLowerCase();
    return loc.includes("leg") || loc.includes("foot");
  }).length;
  if (legLossCount >= 2) await setCondition("immobilized");
}

export async function applyMaimedOutcomeForWound(actor, woundEffect, options = {}) {
  if (!actor || !woundEffect) return { applied: false, reason: "invalid" };
  const key = `${actor.uuid}:${woundEffect.id}`;
  let task = _MAIMED_IN_FLIGHT.get(key);
  if (!task) {
    task = Promise.resolve().then(() => _applyMaimedOutcomeForWound(actor, woundEffect, options));
    _MAIMED_IN_FLIGHT.set(key, task);
  }
  try {
    const result = await task;
    if (options.strict) {
      const wound = getWoundsFlag(woundEffect) ?? {};
      const loc = normalizeHitLocation(wound.hitLocation ?? "Body");
      const kind = loc?.region === "head" ? "shockLostEye" : loc?.region === "limb" ? _lostKindForLocation(loc) : "shockCrippleBody";
      const marker = _findShockMarker(actor, { applicationId: wound.applicationId ?? woundEffect.id, kind, hitLocation: loc?.label ?? "Body" });
      if (!result?.applied || wound.maimed !== true || getWoundsFlag(marker)?.maimed !== true
        || getWoundsFlag(marker)?.permanent !== true) throw new Error("The maimed wound outcome was not confirmed.");
      await _applyPersistentConditionForLostMarker(actor, { kind, hitLocation: loc?.label ?? "Body", strict: true });
    }
    return result;
  } finally {
    if (_MAIMED_IN_FLIGHT.get(key) === task) _MAIMED_IN_FLIGHT.delete(key);
  }
}

async function _applyMaimedOutcomeForWound(actor, woundEffect, { reason = "maimed", immediate = false, strict = false } = {}) {
  if (!actor || !woundEffect) return { applied: false, reason: "invalid" };
  const w = getWoundsFlag(woundEffect) ?? {};
  const appId = String(w?.applicationId ?? woundEffect?.id ?? "").trim();
  if (!appId) return { applied: false, reason: "missingAppId" };

  const loc = normalizeHitLocation(w?.hitLocation ?? "Body");
  const label = loc?.label ?? "Body";
  const region = loc?.region ?? "body";
  const markerKind = region === "head" ? "shockLostEye" : region === "limb" ? _lostKindForLocation(loc) : "shockCrippleBody";
  const existing = _findShockMarker(actor, { applicationId: appId, kind: markerKind, hitLocation: label });
  if (w.maimed === true && getWoundsFlag(existing)?.maimed === true && getWoundsFlag(existing)?.permanent === true) {
    if (strict) await _applyPersistentConditionForLostMarker(actor, { kind: markerKind, hitLocation: label, strict });
    return { applied: true, alreadyApplied: true, reason: w.maimedReason ?? reason };
  }
  const now = Number(w.maimedAt) || Date.now();

  if (region === "head") {
    await _upsertShockMarker(actor, {
      applicationId: appId,
      kind: "shockLostEye",
      strict,
      hitLocation: label,
      name: `Lost Eye (${label})`,
      img: "icons/svg/eye.svg",
      extraWoundFlags: { permanent: true, maimed: true, maimedAt: now, maimedReason: reason, immediate: immediate === true }
    });
  } else if (region === "limb") {
    await _upsertShockMarker(actor, {
      applicationId: appId,
      kind: _lostKindForLocation(loc),
      strict,
      hitLocation: label,
      name: `Lost Limb (${label})`,
      img: "icons/svg/skull.svg",
      extraWoundFlags: { permanent: true, maimed: true, maimedAt: now, maimedReason: reason, immediate: immediate === true }
    });
  } else {
    await _upsertShockMarker(actor, {
      applicationId: appId,
      kind: "shockCrippleBody",
      strict,
      hitLocation: label,
      name: `Maimed Body (${label})`,
      img: "icons/svg/skull.svg",
      changes: [
        buildEffectChange({ key: "system.stamina.max", type: "add", value: -1, priority: 20 }),
        buildEffectChange({ key: "system.wound_threshold.value", type: "add", value: -1, priority: 20 })
      ],
      extraWoundFlags: { permanent: true, maimed: true, maimedAt: now, maimedReason: reason, immediate: immediate === true }
    });
  }

  if (!_findShockMarker(actor, { applicationId: appId, kind: markerKind, hitLocation: label })) {
    if (strict) throw new Error("The maimed marker was not created.");
    return { applied: false, failed: true, reason };
  }
  try {
    const updated = await requestUpdateDocument(woundEffect, {
      [`${FLAG_PATH}.wounds.maimed`]: true,
      [`${FLAG_PATH}.wounds.maimedAt`]: now,
      [`${FLAG_PATH}.wounds.maimedReason`]: String(reason ?? "maimed")
    });
    confirmWoundWrite(updated, strict, "Maimed wound flags");
    if (!updated) return { applied: false, failed: true, reason };
  } catch (_e) {
    if (strict) throw _e;
    // Non-blocking.
  }
  return { applied: true, reason };
}


/**
 * Apply unconditional shock effects (immediate, not test-gated)
 */
export async function applyShockUnconditional(actor, { hitLocation, applicationId, strict = false } = {}) {
  if (!actor) return;

  const loc = hitLocation ?? normalizeHitLocation("Body");
  const region = loc?.region ?? "body";
  const hitLocationLabel = loc?.label ?? "Body";
  const hitLocationKey = loc?.key ?? "body";

  // Per Chapter 5, these effects apply when the wound is inflicted (regardless of Shock test result).
  if (region === "body") {
    const cur = Number(actor.system?.action_points?.value ?? 0) || 0;
    if (cur > 0) {
      confirmWoundWrite(await requestUpdateDocument(actor, { "system.action_points.value": Math.max(0, cur - 1) }), strict, "Body shock AP consumption");
    } else {
      const debtRaw = Number(actor.getFlag(FLAG_SCOPE, "wounds.apDebtNextRefresh") ?? 0);
      const debt = Number.isFinite(debtRaw) ? debtRaw : 0;
      confirmWoundWrite(await requestUpdateDocument(actor, { [`${FLAG_PATH}.wounds.apDebtNextRefresh`]: debt + 1 }), strict, "Body shock AP debt");
    }
    return;
  }

  // For limb/head we create tracking AEs. These are non-HUD, non-migrating markers.
  if (region === "limb") {
    const name = `Crippled Limb (${hitLocationLabel || "Limb"})`;
    await _upsertShockMarker(actor, {
      applicationId: String(applicationId ?? ""),
      kind: "shockCripple",
      hitLocation: hitLocationLabel ?? null,
      name,
      img: "icons/svg/bones.svg",
      strict,
    });
    return;
  }

  if (region === "head") {
    const name = `Stunned (${hitLocationLabel || "Head"})`;
    await _upsertShockMarker(actor, {
      applicationId: String(applicationId ?? ""),
      kind: "shockStunned",
      hitLocation: hitLocationLabel ?? null,
      name,
      img: "icons/svg/daze.svg",
      extraWoundFlags: { remainingTurns: 1 },
      strict,
    });
    return;
  }
}

/**
 * Apply shock failure consequences (test failed)
 */
export async function applyShockFailConsequence(actor, { hitLocation, applicationId } = {}) {
  if (!actor) return { note: null };
  const region = hitLocation?.region ?? "body";
  const hitLocationLabel = hitLocation?.label ?? "Limb";
  const appId = String(applicationId ?? "").trim();

  if (region === "body") {
    if (appId) {
      await _upsertShockMarker(actor, {
        applicationId: appId,
        kind: "shockCrippleBody",
        hitLocation: hitLocationLabel ?? "Body",
        name: tf("UESRPG.Chat.Shock.EffectCrippledBody", { location: hitLocationLabel ?? "Body" }),
        img: "icons/svg/skull.svg"
      });
    }

    const cur = Number(actor.system?.action_points?.value ?? 0) || 0;
    if (cur > 0) {
      await requestUpdateDocument(actor, { "system.action_points.value": Math.max(0, cur - 1) });
      return { note: t("UESRPG.Chat.Shock.LostAPCrippledBody") };
    }

    const debtRaw = Number(actor.getFlag(FLAG_SCOPE, "wounds.apDebtNextRefresh") ?? 0);
    const debt = Number.isFinite(debtRaw) ? debtRaw : 0;
    await requestUpdateDocument(actor, { [`${FLAG_PATH}.wounds.apDebtNextRefresh`]: debt + 1 });
    return { note: t("UESRPG.Chat.Shock.APDebtCrippledBody") };
  }

  if (region === "limb") {
    await _upsertShockMarker(actor, {
      applicationId: appId,
      kind: "shockLostLimb",
      hitLocation: hitLocationLabel,
      name: tf("UESRPG.Chat.Shock.EffectLostLimb", { location: hitLocationLabel }),
      img: "icons/svg/skull.svg"
    });
    return { note: t("UESRPG.Chat.Shock.LostLimb") };
  }

  if (region === "head") {
    const choice = await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.ShockTest.HeadWoundLostSenseTitle"),
      content: `<p>${t("UESRPG.Dialogs.ShockTest.HeadWoundLostSenseContent")}</p>`,
      buttons: {
        ear: { label: t("UESRPG.Dialogs.ShockTest.HeadWoundLostSenseEar"), callback: () => "ear" },
        eye: { label: t("UESRPG.Dialogs.ShockTest.HeadWoundLostSenseEye"), callback: () => "eye" }
      },
      default: "eye"
    });

    if (choice === "ear") {
      await _upsertShockMarker(actor, {
        applicationId: appId,
        kind: "shockLostEar",
        hitLocation: hitLocationLabel ?? "Head",
        name: tf("UESRPG.Chat.Shock.EffectLostEar", { location: hitLocationLabel ?? "Head" }),
        img: "icons/svg/skull.svg"
      });
      return { note: t("UESRPG.Chat.Shock.LostEar") };
    }

    await _upsertShockMarker(actor, {
      applicationId: appId,
      kind: "shockLostEye",
      hitLocation: hitLocationLabel ?? "Head",
      name: tf("UESRPG.Chat.Shock.EffectLostEye", { location: hitLocationLabel ?? "Head" }),
      img: "icons/svg/eye.svg"
    });
    return { note: t("UESRPG.Chat.Shock.LostEye") };
  }

  return { note: null };
}

/**
 * Apply magic-type shock side effects
 */
export async function applyShockMagicSideEffect(actor, { chosenType, damageAppliedByType = {} } = {}) {
  if (!actor || !chosenType) return { note: null };

  const type = normalizeDamageTypeKey(chosenType);
  if (type === "shock") {
    const loss = Number(damageAppliedByType?.shock ?? damageAppliedByType?.Shock ?? 0) || 0;
    if (loss > 0) {
      const cur = Number(actor.system?.magicka?.value ?? 0) || 0;
      await requestUpdateDocument(actor, { "system.magicka.value": Math.max(0, cur - loss) });
    }
    return { note: loss > 0 ? tf("UESRPG.Chat.Shock.LostMagicka", { loss }) : t("UESRPG.Chat.Shock.LostMagicka", "Lost Magicka") };
  }

  if (type === "magic" || type === "frost" || type === "poison") {
    const cur = Number(actor.system?.stamina?.value ?? 0) || 0;
    await requestUpdateDocument(actor, { "system.stamina.value": Math.max(0, cur - 1) });
    return { note: t("UESRPG.Chat.Shock.LostStamina") };
  }

  if (type === "fire") {
    // Chapter 5: choose STR or AGI to avoid Burning(1).
    const choose = await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.ShockTest.FireWoundAvoidBurningTitle"),
      content: `${renderTNSummary([{ key: "str", label: "Strength" }, { key: "agi", label: "Agility" }])}<p>${t("UESRPG.Dialogs.ShockTest.FireWoundAvoidBurningContent")}</p>`,
      render: (_event, dialog) => bindTNEstimates(dialog.element, () => ["str", "agi"].map(key => ({ key, result: { finalTN: Number(actor.system?.characteristics?.[key]?.total ?? 0) || 0 } }))),
      buttons: {
        str: { label: t("UESRPG.Dialogs.ShockTest.FireWoundAvoidBurningRollSTR"), callback: () => "str" },
        agi: { label: t("UESRPG.Dialogs.ShockTest.FireWoundAvoidBurningRollAGI"), callback: () => "agi" }
      },
      default: "str"
    });

    const key = choose === "agi" ? "agi" : "str";
    const tn = Number(actor.system?.characteristics?.[key]?.total ?? 0) || 0;
    const result = await doTestRoll(actor, { target: tn, rollFormula: "1d100" });
    const passed = !!result?.isSuccess;

    // Real roll message for Dice So Nice (blind GM).
    try {
      await result.roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: tf("UESRPG.Chat.Shock.FireWoundAvoidBurningFlavor", { actor: actor.name, key: key.toUpperCase() }),
        rollMode: "blindroll"
      });
    } catch (_e) {
      // Non-blocking.
    }

    if (!passed) {
      const api = game?.uesrpg?.conditions;
      if (api?.applyBurning) {
        await api.applyBurning(actor, 1, { hitLocation: "Body", source: "Shock (Fire)" });
      } else if (api?.setConditionValue) {
        await api.setConditionValue(actor, "burning", 1);
      }
      return { note: t("UESRPG.Chat.Shock.Burning") };
    }

    return { note: t("UESRPG.Chat.Shock.AvoidedBurning") };
  }

  return { note: null };
}

/**
 * Post shock test chat card
 */
export async function postShockTestChatCard({ actor, woundEffect, hitLocation, damageAppliedByType, applicationId } = {}) {
  if (!actor || !woundEffect) return;
  const endTN = Number(actor.system?.characteristics?.end?.total ?? 0) || 0;
  const hitLocationLabel = hitLocation?.label ?? String(hitLocation ?? "");

  const cardHtml = _renderShockTestCard({
    actor,
    woundEffectId: woundEffect.id,
    hitLocationLabel,
    endTN
  });

  const msgFlags = {
    [FLAG_SCOPE]: {
      wounds: {
        kind: "shockCard",
        actorUuid: actor.uuid,
        woundEffectId: woundEffect.id,
        applicationId: String(applicationId ?? ""),
        hitLocation: hitLocationLabel ?? null,
        damageAppliedByType: damageAppliedByType ?? null,
        resolved: false,
        resolving: false,
        endTN,
        finalTN: null,
        rollTotal: null,
        isSuccess: null,
        isCriticalSuccess: null,
        isCriticalFailure: null,
        passed: null,
        dieHardRerolled: false,
        failNote: null,
        magicNote: null
      }
    }
  };

  const whisper = getWhisperRecipientsForActor(actor);
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: cardHtml,
    flags: msgFlags,
    whisper: whisper,
    blind: false,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER
  });
}

function _showShockRoll3d(roll, actor, message) {
  void emitSuppressedSubRollDice(roll, { actor, message, whisper: getWhisperRecipientsForActor(actor) });
}

function _renderShockTestCard({
  actor,
  woundEffectId,
  hitLocationLabel,
  endTN,
  finalTN = null,
  rollTotal = null,
  isSuccess = null,
  isCriticalSuccess = null,
  isCriticalFailure = null,
  passed = null,
  dieHardRerolled = false,
  failNote = null,
  magicNote = null,
  resolving = false,
  resolved = false
} = {}) {
  const actorName = esc(actor?.name ?? "Actor");
  const safeHitLocationLabel = esc(hitLocationLabel || "(unknown)");
  const actorUuid = esc(actor?.uuid ?? "");
  const safeWoundEffectId = esc(woundEffectId ?? "");
  const outcomeSuccess = isSuccess ?? passed;
  const hasFinalTn = finalTN !== null && finalTN !== undefined && String(finalTN) !== "";
  const hasRollTotal = rollTotal !== null && rollTotal !== undefined && String(rollTotal) !== "";
  const targetContext = `
    <div class="uesrpg-shock-context">
      <div><strong>${t("UESRPG.Chat.Shock.Target")}</strong> ${actorName}</div>
      <div><strong>${t("UESRPG.Chat.Shock.Location")}</strong> ${safeHitLocationLabel}</div>
    </div>`;
  const pendingRows = resolving
    ? `<div><strong>${t("UESRPG.Chat.Shock.Status")}</strong> ${t("UESRPG.Chat.Shock.Resolving")}</div>`
    : "";

  const resolvedRows = `
    <div class="uesrpg-chat-summary-grid">
      ${hasFinalTn ? `<div><strong>${t("UESRPG.Chat.Shock.TN")}</strong> ${Number(finalTN)}</div>` : ``}
      ${hasRollTotal ? `<div><strong>${t("UESRPG.Chat.Shock.Roll")}</strong> ${Number(rollTotal)}</div>` : ``}
      <div><strong>${t("UESRPG.Chat.Shock.Result")}</strong> ${formatResultOutcomeLabel({ isSuccess: outcomeSuccess, isCriticalSuccess, isCriticalFailure })}</div>
      ${dieHardRerolled ? `<div><strong>${t("UESRPG.Chat.Shock.DieHard")}</strong> ${t("UESRPG.Chat.Shock.RerollUsed")}</div>` : ``}
      ${failNote ? `<div style="grid-column:1 / -1; display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 10px; align-items:start;"><strong>${t("UESRPG.Chat.Shock.Consequence")}</strong><span style="overflow-wrap:anywhere;">${esc(failNote)}</span></div>` : ``}
      ${magicNote ? `<div style="grid-column:1 / -1; display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 10px; align-items:start;"><strong>${t("UESRPG.Chat.Shock.Magic")}</strong><span style="overflow-wrap:anywhere;">${esc(magicNote)}</span></div>` : ``}
    </div>`;

  return `
  <div class="uesrpg-chat-card uesrpg-chat-surface" data-card="shock">
    <header class="card-header">
      <h3>${resolved ? t("UESRPG.Chat.Shock.HeaderResult") : t("UESRPG.Chat.Shock.HeaderTest")}</h3>
    </header>
    <div class="card-content">
      ${targetContext}
      ${resolved ? resolvedRows : pendingRows}
    </div>
    ${resolved ? "" : `<footer class="card-footer">
      <button type="button" data-ues-shock-action="shock-roll" data-actor-uuid="${actorUuid}" data-wound-effect-id="${safeWoundEffectId}" ${resolving ? "disabled" : ""}>${resolving ? t("UESRPG.Chat.Shock.ButtonResolving") : t("UESRPG.Chat.Shock.ButtonRollShockEND")}</button>
    </footer>`}
  </div>`;
}

/**
 * De-duplicate singleton effects
 */
export async function dedupeSingletonEffect(actor, kind, { pick = "first", strict = false, collectOnly = false } = {}) {
  const effects = findEffectsByKind(actor, kind);
  if (effects.length <= 1) return collectOnly ? [] : undefined;

  const toKeep = pick === "last" ? effects[effects.length - 1] : effects[0];
  const toDelete = effects.filter(e => e.id !== toKeep.id).map(e => e.id);
  if (collectOnly) return toDelete;

  if (toDelete.length) {
    try {
      confirmWoundWrite(await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", toDelete), strict, `${kind} duplicate cleanup`);
    } catch (err) {
      if (strict) throw err;
      console.warn(`UESRPG | Failed to dedupe ${kind} effect`, err);
    }
  }
}

/**
 * Ensure "Wounded: Passive" penalty effect exists or is removed based on wound state
 */
export async function ensureWoundedPassiveEffect(actor, { strict = false } = {}) {
  if (!actor) return;
  if (isActorUndead(actor)) {
    const existingEffect = actor.effects?.find((e) => {
      if (e.disabled) return false;
      const group = getEffectGroup(e);
      return group === "wounds.passive";
    });
    if (existingEffect) {
      try {
        confirmWoundWrite(await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [existingEffect.id]), strict, "Undead wound passive cleanup");
      } catch (err) {
        if (strict) throw err;
        console.warn("UESRPG | Failed to remove Wounded: Passive effect for undead", err);
      }
    }
    return;
  }
  
  const state = getWoundState(actor);
  const shouldHaveEffect = state === WOUND_STATES.ACTIVE || state === WOUND_STATES.TREATED;
  
  // Find existing "Wounded: Passive" effect
  const existingEffect = actor.effects?.find((e) => {
    if (e.disabled) return false;
    const group = getEffectGroup(e);
    return group === "wounds.passive";
  });
  
  if (shouldHaveEffect) {
    // Effect should exist - use applyGroupedEffect with override rule
    if (!existingEffect || existingEffect.disabled) {
      const effectData = {
        name: "Wounded: Passive",
        img: "icons/svg/skull.svg",
        disabled: false,
        duration: {},
        changes: [
          buildEffectChange({ key: "system.woundPenalty", type: "override", value: -20, priority: 20 }),
          buildEffectChange({ key: "system.modifiers.initiative.bonus", type: "add", value: -2, priority: 20 })
        ],
        flags: {
          [FLAG_SCOPE]: {
            owner: "system",
            effectGroup: "wounds.passive",
            stackRule: "override",
            source: "wounds"
          }
        }
      };
      
      try {
        confirmWoundWrite(await applyGroupedEffect(actor, effectData), strict, "Wound passive creation");
      } catch (err) {
        if (strict) throw err;
        console.warn("UESRPG | Failed to create Wounded: Passive effect", err);
      }
    }
  } else {
    // Effect should not exist - remove it
    if (existingEffect) {
      try {
        confirmWoundWrite(await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [existingEffect.id]), strict, "Wound passive cleanup");
      } catch (err) {
        if (strict) throw err;
        console.warn("UESRPG | Failed to remove Wounded: Passive effect", err);
      }
    }
  }
}

/**
 * Ensure unconscious effect exists
 */
export async function ensureUnconsciousEffect(actor, { strict = false } = {}) {
  try {
    const has = getEffects(actor).some(e => e?.statuses?.has?.("unconscious") || e?.getFlag?.("core", "statusId") === "unconscious" || e?.name === "Unconscious");
    if (has) return;
    confirmWoundWrite(await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [{
      name: "Unconscious",
      img: "icons/svg/unconscious.svg",
      duration: {},
      statuses: ["unconscious"],
      flags: { core: { statusId: "unconscious" } }
    }]), strict, "Unconscious effect creation");
  } catch (err) {
    if (strict) throw err;
    console.warn("UESRPG | Failed to apply unconscious effect from blood loss", err);
  }
}

/**
 * Enforce wound invariants (cleanup, normalization)
 */
export async function enforceWoundInvariants(actor, { context = "unknown", strict = false, markDirty = false } = {}) {
  if (!actor) return;
  const actorKey = String(actor.uuid ?? "");
  if (!actorKey) return;
  const inFlight = _INVARIANTS_IN_FLIGHT.get(actorKey);
  if (inFlight) {
    if (markDirty) {
      inFlight.dirty = true;
      inFlight.triggers.add(context);
    }
    inFlight.actor = actor;
    return _awaitWoundReconciliation(inFlight, strict);
  }

  const entry = { dirty: false, actor, triggers: new Set([context]), promise: null };
  _INVARIANTS_IN_FLIGHT.set(actorKey, entry);
  entry.promise = Promise.resolve().then(async () => {
    do {
      entry.dirty = false;
      const actor = entry.actor;
      const triggers = Array.from(entry.triggers);
      entry.triggers.clear();
      const pass = entry.pass = (entry.pass ?? 0) + 1;
      const startedAt = isPerfEnabled() ? monoMs() : null;
      const finishActivity = perfTrackDocumentActivity(actor);
      let failed = true;
      try {
        const strict = true;
        await evaluateUntreatedWoundDeadlines(actor, { strict });

        // De-duplicate singleton effects.
        const duplicateIds = [];
        for (const kind of ["forestall", "bloodLoss", "firstAid"]) {
          duplicateIds.push(...await dedupeSingletonEffect(actor, kind, { pick: "last", collectOnly: true }));
        }
        if (duplicateIds.length) {
          confirmWoundWrite(await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", duplicateIds), strict, "Singleton wound cleanup");
        }

        // Normalize treated wound progress.
        const treated = findEffectsByKind(actor, "wound").filter(ef => {
          const wf = getWoundsFlag(ef) ?? {};
          return wf.treated === true;
        });
        const healedIds = [];
        const normalizedUpdates = [];

        for (const ef of treated) {
          const w = getWoundsFlag(ef) ?? {};

          const damage = Number(w.damage ?? 0);
          const progress = Number(w.progress ?? 0);
          const d = Number.isFinite(damage) ? Math.max(0, damage) : 0;
          const p = Number.isFinite(progress) ? Math.max(0, progress) : 0;

          if (d <= 0) continue;

          if (p >= d) {
            healedIds.push(ef.id);
            continue;
          }

          if (p != progress || d != damage) {
            normalizedUpdates.push({ _id: ef.id, [`${FLAG_PATH}.wounds.damage`]: d, [`${FLAG_PATH}.wounds.progress`]: p });
          }
        }
        if (healedIds.length) {
          confirmWoundWrite(await deleteOwnedEffects(actor, healedIds, { reason: "enforceWoundInvariants:deleteHealedWounds" }), strict, "Healed wound cleanup");
        }
        if (normalizedUpdates.length) {
          confirmWoundWrite(await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", normalizedUpdates, { requireUpdated: strict }), strict, "Treated wound normalization");
        }

        const expectedWounded = isDerivedWounded(actor);
        const currentWounded = actor.system?.wounded === true;
        if (currentWounded !== expectedWounded) {
          try {
            confirmWoundWrite(await requestUpdateDocument(actor, { "system.wounded": expectedWounded }), strict, "Wounded mirror reconciliation");
          } catch (err) {
            if (strict) throw err;
            console.warn(`${SYSTEM_ID} | Failed to reconcile system.wounded invariant`, err);
          }
        }

        // Ensure "Wounded: Passive" effect matches current state.
        await ensureWoundedPassiveEffect(actor, { strict });
        failed = false;
      } finally {
        const activity = finishActivity();
        if (startedAt !== null) perfRecord({ event: "wounds.reconcile.pass", actorUuid: actor.uuid,
          trigger: triggers.join(","), passCount: pass, failed, ...activity, durationMs: monoMs() - startedAt });
      }
    } while (entry.dirty);
  }).finally(() => {
    if (_INVARIANTS_IN_FLIGHT.get(actorKey) === entry) _INVARIANTS_IN_FLIGHT.delete(actorKey);
  });
  return _awaitWoundReconciliation(entry, strict);
}


async function _awaitWoundReconciliation(entry, strict) {
  try { return await entry.promise; }
  catch (error) {
    if (strict) throw error;
    if (!entry.reported) {
      entry.reported = true;
      console.warn("UESRPG | Wound reconciliation failed", { actorUuid: entry.actor.uuid, error });
    }
    return undefined;
  }
}

/**
 * Clean up wound state when no wounds remain
 */
export async function cleanupWoundStateIfNoWounds(actor, { strict = false } = {}) {
  if (!actor) return { clearedWounded: false, removedBloodLoss: 0, removedForestall: 0 };
  if (hasAnyWoundEffects(actor)) return { clearedWounded: false, removedBloodLoss: 0, removedForestall: 0 };

  const bloodLoss = findEffectsByKind(actor, "bloodLoss");
  const forestall = findEffectsByKind(actor, "forestall");
  const firstAid = findEffectsByKind(actor, "firstAid");

  const removedBloodLoss = bloodLoss.length;
  const removedForestall = forestall.length;

  const toDelete = [...bloodLoss, ...forestall, ...firstAid];

  if (toDelete.length) {
    confirmWoundWrite(await deleteOwnedEffects(actor, toDelete.map((ef) => ef.id), { reason: "cleanupWoundStateIfNoWounds" }), strict, "Wound state cleanup");
  }

  let clearedWounded = false;
  try {
    if (actor.system?.wounded !== false) {
      confirmWoundWrite(await requestUpdateDocument(actor, { "system.wounded": false }), strict, "Wounded mirror cleanup");
      clearedWounded = true;
    }
  } catch (err) {
    if (strict) throw err;
    console.warn("UESRPG | Failed to clear system.wounded during wound cleanup", err);
  }

  return { clearedWounded, removedBloodLoss, removedForestall };
}

export async function evaluateUntreatedWoundDeadlines(actor, { now = Date.now(), nowWorldTimeSeconds = null, lazyConvert = true, strict = false } = {}) {
  if (!actor) return { converted: 0 };
  const wounds = findEffectsByKind(actor, "wound");
  if (!wounds.length) return { converted: 0 };

  const worldNow = Number.isFinite(Number(nowWorldTimeSeconds))
    ? Number(nowWorldTimeSeconds)
    : getCurrentWorldTimeSeconds();
  const wallNow = Number(now);

  let converted = 0;
  for (const ef of wounds) {
    const w = getWoundsFlag(ef) ?? {};
    if (w.treated === true) continue;
    if (w.maimed === true) continue;

    let deadlineWorld = Number(w.expiresAtForTreatmentWorldTime ?? NaN);
    const deadlineWall = Number(w.expiresAtForTreatment ?? NaN);

    if (!Number.isFinite(deadlineWorld) && Number.isFinite(deadlineWall) && lazyConvert === true) {
      // Legacy fallback: convert remaining real-time delta into world-time delta.
      const remainingSeconds = (deadlineWall - wallNow) / 1000;
      deadlineWorld = worldNow + remainingSeconds;

      const updates = {
        [`${FLAG_PATH}.wounds.expiresAtForTreatmentWorldTime`]: deadlineWorld
      };
      const existingCreatedWorld = Number(w.createdAtWorldTime ?? NaN);
      if (!Number.isFinite(existingCreatedWorld)) {
        const endBonusDays = Math.max(0, Number(w.treatmentDeadlineDays ?? 0) || 0);
        if (endBonusDays > 0) {
          updates[`${FLAG_PATH}.wounds.createdAtWorldTime`] = deadlineWorld - (endBonusDays * 86400);
        } else {
          updates[`${FLAG_PATH}.wounds.createdAtWorldTime`] = worldNow;
        }
      }
      try {
        confirmWoundWrite(await requestUpdateDocument(ef, updates), strict, "Wound deadline conversion");
      } catch (_e) {
        if (strict) throw _e;
        // Non-blocking: proceed with in-memory converted value.
      }
    }

    let expired = false;
    if (Number.isFinite(deadlineWorld)) expired = worldNow >= deadlineWorld;
    else if (Number.isFinite(deadlineWall)) expired = wallNow >= deadlineWall;
    if (!expired) continue;

    const r = await applyMaimedOutcomeForWound(actor, ef, { reason: "untreated-deadline", immediate: false, strict });
    if (r?.applied) converted += 1;
  }
  return { converted };
}

/**
 * Remove shock markers for a wound application
 */
export async function removeShockMarkersForApplication(actor, applicationId, { removeLost = false, strict = false } = {}) {
  if (!actor) return;
  const appId = String(applicationId ?? "").trim();
  if (!appId) return;

  const shockKinds = new Set(SHOCK_KINDS.map((kind) => canonicalizeShockKind(kind)));
  const lostKinds = new Set(["shockLostLimb", "shockLostEar", "shockLostEye"]);

  const toDelete = getEffects(actor).filter((ef) => {
    const wf = getWoundsFlag(ef) ?? {};
    if (String(wf.applicationId ?? "") !== appId) return false;
    const kind = canonicalizeShockKind(wf.kind);
    if (!isShockKind(kind) || !shockKinds.has(kind)) return false;
    if (wf?.permanent === true || wf?.maimed === true) return false;
    if (!removeLost && lostKinds.has(kind)) return false;
    return true;
  });

  if (!toDelete.length) return;

  try {
    confirmWoundWrite(await deleteOwnedEffects(actor, toDelete.map(e => e.id), { reason: "removeShockMarkersForApplication" }), strict, "Wound shock marker cleanup");
  } catch (err) {
    if (strict) throw err;
    console.warn(`${SYSTEM_ID} | Failed to remove shock markers for wound`, { appId, err });
  }
}

/**
 * Activate passive wound state after shock resolution
 */
export async function activateWoundPassiveState(actor, { resetBloodLoss = true } = {}) {
  if (!actor) return;

  // Passive effects begin after Shock Test resolution (Chapter 5: Passive Effects).
  // Mirror flag sync is handled by enforceWoundInvariants().

  // Blood Loss countdown begins at the same moment.
  // Skip if the actor carries the "dead" status condition (token status palette) or is marked
  // Defeated in the combat tracker — starting blood loss on a dead actor produces spurious logs.
  const _deadStatusId = String(CONFIG?.specialStatusEffects?.dead ?? "dead");
  const _defeatedStatusId = String(CONFIG?.specialStatusEffects?.defeated ?? "defeated");
  const _actorStatuses = actor.statuses instanceof Set ? actor.statuses : new Set();
  const _alreadyDead =
    actor.combatant?.defeated === true ||
    _actorStatuses.has(_deadStatusId) ||
    _actorStatuses.has(_defeatedStatusId) ||
    _actorStatuses.has("dead") ||
    _actorStatuses.has("defeated");
  if (resetBloodLoss && !isActorUndeadBloodless(actor) && !_alreadyDead) {
    try {
      const existing = findFirstEffectByKind(actor, "bloodLoss");
      const next = 5;

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
        _debugWounds("Blood loss started", { actor: actor.uuid, remainingRounds: next });
      } else {
        await requestUpdateDocument(existing, {
          name: `Blood Loss (${next})`,
          [`${FLAG_PATH}.wounds.remainingRounds`]: next
        });
        _debugWounds("Blood loss reset", { actor: actor.uuid, remainingRounds: next });
      }
    } catch (err) {
      console.warn("UESRPG | Failed to start/reset Blood Loss after shock resolution", err);
    }
  }
}

/**
 * Tick forestall effect at end of turn
 */
export async function tickForestall(actor, { strict = false } = {}) {
  const ef = findFirstEffectByKind(actor, "forestall");
  if (!ef) return;

  const cur = Math.max(0, toNumber(ef.getFlag(FLAG_SCOPE, "wounds")?.remainingRounds ?? 0, 0));
  if (cur <= 1) {
    try {
      confirmWoundWrite(await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [ef.id]), strict, "Wound tick deletion");
    } catch (_err) {
      if (strict) throw _err;
      // Non-blocking: effect may already be gone.
    }
    return;
  }

  const next = cur - 1;
  try {
    confirmWoundWrite(await requestUpdateDocument(ef, {
      name: `Wound Forestall (${next})`,
      [`${FLAG_PATH}.wounds.remainingRounds`]: next
    }), strict, "Wound countdown update");
  } catch (err) {
      if (strict) throw err;
    console.warn("UESRPG | Wounds | Failed to tick Forestall", err);
  }
}

/**
 * Tick blood loss at end of turn
 */
export async function tickBloodLoss(actor, { strict = false } = {}) {
  if (isActorUndeadBloodless(actor)) {
    const ef = findFirstEffectByKind(actor, "bloodLoss");
    if (ef) {
      try {
        confirmWoundWrite(await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [ef.id]), strict, "Wound tick deletion");
      } catch (_err) {
      if (strict) throw _err;
        // Non-blocking.
      }
    }
    return;
  }
  const ef = findFirstEffectByKind(actor, "bloodLoss");
  if (!ef) return;

  // Defensive invariant: if Blood Loss exists without any Wound effects, delete it.
  if (!hasAnyWoundEffects(actor)) {
    await cleanupWoundStateIfNoWounds(actor, { strict });
    return;
  }

  // Blood loss countdown pauses while wound penalties are suppressed via forestall/first aid/immunity.
  const bloodLossStatus = getBloodLossStatus(actor);
  if (bloodLossStatus.paused) return;

  const cur = Math.max(0, toNumber(ef.getFlag(FLAG_SCOPE, "wounds")?.remainingRounds ?? 0, 0));
  if (cur <= 1) {
    // Blood Loss expires: drop to 0 HP and apply Unconscious (Chapter 5).
    const hp = toNumber(actor.system?.hp?.value ?? 0, 0);

    if (hp > 0) {
      try {
        confirmWoundWrite(await requestUpdateDocument(actor, { "system.hp.value": 0 }), strict, "Blood loss health update");
      } catch (err) {
      if (strict) throw err;
        console.warn("UESRPG | Wounds | Failed to set HP to 0 from Blood Loss", err);
      }
    }

    // Always ensure Unconscious is present when Blood Loss resolves at 0 rounds.
    await ensureUnconsciousEffect(actor, { strict });

    try {
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="uesrpg-chat-card"><div class="header"><b>${esc(actor.name)}</b></div><div>Blood loss: HP dropped to 0.</div></div>`,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
      _debugWounds("Blood loss expired, actor dropped to 0 HP", { actor: actor.uuid });
    } catch (_e) {
      if (strict) throw _e;
      // Non-blocking.
    }

    // Best-effort delete (may already be removed by another cleanup path/module).
    try {
      confirmWoundWrite(await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [ef.id]), strict, "Wound tick deletion");
    } catch (_err) {
      if (strict) throw _err;
      // Non-blocking.
    }

    return;
  }

  const next = cur - 1;
  confirmWoundWrite(await requestUpdateDocument(ef, {
    name: `Blood Loss (${next})`,
    [`${FLAG_PATH}.wounds.remainingRounds`]: next
  }), strict, "Blood loss countdown");
}

/**
 * Tick shock markers (e.g., stun countdown)
 */
export async function tickShockMarkers(actor, { strict = false } = {}) {
  if (!actor) return;

  // Only the 1-round Stun marker has a deterministic countdown.
  const toDelete = [];
  const updates = [];
  for (const ef of findEffectsByKind(actor, "shockStunned")) {
    const data = ef.getFlag(FLAG_SCOPE, "wounds") ?? {};
    const cur = Math.max(0, toNumber(data.remainingTurns ?? 0, 0));
    if (cur <= 1) {
      toDelete.push(ef.id);
      continue;
    }
    const next = cur - 1;
    updates.push({ _id: ef.id, [`${FLAG_PATH}.wounds.remainingTurns`]: next, name: "Stunned (Shock)" });
  }

  if (toDelete.length) {
    try {
      confirmWoundWrite(await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", toDelete), strict, "Shock marker deletion");
    } catch (err) {
      if (strict) throw err;
      console.warn("UESRPG | Failed to delete expired shockStunned markers", err);
      for (const id of toDelete) {
        try {
          await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [id]);
        } catch (_fallbackErr) {
          if (strict) throw _fallbackErr;
        }
      }
    }
  }
  if (updates.length) {
    try {
      const ok = await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", updates, { requireUpdated: strict });
      confirmWoundWrite(ok, strict, "Shock marker countdown");
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
      if (strict) throw err;
      console.warn("UESRPG | Failed to tick shockStunned markers", err);
      for (const update of updates) {
        const live = actor.effects?.get?.(String(update._id)) ?? null;
        if (!live) continue;
        const fallback = { ...update };
        delete fallback._id;
        try {
          await requestUpdateDocument(live, fallback);
        } catch (_fallbackErr) {
          if (strict) throw _fallbackErr;
        }
      }
    }
  }
}

/**
 * Apply healing forestall effect
 */
export async function applyHealingForestall(actor, effectiveHealed, { strict = false } = {}) {
  const add = Math.max(0, toNumber(effectiveHealed, 0));
  if (add <= 0) return;

  const existing = findFirstEffectByKind(actor, "forestall");
  if (!existing) {
    const ef = makeEffect({
      name: `Wound Forestall (${add})`,
      img: "icons/svg/regen.svg",
      flags: {
        wounds: {
          kind: "forestall",
          remainingRounds: add,
          suppressWoundPenalty: true
        }
      }
    });
    confirmWoundWrite(await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [ef]), strict, "Healing forestall creation");
    return;
  }

  const cur = Math.max(0, toNumber(existing.getFlag(FLAG_SCOPE, "wounds")?.remainingRounds ?? 0, 0));
  const next = cur + add;
  const updated = await requestUpdateDocument(existing, {
    name: `Wound Forestall (${next})`,
    [`${FLAG_PATH}.wounds.remainingRounds`]: next
  });
  confirmWoundWrite(updated, strict, "Healing forestall update");
}

/**
 * Advance healing progress for treated wounds
 */
export async function advanceTreatedWoundHealing(actor, effectiveHealed, { strict = false } = {}) {
  const heal = Math.max(0, toNumber(effectiveHealed, 0));
  if (heal <= 0) return;

  const wounds = findEffectsByKind(actor, "wound");
  const woundIdsToDelete = [];
  const woundUpdates = [];
  const shockApplicationIds = [];
  for (const ef of wounds) {
    const w = ef.getFlag(FLAG_SCOPE, "wounds") ?? {};
    if (w.treated !== true) continue;

    const damage = Math.max(0, toNumber(w.damage, 0));
    if (damage <= 0) continue;

    const progress = Math.max(0, toNumber(w.progress, 0));
    const next = progress + heal;

    if (next >= damage) {
      const appId = String(w.applicationId ?? "").trim();
      woundIdsToDelete.push(ef.id);

      // Chapter 5: once the wound is cured, remove wound-related Shock markers (except lost limbs/eyes/ears).
      if (appId) {
        shockApplicationIds.push(appId);
      }
      continue;
    }

    woundUpdates.push({ _id: ef.id, [`${FLAG_PATH}.wounds.progress`]: next });
  }

  if (woundIdsToDelete.length) {
    confirmWoundWrite(await deleteOwnedEffects(actor, woundIdsToDelete, { reason: "advanceTreatedWoundHealing" }), strict, "Healed wound deletion");
  }
  if (woundUpdates.length) {
    let batchUpdated = false;
    try {
      batchUpdated = await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", woundUpdates, { requireUpdated: strict });
    } catch (err) {
      console.warn("UESRPG | Failed to batch update treated wound healing", err);
    }
    if (!batchUpdated) {
      let allUpdated = true;
      for (const update of woundUpdates) {
        const live = actor.effects?.get?.(String(update._id)) ?? null;
        if (!live) { allUpdated = false; continue; }
        const fallback = { ...update };
        delete fallback._id;
        try {
          if (!await requestUpdateDocument(live, fallback)) allUpdated = false;
        } catch (_fallbackErr) { allUpdated = false; }
      }
      confirmWoundWrite(allUpdated, strict, "Treated wound healing progress");
    }
  }
  for (const appId of shockApplicationIds) {
    await removeShockMarkersForApplication(actor, appId, { removeLost: false, strict });
  }

  // Defensive invariant: when wounds are fully healed, remove any lingering blood loss / forestall.
  if (!hasAnyWoundEffects(actor)) {
    await cleanupWoundStateIfNoWounds(actor, { strict });
  }
  await enforceWoundInvariants(actor, { context: "advanceTreatedWoundHealing", strict });
}

/**
 * Resolve shock test from chat card
 */
export async function resolveShockTestFromChat(...args) {
  // Backward-compatible signature
  const params = (args.length >= 2 && args[1] && typeof args[1] === "object")
    ? args[1]
    : (args[0] && typeof args[0] === "object" ? args[0] : {});

  const { actorUuid, woundEffectId, action, messageId } = params;
  if (String(action ?? "") !== "shock-roll") return;
  if (!actorUuid || !woundEffectId) return;

  if (!isActiveGMUser(game.user)) {
    requestWoundsGM("resolveShock", {
      actorUuid: String(actorUuid),
      data: { woundEffectId: String(woundEffectId), action: String(action ?? "") }
    });
    return;
  }

  const inflightKey = `${actorUuid}:${woundEffectId}`;
  if (_SHOCK_IN_FLIGHT.has(inflightKey)) return;
  _SHOCK_IN_FLIGHT.add(inflightKey);
  const resolver = createUuidResolver();

  let woundEf = null;
  let resolvingSet = false;
  let shockCardState = { resolving: false, resolved: false };

  try {
    const actor = await resolver.resolve(String(actorUuid));
    if (!actor) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.Shock.ActorNotFound"));
      return;
    }

    woundEf = actor.effects?.get?.(String(woundEffectId)) ?? null;
    if (!woundEf) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.Shock.WoundEffectNotFound"));
      return;
    }

    const w = woundEf.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
    if (w.shockResolved === true) {
      ui.notifications?.info?.(t("UESRPG.Notifications.Shock.AlreadyResolved"));
      return;
    }

    if (w.shockResolving === true) {
      ui.notifications?.info?.(t("UESRPG.Notifications.Shock.AlreadyResolving"));
      return;
    }

    const hitLocation = normalizeHitLocation(w.hitLocation ?? "Body");
    const endTN = Number(actor.system?.characteristics?.end?.total ?? 0) || 0;
    if (endTN <= 0) {
      ui.notifications?.warn?.(t("UESRPG.Notifications.Shock.InvalidEnduranceTN"));
      return;
    }

    const shockMessageId = String(messageId ?? "").trim();
    const shockMessage = shockMessageId ? (game.messages?.get(shockMessageId) ?? null) : null;
    const updateShockCard = async (patch = {}) => {
      if (!shockMessage) return;
      const messageFlags = shockMessage.flags?.[FLAG_SCOPE]?.wounds ?? {};
      const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);
      const nextIsSuccess = has("isSuccess")
        ? patch.isSuccess
        : has("passed")
          ? patch.passed
          : (messageFlags.isSuccess ?? messageFlags.passed ?? null);
      const nextState = {
        actor,
        woundEffectId,
        hitLocationLabel: w.hitLocation ?? "Body",
        endTN,
        finalTN: has("finalTN") ? patch.finalTN : (messageFlags.finalTN ?? null),
        rollTotal: has("rollTotal") ? patch.rollTotal : (messageFlags.rollTotal ?? null),
        isSuccess: nextIsSuccess,
        isCriticalSuccess: has("isCriticalSuccess")
          ? patch.isCriticalSuccess
          : (messageFlags.isCriticalSuccess ?? null),
        isCriticalFailure: has("isCriticalFailure")
          ? patch.isCriticalFailure
          : (messageFlags.isCriticalFailure ?? null),
        passed: nextIsSuccess,
        dieHardRerolled: has("dieHardRerolled")
          ? patch.dieHardRerolled === true
          : messageFlags.dieHardRerolled === true,
        failNote: has("failNote") ? patch.failNote : (messageFlags.failNote ?? null),
        magicNote: has("magicNote") ? patch.magicNote : (messageFlags.magicNote ?? null),
        resolving: has("resolving") ? patch.resolving === true : messageFlags.resolving === true,
        resolved: has("resolved") ? patch.resolved === true : messageFlags.resolved === true
      };
      await requestUpdateChatMessage(shockMessage, {
        content: _renderShockTestCard(nextState),
        [`flags.${FLAG_SCOPE}.wounds.resolving`]: nextState.resolving,
        [`flags.${FLAG_SCOPE}.wounds.resolved`]: nextState.resolved,
        [`flags.${FLAG_SCOPE}.wounds.endTN`]: endTN,
        [`flags.${FLAG_SCOPE}.wounds.finalTN`]: nextState.finalTN,
        [`flags.${FLAG_SCOPE}.wounds.rollTotal`]: nextState.rollTotal,
        [`flags.${FLAG_SCOPE}.wounds.isSuccess`]: nextState.isSuccess,
        [`flags.${FLAG_SCOPE}.wounds.isCriticalSuccess`]: nextState.isCriticalSuccess,
        [`flags.${FLAG_SCOPE}.wounds.isCriticalFailure`]: nextState.isCriticalFailure,
        [`flags.${FLAG_SCOPE}.wounds.passed`]: nextState.passed,
        [`flags.${FLAG_SCOPE}.wounds.dieHardRerolled`]: nextState.dieHardRerolled,
        [`flags.${FLAG_SCOPE}.wounds.failNote`]: nextState.failNote,
        [`flags.${FLAG_SCOPE}.wounds.magicNote`]: nextState.magicNote,
      });
      shockCardState = { resolving: nextState.resolving, resolved: nextState.resolved };
    };

    try {
      await requestUpdateDocument(woundEf, {
        [`${FLAG_PATH}.wounds.shockResolving`]: true,
        [`${FLAG_PATH}.wounds.shockResolvingAt`]: Date.now()
      });
      resolvingSet = true;
    } catch (_e) {
      // Non-blocking.
    }
    await updateShockCard({ resolving: true });

    const rollOptions = await _promptShockRollOptions(actor, endTN);
    if (!rollOptions) {
      await updateShockCard({ resolving: false, resolved: false });
      return;
    }
    const rollTn = rollOptions.target;

    let test = await doTestRoll(actor, { target: rollTn, rollFormula: "1d100" });
    _showShockRoll3d(test?.roll ?? null, actor, shockMessage);
    let passed = !!test?.isSuccess;
    let dieHardRerolled = false;

    // Die-Hard (Chapter 4): may reroll failed Endurance tests to resist the shock effects of a wound, once per test.
    try {
      const hasDieHard = hasTalent(actor, "diehard");
      const dieHardUsed = (w?.dieHardUsed === true);
      if (hasDieHard && !dieHardUsed && !passed) {
        const wants = await customDialog({
          layout: "workflow",
          title: t("UESRPG.Dialogs.ShockTest.DieHardTitle"),
          content: `${renderTNSummary("Shock Test")}<p>${tf("UESRPG.Dialogs.ShockTest.DieHardContent", { actor: esc(actor.name ?? "Actor") })}</p>`,
          render: (_event, dialog) => bindTNEstimates(dialog.element, () => ({ finalTN: rollTn })),
          buttons: {
            reroll: { label: t("UESRPG.Dialogs.ShockTest.DieHardReroll"), callback: () => true },
            keep: { label: t("UESRPG.Dialogs.ShockTest.DieHardKeepFailure"), callback: () => false }
          },
          default: "reroll"
        });

        if (wants === true) {
          dieHardRerolled = true;
          // Persist the usage marker on the wound effect so concurrent clients cannot double-reroll.
          try {
            await requestUpdateDocument(woundEf, {
              [`${FLAG_PATH}.wounds.dieHardUsed`]: true,
              [`${FLAG_PATH}.wounds.dieHardUsedAt`]: Date.now()
            });
          } catch (_e) {
            // Non-blocking.
          }
          test = await doTestRoll(actor, { target: rollTn, rollFormula: "1d100" });
          _showShockRoll3d(test?.roll ?? null, actor, shockMessage);
          passed = !!test?.isSuccess;
        }
      }
    } catch (_e) {
      // Non-blocking.
    }

    let failNote = null;
    if (!passed) {
      const r = await applyShockFailConsequence(actor, { hitLocation, applicationId: w.applicationId ?? null });
      failNote = r?.note ?? null;
    }

    let magicNote = null;
    const damageAppliedByType = w.damageAppliedByType ?? null;
    const dom = computeDominantMagicType(damageAppliedByType);
    if (dom?.candidates?.length) {
      let chosen = dom.chosen;

      if (!chosen && dom.candidates.length > 1) {
        const buttons = {};
        for (const c of dom.candidates) {
          buttons[c] = { label: c.toUpperCase(), callback: () => c };
        }
        chosen = await customDialog({
          layout: "workflow",
          title: t("UESRPG.Dialogs.ShockTest.MagicShockSideEffectTitle"),
          content: `<p>${t("UESRPG.Dialogs.ShockTest.MagicShockSideEffectContent")}</p>`,
          buttons,
          default: dom.candidates[0]
        });
      }

      const mr = await applyShockMagicSideEffect(actor, { chosenType: chosen, damageAppliedByType });
      magicNote = mr?.note ?? null;
    }

    // Activate passive wound effects (Chapter 5: Passive Effects) now that Shock is resolved.
    await activateWoundPassiveState(actor, { resetBloodLoss: true });

    // Mark resolved on the wound effect to prevent double application.
    try {
      await requestUpdateDocument(woundEf, {
        [`${FLAG_PATH}.wounds.shockResolved`]: true,
        [`${FLAG_PATH}.wounds.shockResolvedAt`]: Date.now(),
        [`${FLAG_PATH}.wounds.shockPassed`]: passed,
        [`${FLAG_PATH}.wounds.shockFailed`]: passed ? false : true,
        [`${FLAG_PATH}.wounds.shockResolving`]: false
      });
      resolvingSet = false;
    } catch (_e) {
      // Non-blocking.
    }

    await updateShockCard({
      finalTN: rollTn,
      rollTotal: Number(test?.roll?.total ?? test?.total ?? 0) || 0,
      isSuccess: passed,
      isCriticalSuccess: test?.isCriticalSuccess === true,
      isCriticalFailure: test?.isCriticalFailure === true,
      passed,
      dieHardRerolled,
      failNote,
      magicNote,
      resolving: false,
      resolved: true
    });
  } finally {
    _SHOCK_IN_FLIGHT.delete(inflightKey);
    if (resolvingSet && woundEf) {
      try {
        await requestUpdateDocument(woundEf, {
          [`${FLAG_PATH}.wounds.shockResolving`]: false
        });
      } catch (_e) {
        // Non-blocking.
      }
    }
    if (shockCardState.resolving && !shockCardState.resolved) {
      try {
        const actor = actorUuid ? await resolver.resolve(String(actorUuid)) : null;
        if (actor) {
          const wound = actor.effects?.get?.(String(woundEffectId)) ?? null;
          const woundFlags = wound?.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
          const baseEndTn = Number(actor.system?.characteristics?.end?.total ?? 0) || 0;
          const shockMessage = messageId ? (game.messages?.get(String(messageId)) ?? null) : null;
          if (shockMessage) {
            await requestUpdateChatMessage(shockMessage, {
              content: _renderShockTestCard({
                actor,
                woundEffectId,
                hitLocationLabel: woundFlags.hitLocation ?? "Body",
                endTN: baseEndTn,
                resolving: false,
                resolved: false
              }),
              [`flags.${FLAG_SCOPE}.wounds.resolving`]: false,
            });
          }
        }
      } catch (_e) {
        // Non-blocking.
      }
    }
  }
}
