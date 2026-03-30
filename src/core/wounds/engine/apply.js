/**
 * src/core/wounds/engine/apply.js
 *
 * Document mutation orchestration for wound engine.
 * All functions that update actors, create/delete effects, etc.
 */

import { doTestRoll, formatResultOutcomeLabel } from "../../../utils/degree-roll-helper.js";
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments, requestUpdateChatMessage, requestUpdateDocument, requestUpdateEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { createSeverityDebugLogger } from "../../../utils/debug.js";
import { createUuidResolver } from "../../../utils/uuid-cache.js";
import { isActorUndead, isActorUndeadBloodless } from "../../traits/trait-registry.js";
import { hasTalent } from "../../traits/talents-api.js";
import { applyGroupedEffect, getEffectGroup } from "../../../utils/ae-helpers.js";
import { normalizeHitLocation, isActiveGMUser, normalizeDamageTypeKey, canonicalizeShockKind, isShockKind, SHOCK_KINDS } from "../wound-schema.js";
import { requestWoundsGM } from "../wound-socket.js";
import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { SYSTEM_ID, FLAG_SCOPE } from "../../constants.js";
import { SKILL_DIFFICULTIES } from "../../skills/skill-tn.js";
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

const FLAG_PATH = `flags.${FLAG_SCOPE}`;
const _SHOCK_IN_FLIGHT = new Set();
const _INVARIANTS_IN_FLIGHT = new Map();
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const _debugWounds = createSeverityDebugLogger("woundsDebug", "[UESRPG][Wounds]", "debug");

