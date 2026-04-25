/**
 * src/ui/sheets/v2/shared/sheet-signatures.js
 *
 * Shared render-cache signature builders for actor-type AppV2 sheets.
 * Extracted from PCActorSheetV2 and NpcSheetV2 where these four functions
 * were byte-for-byte identical.
 *
 * Signatures are cheap string/JSON representations of the actor state used
 * to skip expensive context-building when nothing relevant has changed.
 *
 * NOTE: _buildItemsSignature is intentionally NOT here — the PC and NPC
 * versions include different fields (NPC adds npcSchoolRanks and different
 * item fingerprint fields) and must remain sheet-specific.
 */

import { SYSTEM_ID } from "../../../../core/system/namespace.js";
import { resolveDamageUpdateTarget } from "../../../../core/combat/damage/post-application.js";
import { resolveAttackTrackerActor } from "../../../../core/combat/attack-tracker-context.js";
import { getEffectChanges } from "../../../../utils/compat.js";
import { AttackTracker } from "../../../../core/combat/attack-tracker.js";

/**
 * Build a cache-key string representing the actor's active-effect collection.
 * @param {Actor} actor
 * @returns {string}
 */
export function buildEffectsSignature(actor) {
  const parts = [String(actor?.effects?.size ?? 0)];
  for (const e of actor?.effects?.contents ?? []) {
    parts.push([
      e?.id ?? "",
      e?.disabled ? "1" : "0",
      e?.transfer ? "1" : "0",
      String(getEffectChanges(e).length),
      String(e?.duration?.remaining ?? ""),
    ].join("~"));
  }
  return parts.join("|");
}

/**
 * Build a cache-key string representing the actor's wounds/injuries/shock state.
 * @param {Actor} actor
 * @returns {string}
 */
export function buildWoundsSignature(actor) {
  try {
    const wounds = actor?.system?.wounds ?? null;
    const injuries = actor?.system?.injuries ?? null;
    const shock = actor?.system?.shock ?? null;
    const woundEffects = [];
    for (const effect of actor?.effects?.contents ?? []) {
      const wf = effect?.flags?.[SYSTEM_ID]?.wounds ?? null;
      if (!wf?.kind) continue;
      woundEffects.push({
        id: effect?.id ?? "",
        disabled: Boolean(effect?.disabled),
        name: effect?.name ?? "",
        kind: String(wf?.kind ?? ""),
        applicationId: String(wf?.applicationId ?? ""),
        hitLocation: String(wf?.hitLocation ?? ""),
        progress: Number(wf?.progress ?? 0) || 0,
        damage: Number(wf?.damage ?? 0) || 0,
        treated: Boolean(wf?.treated),
        treatedAt: Number(wf?.treatedAt ?? 0) || 0,
        shockResolved: Boolean(wf?.shockResolved),
        shockPassed: wf?.shockPassed === true ? true : (wf?.shockPassed === false ? false : null),
        maimed: Boolean(wf?.maimed),
        permanent: Boolean(wf?.permanent),
      });
    }
    return JSON.stringify({ wounds, injuries, shock, woundEffects });
  } catch (_e) {
    return `${actor?.id ?? ""}|wounds`;
  }
}

/**
 * Build a cache-key string representing the actor's combat-relevant derived state.
 * @param {Actor} actor
 * @param {string} itemsSignature - Pre-built items signature (from the sheet-specific builder).
 * @param {string} effectsSignature - Pre-built effects signature.
 * @returns {string}
 */
