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
import { resolveActorLike } from "./engine/state.js";

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
  removeShockMarkersForApplication,
  ensureWoundedPassiveEffect
} from "./engine/apply.js";

// ===== INTERNAL STATE =====

let _woundHooksRegistered = false;
const FLAG_SCOPE = "uesrpg-3ev4";
const FLAG_PATH = `flags.${FLAG_SCOPE}`;

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
  
  // Remove "Wounded: Passive" effect when First Aid is applied
  await ensureWoundedPassiveEffect(actor);

  return { removedBloodLoss, createdFirstAid: true };
}

/**
 * Treat a specific wound
 */
export async function treatWound(actorLike, effectId) {
  const actor = await resolveActorLike(actorLike);
  if (!actor || !effectId) return;
  const ef = actor.effects?.get?.(effectId) ?? null;
  const data = ef?.getFlag?.(FLAG_SCOPE, "wounds");
  if (!ef || data?.kind !== "wound") return;

  if (data.treated === true) return;

  await requestUpdateDocument(ef, {
    [`${FLAG_PATH}.wounds.treated`]: true,
    [`${FLAG_PATH}.wounds.treatedAt`]: Date.now(),
    [`${FLAG_PATH}.wounds.progress`]: 0
  });
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
    await treatWound(actor, ef.id);
  }
}

/**
 * Stabilize actor (stop blood loss, suppress penalties, mark wounds)
 */
export async function stabilize(actorLike) {
  const actor = await resolveActorLike(actorLike);
  if (!actor) return { stabilizedWounds: 0, firstAid: { removedBloodLoss: 0, createdFirstAid: false } };

  const firstAidResult = await firstAid(actor);

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

  // Clear canonical actor flag
  if (actor.system?.wounded) {
    try {
      await requestUpdateDocument(actor, { "system.wounded": false });
    } catch (err) {
      console.warn("UESRPG | Failed to clear system.wounded during clearAllWounds", err);
    }
  }
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
    return;
  }

  await tickForestall(actor);
  await tickBloodLoss(actor);
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
      const hasWound = actor.system?.wounded === true || hasAnyWoundEffects(actor);
      if (!hasWound) return;

      const effectiveHealed = Math.max(0, toNumber(data?.effectiveHealed ?? 0, 0));
      if (effectiveHealed > 0) {
        await applyHealingForestall(actor, effectiveHealed);
        await advanceTreatedWoundHealing(actor, effectiveHealed);
      }
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
}

// ===== EXPORTED API OBJECT =====

export const WoundsAPI = {
  createWoundFromDamage,
  upsertBloodLoss,
  firstAid,
  stabilize,
  treatWound,
  treatAllWounds,
  clearWound,
  clearAllWounds,
  canNaturalHeal
};