async function _promptShockRollOptions(actor, baseTn) {
  const content = `
    <div class="uesrpg-skill-roll">
      <div class="form-group">
        <label><b>Base TN (END)</b></label>
        <input type="number" value="${Number(baseTn) || 0}" disabled style="width:100%;" />
      </div>
      <div class="form-group" style="margin-top:8px;">
        <label><b>Difficulty</b></label>
        <select name="difficultyKey" style="width:100%;">${buildDifficultyOptionsHtml("average")}</select>
      </div>
      <div class="form-group" style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <label style="margin:0;"><b>Manual Modifier</b></label>
        <input name="manualMod" type="number" value="0" style="width:120px;" />
      </div>
    </div>
  `;
  const picked = await customDialog({
    title: `Shock Test - ${esc(actor?.name ?? "Actor")} Roll Options`,
    content,
    buttons: {
      roll: {
        label: "Roll",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const difficultyKey = String(root?.querySelector('select[name="difficultyKey"]')?.value ?? "average");
          const manualMod = Number.parseInt(String(root?.querySelector('input[name="manualMod"]')?.value ?? "0"), 10) || 0;
          return { difficultyKey, manualMod };
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    default: "roll",
    width: 420
  });
  if (!picked) return null;
  const diff = SKILL_DIFFICULTIES.find((d) => d.key === String(picked.difficultyKey ?? "average"))
    ?? SKILL_DIFFICULTIES.find((d) => d.key === "average");
  const finalTn = Math.max(0, (Number(baseTn) || 0) + (Number(diff?.mod ?? 0) || 0) + (Number(picked.manualMod ?? 0) || 0));
  return {
    difficulty: diff,
    manualMod: Number(picked.manualMod ?? 0) || 0,
    target: finalTn
  };
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

async function _upsertShockMarker(actor, { applicationId = "", kind = "", hitLocation = null, name = "Marker", img = "icons/svg/skull.svg", changes = [], extraWoundFlags = {} } = {}) {
  if (!actor) return null;
  const appId = String(applicationId ?? "").trim();
  const canonicalKind = canonicalizeShockKind(kind);
  if (!canonicalKind) return null;
  if (appId) {
    const existing = _findShockMarker(actor, { applicationId: appId, kind: canonicalKind, hitLocation });
    if (existing) return existing;
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
    changes: Array.isArray(changes) ? changes : [],
    flags: { [FLAG_SCOPE]: { wounds: woundFlags } }
  }]);
  const created = Array.isArray(docs) ? (docs[0] ?? null) : null;
  if (created) await _applyPersistentConditionForLostMarker(actor, { kind: canonicalKind, hitLocation });
  return created;
}

function _lostKindForLocation(loc) {
  const key = String(loc?.key ?? "").toLowerCase();
  if (key.includes("eye")) return "shockLostEye";
  if (key.includes("ear")) return "shockLostEar";
  return "shockLostLimb";
}

async function _applyPersistentConditionForLostMarker(actor, { kind = "", hitLocation = "" } = {}) {
  const api = game?.uesrpg?.conditions;
  if (!api?.setConditionValue) return;

  const effects = getEffects(actor);
  const countKind = (k) => effects.filter((ef) => canonicalizeShockKind(getWoundsFlag(ef)?.kind) === k).length;

  if (kind === "shockLostEye") {
    if (countKind("shockLostEye") >= 2) await api.setConditionValue(actor, "blinded", 1);
    return;
  }
  if (kind === "shockLostEar") {
    if (countKind("shockLostEar") >= 2) await api.setConditionValue(actor, "deafened", 1);
    return;
  }
  if (kind !== "shockLostLimb") return;

  const label = String(hitLocation ?? "").toLowerCase();
  const isLegLike = label.includes("leg") || label.includes("foot");
  if (!isLegLike) return;

  await api.setConditionValue(actor, "slowed", 1);
  const legLossCount = effects.filter((ef) => {
    const wf = getWoundsFlag(ef) ?? {};
    if (canonicalizeShockKind(wf?.kind) !== "shockLostLimb") return false;
    const loc = String(wf?.hitLocation ?? "").toLowerCase();
    return loc.includes("leg") || loc.includes("foot");
  }).length;
  if (legLossCount >= 2) await api.setConditionValue(actor, "immobilized", 1);
}

export async function applyMaimedOutcomeForWound(actor, woundEffect, { reason = "maimed", immediate = false } = {}) {
  if (!actor || !woundEffect) return { applied: false, reason: "invalid" };
  const w = getWoundsFlag(woundEffect) ?? {};
  const appId = String(w?.applicationId ?? woundEffect?.id ?? "").trim();
  if (!appId) return { applied: false, reason: "missingAppId" };

  const loc = normalizeHitLocation(w?.hitLocation ?? "Body");
  const label = loc?.label ?? "Body";
  const region = loc?.region ?? "body";
  const now = Date.now();

  if (region === "head") {
    await _upsertShockMarker(actor, {
      applicationId: appId,
      kind: "shockLostEye",
      hitLocation: label,
      name: `Lost Eye (${label})`,
      img: "icons/svg/eye.svg",
      extraWoundFlags: { permanent: true, maimed: true, maimedAt: now, maimedReason: reason, immediate: immediate === true }
    });
  } else if (region === "limb") {
    await _upsertShockMarker(actor, {
      applicationId: appId,
      kind: _lostKindForLocation(loc),
      hitLocation: label,
      name: `Lost Limb (${label})`,
      img: "icons/svg/skull.svg",
      extraWoundFlags: { permanent: true, maimed: true, maimedAt: now, maimedReason: reason, immediate: immediate === true }
    });
  } else {
    await _upsertShockMarker(actor, {
      applicationId: appId,
      kind: "shockCrippleBody",
      hitLocation: label,
      name: `Maimed Body (${label})`,
      img: "icons/svg/skull.svg",
      changes: [
        { key: "system.stamina.max", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -1, priority: 20 },
        { key: "system.wound_threshold.value", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -1, priority: 20 }
      ],
      extraWoundFlags: { permanent: true, maimed: true, maimedAt: now, maimedReason: reason, immediate: immediate === true }
    });
  }

  try {
    await requestUpdateDocument(woundEffect, {
      [`${FLAG_PATH}.wounds.maimed`]: true,
      [`${FLAG_PATH}.wounds.maimedAt`]: now,
      [`${FLAG_PATH}.wounds.maimedReason`]: String(reason ?? "maimed")
    });
  } catch (_e) {
    // Non-blocking.
  }
  return { applied: true, reason };
}


/**
 * Apply unconditional shock effects (immediate, not test-gated)
 */
export async function applyShockUnconditional(actor, { hitLocation, applicationId } = {}) {
  if (!actor) return;

  const loc = hitLocation ?? normalizeHitLocation("Body");
  const region = loc?.region ?? "body";
  const hitLocationLabel = loc?.label ?? "Body";
  const hitLocationKey = loc?.key ?? "body";

  // Per Chapter 5, these effects apply when the wound is inflicted (regardless of Shock test result).
  if (region === "body") {
    const cur = Number(actor.system?.action_points?.value ?? 0) || 0;
    if (cur > 0) {
      await requestUpdateDocument(actor, { "system.action_points.value": Math.max(0, cur - 1) });
    } else {
      const debtRaw = Number(actor.getFlag(FLAG_SCOPE, "wounds.apDebtNextRefresh") ?? 0);
      const debt = Number.isFinite(debtRaw) ? debtRaw : 0;
      await requestUpdateDocument(actor, { [`${FLAG_PATH}.wounds.apDebtNextRefresh`]: debt + 1 });
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
      img: "icons/svg/bones.svg"
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
      extraWoundFlags: { remainingTurns: 1 }
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
        name: `Crippled Body (${hitLocationLabel ?? "Body"})`,
        img: "icons/svg/skull.svg"
      });
    }

    const cur = Number(actor.system?.action_points?.value ?? 0) || 0;
    if (cur > 0) {
      await requestUpdateDocument(actor, { "system.action_points.value": Math.max(0, cur - 1) });
      return { note: "Lost AP (1), Crippled Body" };
    }

    const debtRaw = Number(actor.getFlag(FLAG_SCOPE, "wounds.apDebtNextRefresh") ?? 0);
    const debt = Number.isFinite(debtRaw) ? debtRaw : 0;
    await requestUpdateDocument(actor, { [`${FLAG_PATH}.wounds.apDebtNextRefresh`]: debt + 1 });
    return { note: "AP Debt (1), Crippled Body" };
  }

  if (region === "limb") {
    await _upsertShockMarker(actor, {
      applicationId: appId,
      kind: "shockLostLimb",
      hitLocation: hitLocationLabel,
      name: `Lost Limb (${hitLocationLabel})`,
      img: "icons/svg/skull.svg"
    });
    return { note: "Lost Limb" };
  }

  if (region === "head") {
    const choice = await customDialog({
      title: "Head Wound: Lost Sense",
      content: `<p>Failed Shock test on a head wound. Choose which sense is lost (permanently).</p>`,
      buttons: {
        ear: { label: "Ear", callback: () => "ear" },
        eye: { label: "Eye", callback: () => "eye" }
      },
      default: "eye"
    });

    if (choice === "ear") {
      await _upsertShockMarker(actor, {
        applicationId: appId,
        kind: "shockLostEar",
        hitLocation: hitLocationLabel ?? "Head",
        name: `Lost Ear (${hitLocationLabel ?? "Head"})`,
        img: "icons/svg/skull.svg"
      });
      return { note: "Lost Ear" };
    }

    await _upsertShockMarker(actor, {
      applicationId: appId,
      kind: "shockLostEye",
      hitLocation: hitLocationLabel ?? "Head",
      name: `Lost Eye (${hitLocationLabel ?? "Head"})`,
      img: "icons/svg/eye.svg"
    });
    return { note: "Lost Eye" };
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
    return { note: loss > 0 ? `Lost Magicka (${loss})` : "Lost Magicka" };
  }

  if (type === "magic" || type === "frost" || type === "poison") {
    const cur = Number(actor.system?.stamina?.value ?? 0) || 0;
    await requestUpdateDocument(actor, { "system.stamina.value": Math.max(0, cur - 1) });
    return { note: "Lost Stamina (1)" };
  }

  if (type === "fire") {
    // Chapter 5: choose STR or AGI to avoid Burning(1).
    const choose = await customDialog({
      title: "Fire Wound: Avoid Burning",
      content: `<p>This wound includes fire damage. Choose a Strength or Agility test to avoid gaining Burning (1).</p>`,
      buttons: {
        str: { label: "Roll STR", callback: () => "str" },
        agi: { label: "Roll AGI", callback: () => "agi" }
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
        flavor: `Fire Wound — ${actor.name} rolls ${key.toUpperCase()} to avoid Burning (1)`,
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
      return { note: "Burning (1)" };
    }

    return { note: "Avoided Burning" };
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

async function _showShockRoll3d(roll) {
  if (!roll) return;
  const dsn = game?.dice3d;
  if (!dsn || typeof dsn.showForRoll !== "function") return;
  try {
    await dsn.showForRoll(roll, game.user, true);
  } catch (_err) {
    try {
      await dsn.showForRoll(roll);
    } catch (_err2) {
      // no-op
    }
  }
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
  const pendingRows = `
    <div style="display:grid; grid-template-columns:auto 1fr; gap:6px 10px; align-items:start;">
      <div><strong>Target:</strong></div><div>${actorName}</div>
      <div><strong>Location:</strong></div><div>${safeHitLocationLabel}</div>
      ${resolving ? `<div><strong>Status:</strong></div><div>Resolving...</div>` : ``}
    </div>`;

  const resolvedRows = `
    <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px 12px; align-items:start;">
      <div><strong>Target:</strong> ${actorName}</div>
      <div><strong>Location:</strong> ${safeHitLocationLabel}</div>
      ${hasFinalTn ? `<div><strong>TN:</strong> ${Number(finalTN)}</div>` : ``}
      ${hasRollTotal ? `<div><strong>Roll:</strong> ${Number(rollTotal)}</div>` : ``}
      <div><strong>Result:</strong> ${formatResultOutcomeLabel({ isSuccess: outcomeSuccess, isCriticalSuccess, isCriticalFailure })}</div>
      ${dieHardRerolled ? `<div><strong>Die-Hard:</strong> Reroll used</div>` : ``}
      ${failNote ? `<div style="grid-column:1 / -1; display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 10px; align-items:start;"><strong>Consequence:</strong><span style="overflow-wrap:anywhere;">${esc(failNote)}</span></div>` : ``}
      ${magicNote ? `<div style="grid-column:1 / -1; display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 10px; align-items:start;"><strong>Magic:</strong><span style="overflow-wrap:anywhere;">${esc(magicNote)}</span></div>` : ``}
    </div>`;

  return `
  <div class="uesrpg-chat-card" data-card="shock">
    <header class="card-header">
      <h3>${resolved ? "Shock Result" : "Shock Test"}</h3>
    </header>
    <div class="card-content">
      ${resolved ? resolvedRows : pendingRows}
    </div>
    ${resolved ? "" : `<footer class="card-footer">
      <button type="button" data-ues-shock-action="shock-roll" data-actor-uuid="${actorUuid}" data-wound-effect-id="${safeWoundEffectId}" ${resolving ? "disabled" : ""}>${resolving ? "Resolving..." : "Roll Shock (END)"}</button>
    </footer>`}
  </div>`;
}

/**
 * De-duplicate singleton effects
 */
export async function dedupeSingletonEffect(actor, kind, { pick = "first" } = {}) {
  const effects = findEffectsByKind(actor, kind);
  if (effects.length <= 1) return;

  const toKeep = pick === "last" ? effects[effects.length - 1] : effects[0];
  const toDelete = effects.filter(e => e.id !== toKeep.id).map(e => e.id);

  if (toDelete.length) {
    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", toDelete);
    } catch (err) {
      console.warn(`UESRPG | Failed to dedupe ${kind} effect`, err);
    }
  }
}

/**
 * Ensure "Wounded: Passive" penalty effect exists or is removed based on wound state
 */
export async function ensureWoundedPassiveEffect(actor) {
  if (!actor) return;
  if (isActorUndead(actor)) {
    const existingEffect = actor.effects?.find((e) => {
      if (e.disabled) return false;
      const group = getEffectGroup(e);
      return group === "wounds.passive";
    });
    if (existingEffect) {
      try {
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [existingEffect.id]);
      } catch (err) {
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
          { key: "system.woundPenalty", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: -20, priority: 20 },
          { key: "system.modifiers.initiative.bonus", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -2, priority: 20 }
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
        await applyGroupedEffect(actor, effectData);
      } catch (err) {
        console.warn("UESRPG | Failed to create Wounded: Passive effect", err);
      }
    }
  } else {
    // Effect should not exist - remove it
    if (existingEffect) {
      try {
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [existingEffect.id]);
      } catch (err) {
        console.warn("UESRPG | Failed to remove Wounded: Passive effect", err);
      }
    }
  }
}