export function buildCombatSignature(actor, itemsSignature, effectsSignature, trackerContext = {}) {
  const trackerViewState = AttackTracker.getTrackerViewState(actor, {}, trackerContext);
  const trackedActor = trackerViewState?.trackerContext?.trackerDocument
    ?? trackerViewState?.trackedActor
    ?? resolveAttackTrackerActor(actor, trackerContext)
    ?? resolveDamageUpdateTarget(actor)
    ?? actor;
  const trackerOwner = trackerViewState?.trackerContext?.trackerOwner
    ?? trackerViewState?.trackerCombatant
    ?? trackedActor;
  const combatTracking = trackerViewState ? {
    attacks_this_round: trackerViewState.rawCurrent,
    attacks_this_turn: trackerViewState.rawTurnCurrent,
    attack_limit: trackerViewState.rawMax,
    last_reset_round: trackerViewState.rawLastResetRound,
    last_reset_turn: trackerViewState.rawLastResetTurn,
    weapon_uses_this_round: trackerViewState.rawWeaponUses
  } : (trackedActor?.system?.combat_tracking ?? {});
  const attackOverrides = trackerOwner?.flags?.[SYSTEM_ID]?.combat?.attackTrackerOverrides ?? {};
  const activeCombat = game?.combat ?? null;
  const current = trackerViewState?.current ?? AttackTracker.getAttackCount(actor, trackerContext);
  const max = trackerViewState?.max ?? AttackTracker.getAttackLimit(actor, {}, trackerContext);
  const parts = [
    actor?.id ?? "",
    trackedActor?.uuid ?? "",
    String(trackerOwner?.uuid ?? trackerViewState?.trackerContext?.trackerDocument?.uuid ?? ""),
    String(trackerViewState?.trackerContext?.trackerCombatant?.id ?? ""),
    String(trackerContext?.tokenUuid ?? ""),
    String(trackerContext?.combatantId ?? ""),
    String(trackerContext?.authorityState ?? ""),
    String(trackerContext?.ambiguityState ?? ""),
    itemsSignature ?? "",
    effectsSignature ?? "",
    String(trackedActor?.system?.action_points?.value ?? ""),
    String(trackedActor?.system?.action_points?.max ?? ""),
    String(combatTracking?.attacks_this_round ?? ""),
    String(combatTracking?.attacks_this_turn ?? ""),
    String(combatTracking?.last_reset_round ?? ""),
    String(combatTracking?.last_reset_turn ?? ""),
    JSON.stringify(combatTracking?.weapon_uses_this_round ?? {}),
    String(attackOverrides?.current ?? ""),
    String(attackOverrides?.max ?? ""),
    String(trackerViewState?.rawCurrent ?? ""),
    String(trackerViewState?.rawTurnCurrent ?? ""),
    String(trackerViewState?.rawMax ?? ""),
    String(trackerViewState?.rawOverrideCurrent ?? ""),
    String(trackerViewState?.rawOverrideMax ?? ""),
    String(current ?? ""),
    String(max ?? ""),
    String(activeCombat?.id ?? ""),
    String(activeCombat?.round ?? ""),
    String(activeCombat?.turn ?? ""),
    String(actor?.system?.fatigue?.level ?? ""),
    String(actor?.system?.fatigue?.penalty ?? ""),
    String(actor?.system?.woundPenalty ?? ""),
    String(actor?.system?.carry_rating?.penalty ?? ""),
    String(actor?.system?.inClose ?? ""),
    String(actor?.flags?.[SYSTEM_ID]?.activeCombatStyleId ?? ""),
    String(actor?.flags?.[SYSTEM_ID]?.combat?.activeStyleId ?? ""),
  ];
  return parts.join("|");
}

/**
 * Build a cache-key string representing the sheet UI configuration state
 * (loadouts setting, diagnostics setting, per-actor loadout flags).
 * @param {Actor} actor
 * @returns {string}
 */
export function buildSheetUiSignature(actor) {
  let enableLoadouts = false;
  let showDiagnostics = false;
  try {
    enableLoadouts = Boolean(game?.settings?.get?.(SYSTEM_ID, "enableLoadouts"));
    showDiagnostics = Boolean(game?.settings?.get?.(SYSTEM_ID, "sheetDiagnostics"));
  } catch (_e) {
    // no-op
  }
  const loadouts = actor?.flags?.[SYSTEM_ID]?.loadouts ?? null;
  return JSON.stringify({
    actorId: actor?.id ?? null,
    enableLoadouts,
    showDiagnostics,
    loadouts,
  });
}
