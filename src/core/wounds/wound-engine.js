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

import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { registerWoundSocket, requestWoundsGM } from "./wound-socket.js";
import { registerWoundCombatTicker } from "./wound-ticker.js";
import { normalizeHitLocation, isActiveGMUser } from "./wound-schema.js";

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
import { getWoundState, isDerivedWounded, resolveActorLike, WOUND_STATES } from "./engine/state.js";

import {
  applyShockUnconditional,
  postShockTestChatCard,
  enforceWoundInvariants,
  cleanupWoundStateIfNoWounds,
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
const FLAG_SCOPE = "uesrpg-3ev4";
const FLAG_PATH = `flags.${FLAG_SCOPE}`;

function _findHealerKit(actor) {
  const items = actor?.items?.contents ?? [];
  return items.some((i) => {
    const qty = Number(i?.system?.quantity ?? 1);
    if (qty <= 0) return false;
    const name = String(i?.name ?? "").toLowerCase();
    return name.includes("healer") || name.includes("healing kit") || name.includes("medicine kit") || name.includes("bandage");
  });
}

function _resolveHealingTestTarget(healer) {
  if (!healer) return 0;
  const candidates = [];
  const prof = healer.system?.professions ?? {};
  candidates.push(Number(prof?.physical ?? 0) || 0);
  candidates.push(Number(prof?.knowledge ?? 0) || 0);
  for (const [k, v] of Object.entries(prof)) {
    const key = String(k ?? "").toLowerCase();
    if (key.includes("medicine") || key.includes("survival")) candidates.push(Number(v ?? 0) || 0);
  }
  const items = healer.items?.contents ?? [];
  for (const i of items) {
    const name = String(i?.name ?? "").toLowerCase();
    if (!(name.includes("survival") || name.includes("medicine"))) continue;
    candidates.push(Number(i?.system?.value ?? i?.system?.tn ?? 0) || 0);
  }
  return Math.max(0, ...candidates);
}

async function _postWoundWorkflowCard({ title, actor, healer, lines = [] } = {}) {
  try {
    const content = `<div class="uesrpg-chat-card"><header class="card-header"><h3>${title}</h3></header><div class="card-content"><p><strong>Target:</strong> ${actor?.name ?? "Actor"}</p><p><strong>Healer:</strong> ${healer?.name ?? "N/A"}</p>${lines.map((l) => `<p>${l}</p>`).join("")}</div></div>`;
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

  const appId = applicationId ? String(applicationId) : null;
  if (appId) {
    const existingByApp = findFirstEffectByAppId(actor, appId);
    if (existingByApp) return existingByApp;
  }

  const woundEffect = makeEffect({
    name: `Wound (${locLabel})`,
    icon: "icons/svg/skull.svg",
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
        source,
        shockResolved: false,
        shockResolvedAt: null,
        shockPassed: null
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
      icon: "icons/svg/blood.svg",
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
  for (const ef of findEffectsByKind(actor, "bloodLoss")) {
    try {
      await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [ef.id]);
      removedBloodLoss++;
    } catch (_err) {
      // Non-blocking.
    }
  }

  // Create a persistent suppression marker
  const existing = findFirstEffectByKind(actor, "firstAid");
  if (existing) return { removedBloodLoss, createdFirstAid: false };

  const effect = makeEffect({
    name: "First Aid (Stabilized)",
    icon: "icons/svg/regen.svg",
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
  for (const ef of findEffectsByKind(actor, "wound")) {
    const data = ef.getFlag(FLAG_SCOPE, "wounds") ?? {};
    if (data.treated === true) continue;
    await treatWound(actor, ef.id, {});
  }
}

export async function attemptFirstAid(actorLike, { healerActor = null, skill = null, hasKit = null, bypass = false } = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { ok: false, reason: "invalidTarget" };
  const healer = await resolveActorLike(healerActor) ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? actor;
  const resolvedHasKit = (typeof hasKit === "boolean") ? hasKit : _findHealerKit(healer);
  const tn = Math.max(0, Number(skill ?? _resolveHealingTestTarget(healer)) || 0);

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
  const healer = await resolveActorLike(healerActor) ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? actor;
  const resolvedHasKit = (typeof hasKit === "boolean") ? hasKit : _findHealerKit(healer);
  const tn = Math.max(0, _resolveHealingTestTarget(healer));

  if (!bypass && !resolvedHasKit) {
    await _postWoundWorkflowCard({ title: "Treat Wound", actor, healer, lines: ["Failed: missing healer's kit/supplies."] });
    return { ok: false, reason: "missingKit" };
  }
  if (!bypass && tn <= 0) {
    await _postWoundWorkflowCard({ title: "Treat Wound", actor, healer, lines: ["Failed: no valid Profession[Medicine] / Survival test target."] });
    return { ok: false, reason: "invalidTestTarget" };
  }

  let passed = true;
  if (!bypass) {
    const roll = await doTestRoll(healer, { target: tn, rollFormula: "1d100" });
    passed = Boolean(roll?.isSuccess);
    try {
      await roll?.roll?.toMessage?.({
        speaker: ChatMessage.getSpeaker({ actor: healer }),
        flavor: `Treat Wound Test - ${healer.name} (TN ${tn})`
      });
    } catch (_e) {
      // Non-blocking.
    }
  }
  if (!passed) {
    await _postWoundWorkflowCard({ title: "Treat Wound", actor, healer, lines: [`Failed test (TN ${tn}).`] });
    return { ok: false, reason: "failedTest", tn };
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
    lines: [`Success${bypass ? " (GM override)" : ""}. Wound marked treated (1-hour treatment workflow).`]
  });
  return { ok: true, tn, bypass: bypass === true };
}

export async function attemptTreatAllWounds(actorLike, { healerActor = null, hasKit = null, bypass = false } = {}) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { ok: false, reason: "invalidTarget" };
  const wounds = findEffectsByKind(actor, "wound").filter((ef) => (ef.getFlag?.(FLAG_SCOPE, "wounds")?.treated !== true));
  if (!wounds.length) return { ok: true, treated: 0 };

  const healer = await resolveActorLike(healerActor) ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? actor;
  const resolvedHasKit = (typeof hasKit === "boolean") ? hasKit : _findHealerKit(healer);
  const tn = Math.max(0, _resolveHealingTestTarget(healer));
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

  let treated = 0;
  for (const ef of wounds) {
    await treatWound(actor, ef.id, {
      treatedBy: healer?.id ?? healer?.name ?? "",
      method: "profession-medicine",
      gmOverride: bypass === true
    });
    treated++;
  }
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
  const bloodLoss = findFirstEffectByKind(actor, "bloodLoss");
  const forestall = findFirstEffectByKind(actor, "forestall");
  const firstAidMarker = findFirstEffectByKind(actor, "firstAid");
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
    bloodLossRounds: Math.max(0, Number(bloodLoss?.getFlag?.(FLAG_SCOPE, "wounds")?.remainingRounds ?? 0) || 0),
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

  for (const ef of findEffectsByKind(actor, "wound")) {
    try {
      await requestUpdateDocument(ef, {
        [`${FLAG_PATH}.wounds.stabilized`]: true,
        [`${FLAG_PATH}.wounds.stabilizedAt`]: now
      });
      stabilizedWounds++;
    } catch (err) {
      console.warn("UESRPG | Failed to mark wound stabilized", err);
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

  await tickForestall(actor);
  await tickBloodLoss(actor);
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
      await postShockTestChatCard({
        actor,
        woundEffect: woundDoc,
        hitLocation,
        damageAppliedByType,
        applicationId: appId || null
      });
    } catch (err) {
      console.warn("UESRPG | Wound creation failed", err);
    }
  };

  const onHealingApplied = async (actor, data) => {
    try {
      if (!actor) return;

      await enforceWoundInvariants(actor, { context: "uesrpgHealingApplied" });

      // Only apply wound healing interactions when the actor is currently wounded or has wound effects.
      const hasWound = isDerivedWounded(actor) || hasAnyWoundEffects(actor);
      if (!hasWound) return;

      const effectiveHealed = Math.max(0, toNumber(data?.effectiveHealed ?? 0, 0));
      if (effectiveHealed > 0) {
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

  Hooks.on("updateActor", (actor, changed) => {
    if (!isActiveGMUser(game.user)) return;
    if (!Object.prototype.hasOwnProperty.call(changed ?? {}, "system")) return;
    if (!Object.prototype.hasOwnProperty.call(changed?.system ?? {}, "wounded")) return;
    enforceWoundInvariants(actor, { context: "updateActor:woundedChanged" }).catch(() => {});
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
  clearWound,
  clearAllWounds,
  canNaturalHeal,
  getWoundState,
  getWoundManagerData,
  reconcileWoundState,
  runWorldWoundMigration
};