/**
 * Ensure unconscious effect exists
 */
export async function ensureUnconsciousEffect(actor) {
  try {
    const has = getEffects(actor).some(e => e?.statuses?.has?.("unconscious") || e?.getFlag?.("core", "statusId") === "unconscious" || e?.name === "Unconscious");
    if (has) return;
    await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [{
      name: "Unconscious",
      img: "icons/svg/unconscious.svg",
      duration: {},
      statuses: ["unconscious"],
      flags: { core: { statusId: "unconscious" } }
    }]);
  } catch (err) {
    console.warn("UESRPG | Failed to apply unconscious effect from blood loss", err);
  }
}

/**
 * Enforce wound invariants (cleanup, normalization)
 */
export async function enforceWoundInvariants(actor, { context = "unknown" } = {}) {
  if (!actor) return;
  const actorKey = String(actor.uuid ?? actor.id ?? "");
  if (!actorKey) return;
  const inFlight = _INVARIANTS_IN_FLIGHT.get(actorKey);
  if (inFlight) return inFlight;

  const run = (async () => {
    await evaluateUntreatedWoundDeadlines(actor);

    // De-duplicate singleton effects.
    await dedupeSingletonEffect(actor, "forestall", { pick: "last" });
    await dedupeSingletonEffect(actor, "bloodLoss", { pick: "last" });
    await dedupeSingletonEffect(actor, "firstAid", { pick: "last" });

    // Normalize treated wound progress.
    const treated = findEffectsByKind(actor, "wound").filter(ef => {
      const wf = getWoundsFlag(ef) ?? {};
      return wf.treated === true;
    });

    for (const ef of treated) {
      const w = getWoundsFlag(ef) ?? {};

      const damage = Number(w.damage ?? 0);
      const progress = Number(w.progress ?? 0);
      const d = Number.isFinite(damage) ? Math.max(0, damage) : 0;
      const p = Number.isFinite(progress) ? Math.max(0, progress) : 0;

      if (d <= 0) continue;

      if (p >= d) {
        try {
          await deleteOwnedEffects(actor, [ef.id], { reason: "enforceWoundInvariants:deleteHealedWounds" });
        } catch (err) {
          console.warn(`${SYSTEM_ID} | Failed to delete fully healed wound effect`, err);
        }
        continue;
      }

      if (p != progress || d != damage) {
        try {
          await requestUpdateDocument(ef, { [`${FLAG_PATH}.wounds.damage`]: d, [`${FLAG_PATH}.wounds.progress`]: p });
        } catch (err) {
          console.warn(`${SYSTEM_ID} | Failed to normalize treated wound progress`, err);
        }
      }
    }

    const expectedWounded = isDerivedWounded(actor);
    const currentWounded = actor.system?.wounded === true;
    if (currentWounded !== expectedWounded) {
      try {
        await requestUpdateDocument(actor, { "system.wounded": expectedWounded });
      } catch (err) {
        console.warn(`${SYSTEM_ID} | Failed to reconcile system.wounded invariant`, err);
      }
    }

    // Ensure "Wounded: Passive" effect matches current state.
    await ensureWoundedPassiveEffect(actor);
  })();

  _INVARIANTS_IN_FLIGHT.set(actorKey, run);
  try {
    return await run;
  } finally {
    _INVARIANTS_IN_FLIGHT.delete(actorKey);
  }
}

/**
 * Clean up wound state when no wounds remain
 */
export async function cleanupWoundStateIfNoWounds(actor) {
  if (!actor) return { clearedWounded: false, removedBloodLoss: 0, removedForestall: 0 };
  if (hasAnyWoundEffects(actor)) return { clearedWounded: false, removedBloodLoss: 0, removedForestall: 0 };

  const bloodLoss = findEffectsByKind(actor, "bloodLoss");
  const forestall = findEffectsByKind(actor, "forestall");
  const firstAid = findEffectsByKind(actor, "firstAid");

  const removedBloodLoss = bloodLoss.length;
  const removedForestall = forestall.length;

  const toDelete = [...bloodLoss, ...forestall, ...firstAid];

  if (toDelete.length) {
    await deleteOwnedEffects(actor, toDelete.map((ef) => ef.id), { reason: "cleanupWoundStateIfNoWounds" });
  }

  let clearedWounded = false;
  try {
    if (actor.system?.wounded !== false) {
      await requestUpdateDocument(actor, { "system.wounded": false });
      clearedWounded = true;
    }
  } catch (err) {
    console.warn("UESRPG | Failed to clear system.wounded during wound cleanup", err);
  }

  return { clearedWounded, removedBloodLoss, removedForestall };
}

export async function evaluateUntreatedWoundDeadlines(actor, { now = Date.now(), nowWorldTimeSeconds = null, lazyConvert = true } = {}) {
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
        await requestUpdateDocument(ef, updates);
      } catch (_e) {
        // Non-blocking: proceed with in-memory converted value.
      }
    }

    let expired = false;
    if (Number.isFinite(deadlineWorld)) expired = worldNow >= deadlineWorld;
    else if (Number.isFinite(deadlineWall)) expired = wallNow >= deadlineWall;
    if (!expired) continue;

    const r = await applyMaimedOutcomeForWound(actor, ef, { reason: "untreated-deadline", immediate: false });
    if (r?.applied) converted += 1;
  }
  return { converted };
}

/**
 * Remove shock markers for a wound application
 */
export async function removeShockMarkersForApplication(actor, applicationId, { removeLost = false } = {}) {
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
    await deleteOwnedEffects(actor, toDelete.map(e => e.id), { reason: "removeShockMarkersForApplication" });
  } catch (err) {
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
export async function tickForestall(actor) {
  const ef = findFirstEffectByKind(actor, "forestall");
  if (!ef) return;

  const cur = Math.max(0, toNumber(ef.getFlag(FLAG_SCOPE, "wounds")?.remainingRounds ?? 0, 0));
  if (cur <= 1) {
    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [ef.id]);
    } catch (_err) {
      // Non-blocking: effect may already be gone.
    }
    return;
  }

  const next = cur - 1;
  try {
    await requestUpdateDocument(ef, {
      name: `Wound Forestall (${next})`,
      [`${FLAG_PATH}.wounds.remainingRounds`]: next
    });
  } catch (err) {
    console.warn("UESRPG | Wounds | Failed to tick Forestall", err);
  }
}

/**
 * Tick blood loss at end of turn
 */
export async function tickBloodLoss(actor) {
  if (isActorUndeadBloodless(actor)) {
    const ef = findFirstEffectByKind(actor, "bloodLoss");
    if (ef) {
      try {
        await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [ef.id]);
      } catch (_err) {
        // Non-blocking.
      }
    }
    return;
  }
  const ef = findFirstEffectByKind(actor, "bloodLoss");
  if (!ef) return;

  // Defensive invariant: if Blood Loss exists without any Wound effects, delete it.
  if (!hasAnyWoundEffects(actor)) {
    await cleanupWoundStateIfNoWounds(actor);
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
        await requestUpdateDocument(actor, { "system.hp.value": 0 });
      } catch (err) {
        console.warn("UESRPG | Wounds | Failed to set HP to 0 from Blood Loss", err);
      }
    }

    // Always ensure Unconscious is present when Blood Loss resolves at 0 rounds.
    await ensureUnconsciousEffect(actor);

    try {
      await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="uesrpg-chat-card"><div class="header"><b>${esc(actor.name)}</b></div><div>Blood loss: HP dropped to 0.</div></div>`,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
      _debugWounds("Blood loss expired, actor dropped to 0 HP", { actor: actor.uuid });
    } catch (_e) {
      // Non-blocking.
    }

    // Best-effort delete (may already be removed by another cleanup path/module).
    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [ef.id]);
    } catch (_err) {
      // Non-blocking.
    }

    return;
  }

  const next = cur - 1;
  await requestUpdateDocument(ef, {
    name: `Blood Loss (${next})`,
    [`${FLAG_PATH}.wounds.remainingRounds`]: next
  });
}

/**
 * Tick shock markers (e.g., stun countdown)
 */
export async function tickShockMarkers(actor) {
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
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", toDelete);
    } catch (err) {
      console.warn("UESRPG | Failed to delete expired shockStunned markers", err);
      for (const id of toDelete) {
        try {
          await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [id]);
        } catch (_fallbackErr) {}
      }
    }
  }
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
      console.warn("UESRPG | Failed to tick shockStunned markers", err);
      for (const update of updates) {
        const live = actor.effects?.get?.(String(update._id)) ?? null;
        if (!live) continue;
        const fallback = { ...update };
        delete fallback._id;
        try {
          await requestUpdateDocument(live, fallback);
        } catch (_fallbackErr) {}
      }
    }
  }
}

/**
 * Apply healing forestall effect
 */
export async function applyHealingForestall(actor, effectiveHealed) {
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
    await requestCreateEmbeddedDocuments(actor, "ActiveEffect", [ef]);
    return;
  }

  const cur = Math.max(0, toNumber(existing.getFlag(FLAG_SCOPE, "wounds")?.remainingRounds ?? 0, 0));
  const next = cur + add;
  await requestUpdateDocument(existing, {
    name: `Wound Forestall (${next})`,
    [`${FLAG_PATH}.wounds.remainingRounds`]: next
  });
}

/**
 * Advance healing progress for treated wounds
 */
export async function advanceTreatedWoundHealing(actor, effectiveHealed) {
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
    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", woundIdsToDelete);
    } catch (err) {
      console.warn("UESRPG | Failed to batch delete healed wound effects", err);
      for (const id of woundIdsToDelete) {
        try {
          await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [id]);
        } catch (_fallbackErr) {}
      }
    }
  }
  if (woundUpdates.length) {
    try {
      const ok = await requestUpdateEmbeddedDocuments(actor, "ActiveEffect", woundUpdates);
      if (!ok) {
        for (const update of woundUpdates) {
          const live = actor.effects?.get?.(String(update._id)) ?? null;
          if (!live) continue;
          const fallback = { ...update };
          delete fallback._id;
          await requestUpdateDocument(live, fallback);
        }
      }
    } catch (err) {
      console.warn("UESRPG | Failed to batch update treated wound healing", err);
      for (const update of woundUpdates) {
        const live = actor.effects?.get?.(String(update._id)) ?? null;
        if (!live) continue;
        const fallback = { ...update };
        delete fallback._id;
        try {
          await requestUpdateDocument(live, fallback);
        } catch (_fallbackErr) {}
      }
    }
  }
  for (const appId of shockApplicationIds) {
    await removeShockMarkersForApplication(actor, appId, { removeLost: false });
  }

  // Defensive invariant: when wounds are fully healed, remove any lingering blood loss / forestall.
  if (!hasAnyWoundEffects(actor)) {
    await cleanupWoundStateIfNoWounds(actor);
  }
  await enforceWoundInvariants(actor, { context: "advanceTreatedWoundHealing" });
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
      ui.notifications?.warn?.("Shock: actor not found.");
      return;
    }

    woundEf = actor.effects?.get?.(String(woundEffectId)) ?? null;
    if (!woundEf) {
      ui.notifications?.warn?.("Shock: wound effect not found.");
      return;
    }

    const w = woundEf.getFlag?.(FLAG_SCOPE, "wounds") ?? {};
    if (w.shockResolved === true) {
      ui.notifications?.info?.("Shock test already resolved for this wound.");
      return;
    }

    if (w.shockResolving === true) {
      ui.notifications?.info?.("Shock test already resolving.");
      return;
    }

    const hitLocation = normalizeHitLocation(w.hitLocation ?? "Body");
    const endTN = Number(actor.system?.characteristics?.end?.total ?? 0) || 0;
    if (endTN <= 0) {
      ui.notifications?.warn?.("Shock: invalid Endurance TN.");
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
    const rollTn = Math.max(0, Number(rollOptions?.target ?? endTN) || endTN);

    let test = await doTestRoll(actor, { target: rollTn, rollFormula: "1d100" });
    await _showShockRoll3d(test?.roll ?? null);
    let passed = !!test?.isSuccess;
    let dieHardRerolled = false;

    // Die-Hard (Chapter 4): may reroll failed Endurance tests to resist the shock effects of a wound, once per test.
    try {
      const hasDieHard = hasTalent(actor, "diehard");
      const dieHardUsed = (w?.dieHardUsed === true);
      if (hasDieHard && !dieHardUsed && !passed) {
        const wants = await customDialog({
          title: "Die-Hard",
          content: `<p><b>${esc(actor.name ?? "Actor")}</b> failed the Shock Test. Use <b>Die-Hard</b> to reroll (once per test)?</p>`,
          buttons: {
            reroll: { label: "Reroll", callback: () => true },
            keep: { label: "Keep Failure", callback: () => false }
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
          await _showShockRoll3d(test?.roll ?? null);
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
          title: "Magic Shock Side Effect (Tie)",
          content: `<p>Multiple magic types contributed equally to this wound. Choose which side effect applies.</p>`,
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
