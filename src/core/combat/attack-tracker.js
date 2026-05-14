/**
 * src/core/combat/attack-tracker.js
 *
 * Track attacks made per round/turn for the UESRPG 3ev4 system.
 * According to RAW baseline: "A character may make no more than two total attacks in a single round"
 */

import { hasTalent } from "../traits/talents-api.js";
import { getAttackModeFromWeapon, getEffectiveWeaponHands } from "./combat-utils.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { getFlagValueWithFallback } from "../system/flags.js";
import { registerCombatBoundaryConsumer, noteCombatBoundaryLegacyFallbackSkip } from "../time/combat-boundary-orchestrator.js";
import { requestBatchUpdateDocuments } from "../../utils/authority-proxy.js";
import { evaluateAEModifierKeys, getActorCapabilityFlag } from "../active-effects/modifier-evaluator.js";
import { isAttackTrackerEagerResetSkipped } from "../config/automation-policy.js";
import { createDebugLogger } from "../../utils/debug.js";
import { recordAttackTrackerDiagnostic } from "./attack-tracker-diagnostics.js";
import { buildAttackTrackerContext, resolveAttackTrackerActor } from "./attack-tracker-context.js";
import { isActorInStartedCombatEncounter } from "./combat-scope.js";

const ATTACK_OVERRIDE_MAX_PATH = `flags.${FLAG_SCOPE}.combat.attackTrackerOverrides.max`;
const ATTACK_OVERRIDE_CURRENT_PATH = `flags.${FLAG_SCOPE}.combat.attackTrackerOverrides.current`;
const COMBATANT_TRACKER_STATE_PATH = `flags.${FLAG_SCOPE}.combat.attackTrackerState`;
const COMBATANT_TRACKER_CURRENT_PATH = `${COMBATANT_TRACKER_STATE_PATH}.attacksThisRound`;
const COMBATANT_TRACKER_TURN_PATH = `${COMBATANT_TRACKER_STATE_PATH}.attacksThisTurn`;
const COMBATANT_TRACKER_LAST_RESET_ROUND_PATH = `${COMBATANT_TRACKER_STATE_PATH}.lastResetRound`;
const COMBATANT_TRACKER_LAST_RESET_TURN_PATH = `${COMBATANT_TRACKER_STATE_PATH}.lastResetTurn`;
const COMBATANT_TRACKER_WEAPON_USES_PATH = `${COMBATANT_TRACKER_STATE_PATH}.weaponUsesThisRound`;
const _trackerDebug = createDebugLogger("effectsProxyDebug", "[UESRPG][AttackTracker]");

export class AttackTracker {
  static _isCombatantDocument(doc) {
    return String(doc?.documentName ?? "").trim() === "Combatant";
  }

  static _resolveTrackerAuthority(actor, trackerContext = {}) {
    const normalizedContext = buildAttackTrackerContext(actor, trackerContext);
    const trackedActor = normalizedContext.trackerDocument ?? normalizedContext.combatantActor ?? actor ?? null;
    const trackerCombatant = normalizedContext.trackerCombatant ?? null;
    const trackerOwner = normalizedContext.trackerOwner ?? trackerCombatant ?? trackedActor ?? actor ?? null;
    return {
      trackerContext: normalizedContext,
      trackedActor,
      trackerCombatant,
      trackerOwner
    };
  }

  static _readTrackerState(authority = {}) {
    const trackerOwner = authority?.trackerOwner ?? null;
    if (this._isCombatantDocument(trackerOwner)) {
      const state = foundry.utils.getProperty(trackerOwner, COMBATANT_TRACKER_STATE_PATH) ?? {};
      return {
        attacks_this_round: Number(state?.attacksThisRound ?? 0) || 0,
        attacks_this_turn: Number(state?.attacksThisTurn ?? 0) || 0,
        last_reset_round: Number(state?.lastResetRound ?? 0) || 0,
        last_reset_turn: Number(state?.lastResetTurn ?? 0) || 0,
        weapon_uses_this_round: (state?.weaponUsesThisRound && typeof state.weaponUsesThisRound === "object")
          ? state.weaponUsesThisRound
          : {},
        attack_limit: null
      };
    }

    const trackedActor = authority?.trackedActor ?? null;
    return trackedActor?.system?.combat_tracking ?? {
      attacks_this_round: 0,
      attacks_this_turn: 0,
      last_reset_round: 0,
      last_reset_turn: 0,
      weapon_uses_this_round: {},
      attack_limit: null
    };
  }

  static _buildStateUpdateData(authority = {}, {
    attacksThisRound,
    attacksThisTurn,
    lastResetRound,
    lastResetTurn,
    weaponUsesThisRound
  } = {}) {
    const trackerOwner = authority?.trackerOwner ?? null;
    if (this._isCombatantDocument(trackerOwner)) {
      const updates = {};
      if (attacksThisRound !== undefined) updates[COMBATANT_TRACKER_CURRENT_PATH] = Math.max(0, Number(attacksThisRound) || 0);
      if (attacksThisTurn !== undefined) updates[COMBATANT_TRACKER_TURN_PATH] = Math.max(0, Number(attacksThisTurn) || 0);
      if (lastResetRound !== undefined) updates[COMBATANT_TRACKER_LAST_RESET_ROUND_PATH] = Number(lastResetRound) || 0;
      if (lastResetTurn !== undefined) updates[COMBATANT_TRACKER_LAST_RESET_TURN_PATH] = Number(lastResetTurn) || 0;
      if (weaponUsesThisRound !== undefined) {
        updates[COMBATANT_TRACKER_WEAPON_USES_PATH] = weaponUsesThisRound && typeof weaponUsesThisRound === "object"
          ? weaponUsesThisRound
          : {};
      }
      return updates;
    }

    const updates = {};
    if (attacksThisRound !== undefined) updates["system.combat_tracking.attacks_this_round"] = Math.max(0, Number(attacksThisRound) || 0);
    if (attacksThisTurn !== undefined) updates["system.combat_tracking.attacks_this_turn"] = Math.max(0, Number(attacksThisTurn) || 0);
    if (lastResetRound !== undefined) updates["system.combat_tracking.last_reset_round"] = Number(lastResetRound) || 0;
    if (lastResetTurn !== undefined) updates["system.combat_tracking.last_reset_turn"] = Number(lastResetTurn) || 0;
    if (weaponUsesThisRound !== undefined) {
      updates["system.combat_tracking.weapon_uses_this_round"] = weaponUsesThisRound && typeof weaponUsesThisRound === "object"
        ? weaponUsesThisRound
        : {};
    }
    return updates;
  }

  static _buildTrackerSnapshot(actor, trackerContext = {}, limitContext = {}) {
    const authority = this._resolveTrackerAuthority(actor, trackerContext);
    const normalizedContext = authority.trackerContext;
    const trackedActor = authority.trackedActor;
    const tracking = this._readTrackerState(authority);
    const scoped = this._getRoundScopedTracking(trackedActor ?? actor, normalizedContext);
    const overrides = {
      current: this._readOverride(authority.trackerOwner ?? trackedActor ?? actor, ATTACK_OVERRIDE_CURRENT_PATH, normalizedContext),
      max: this._readOverride(authority.trackerOwner ?? trackedActor ?? actor, ATTACK_OVERRIDE_MAX_PATH, normalizedContext)
    };

    const current = overrides.current != null
      ? Math.max(0, Math.floor(overrides.current))
      : scoped.attacksThisRound;

    let max = 2;
    if (trackedActor) {
      if (limitContext?.ignoreRoundLimit === true || limitContext?.followUpStrikeActive === true) {
        max = Number.MAX_SAFE_INTEGER;
      } else if (getActorCapabilityFlag(trackedActor, "flags.uesrpg-3ev4.combat.followupIgnoresRoundLimit")) {
        max = Number.MAX_SAFE_INTEGER;
      } else if (overrides.max != null) {
        max = Math.max(1, Math.floor(overrides.max));
      } else {
        const attackMode = String(limitContext?.attackMode ?? "").trim().toLowerCase();
        const aeKeys = ["system.modifiers.combat.attackLimit.total"];
        if (attackMode === "melee") aeKeys.push("system.modifiers.combat.attackLimit.melee");
        if (attackMode === "ranged") aeKeys.push("system.modifiers.combat.attackLimit.ranged");

        const aeResolved = evaluateAEModifierKeys(trackedActor, aeKeys, {
          context: { attackMode },
          enforceConditions: true,
          dedupeByOrigin: true
        });
        const totalBonus = aeKeys.reduce((sum, key) => sum + (Number(aeResolved?.[key] ?? 0) || 0), 0);
        if (totalBonus !== 0) {
          max = Math.max(1, Math.floor(2 + totalBonus));
        } else {
          const hasDualWielderTalent = hasTalent(trackedActor, "dualwielder") || hasTalent(trackedActor, "dualfighter");
          max = hasDualWielderTalent ? 3 : 2;
        }
      }
    }

    return {
      trackerContext: normalizedContext,
      trackedActor,
      trackerCombatant: authority.trackerCombatant,
      trackerOwner: authority.trackerOwner,
      tracking,
      scoped,
      overrides,
      current,
      max,
      rawCurrent: Number(tracking?.attacks_this_round ?? 0) || 0,
      rawTurnCurrent: Number(tracking?.attacks_this_turn ?? 0) || 0,
      rawLimit: tracking?.attack_limit ?? null,
      rawOverrideCurrent: overrides.current,
      rawOverrideMax: overrides.max,
      rawLastResetRound: Number(tracking?.last_reset_round ?? 0) || 0,
      rawLastResetTurn: Number(tracking?.last_reset_turn ?? 0) || 0,
      rawWeaponUses: foundry.utils.deepClone(tracking?.weapon_uses_this_round ?? {})
    };
  }

  static _recordTrackerPhase(actor, {
    type = "event",
    reason = "trace",
    eventType = "attack-tracker",
    phase = null,
    trackerContext = {},
    trackedActor = null,
    limitContext = {},
    details = {},
    updateMode = null
  } = {}) {
    const snapshot = this._buildTrackerSnapshot(actor, trackerContext, limitContext);
    const normalizedContext = snapshot.trackerContext;
    recordAttackTrackerDiagnostic({
      type,
      source: normalizedContext?.source ?? "attack-tracker",
      sourceTag: normalizedContext?.sourceTag ?? normalizedContext?.source ?? "attack-tracker",
      reason,
      eventType,
      attackTraceId: normalizedContext?.attackTraceId ?? null,
      phase: phase ?? normalizedContext?.phase ?? null,
      attackMode: normalizedContext?.attackMode ?? limitContext?.attackMode ?? null,
      updateMode,
      sourceActor: actor,
      resolvedActor: trackedActor ?? snapshot.trackedActor,
      combatantActor: normalizedContext?.combatantActor ?? null,
      combatantId: normalizedContext?.combatantId ?? null,
      resolutionSource: normalizedContext?.resolutionSource ?? null,
      authorityState: normalizedContext?.authorityState ?? null,
      ambiguityState: normalizedContext?.ambiguityState ?? null,
      explicitTokenUuid: normalizedContext?.tokenUuid ?? null,
      trackerDocument: normalizedContext?.trackerOwner ?? snapshot.trackerOwner ?? normalizedContext?.trackerDocument ?? trackedActor ?? snapshot.trackedActor ?? null,
      combatId: normalizedContext?.combat?.id ?? game?.combat?.id ?? null,
      round: this._getCombatRound(),
      turn: this._getCombatTurn(),
      details: {
        rawCurrent: snapshot.rawCurrent,
        rawTurnCurrent: snapshot.rawTurnCurrent,
        rawMax: snapshot.rawLimit,
        overrideCurrent: snapshot.rawOverrideCurrent,
        overrideMax: snapshot.rawOverrideMax,
          lastResetRound: snapshot.rawLastResetRound,
          lastResetTurn: snapshot.rawLastResetTurn,
          weaponUsesThisRound: snapshot.rawWeaponUses,
          trackerDocumentUuid: normalizedContext?.trackerOwner?.uuid ?? snapshot.trackerOwner?.uuid ?? normalizedContext?.trackerDocument?.uuid ?? trackedActor?.uuid ?? snapshot.trackedActor?.uuid ?? null,
          computedCurrent: snapshot.current,
          computedMax: snapshot.max,
        ...details
      }
    });
    return snapshot;
  }

  static _resolveCombatantActor(trackerContext = {}) {
    const normalizedContext = buildAttackTrackerContext(null, trackerContext);
    return normalizedContext.trackerDocument ?? normalizedContext.combatantActor ?? null;
  }

  static _resolveTrackerActor(actor, trackerContext = {}) {
    return this._resolveTrackerAuthority(actor, trackerContext).trackedActor;
  }

  static _getTrackerUpdateMode(actor) {
    if (!actor) return "unavailable";
    if (game.user?.isGM || actor.isOwner) return "direct";
    const activeGM = game.users?.activeGM ?? null;
    return activeGM ? "proxy" : "unavailable";
  }

  static _recordResolutionDiagnostic(actor, trackerContext = {}, trackedActor = null, { reason = "resolve" } = {}) {
    const normalizedContext = buildAttackTrackerContext(actor, trackerContext);
    const fallbackActor = actor ?? null;
    const combatantActor = normalizedContext.combatantActor ?? null;
    recordAttackTrackerDiagnostic({
      type: "resolution",
      source: normalizedContext?.source ?? "attack-tracker",
      reason,
      sourceActor: actor,
      resolvedActor: trackedActor,
      fallbackActor,
      combatantActor,
      eventType: "attack-tracker",
      attackTraceId: normalizedContext?.attackTraceId ?? null,
      phase: normalizedContext?.phase ?? reason,
      attackMode: normalizedContext?.attackMode ?? null,
      sourceTag: normalizedContext?.sourceTag ?? normalizedContext?.source ?? "attack-tracker",
      resolutionSource: normalizedContext?.resolutionSource ?? null,
      authorityState: normalizedContext?.authorityState ?? null,
      ambiguityState: normalizedContext?.ambiguityState ?? null,
      explicitTokenUuid: normalizedContext?.tokenUuid ?? null,
      combatantId: normalizedContext?.combatantId ?? null,
      trackerDocument: normalizedContext?.trackerOwner ?? normalizedContext?.trackerDocument ?? trackedActor ?? null,
      combatId: normalizedContext?.combat?.id ?? game?.combat?.id ?? null,
      round: this._getCombatRound(),
      turn: this._getCombatTurn(),
      details: {
        usedExplicitCombatantActor: Boolean(combatantActor),
        resolvedDiffersFromFallback: Boolean(
          trackedActor?.uuid &&
          fallbackActor?.uuid &&
          String(trackedActor.uuid) !== String(fallbackActor.uuid)
        )
      }
    });
  }

  static _emitTrackerChanged(actor, { reason = "update", sourceActor = null, resolvedActor = null, trackerContext = {} } = {}) {
    const authority = this._resolveTrackerAuthority(actor, trackerContext);
    const normalizedContext = authority.trackerContext;
    const trackedActor = authority.trackedActor ?? resolvedActor ?? this._resolveTrackerActor(actor, normalizedContext);
    if (!trackedActor) return;
    try {
      Hooks.callAll("uesrpg.attackTrackerChanged", {
        actor: trackedActor,
        sourceActor: sourceActor ?? actor ?? trackedActor,
        reason: String(reason ?? "update"),
        attackTraceId: normalizedContext?.attackTraceId ?? null,
        phase: normalizedContext?.phase ?? String(reason ?? "update"),
        attackMode: normalizedContext?.attackMode ?? null,
        explicitTokenUuid: String(normalizedContext?.tokenUuid ?? "").trim() || null,
        sourceLabel: String(normalizedContext?.source ?? "attack-tracker"),
        sourceTag: String(normalizedContext?.sourceTag ?? normalizedContext?.source ?? "attack-tracker"),
        combatantActor: normalizedContext?.combatantActor ?? null,
        combatantId: normalizedContext?.combatantId ?? null,
        resolutionSource: normalizedContext?.resolutionSource ?? null,
        authorityState: normalizedContext?.authorityState ?? null,
        ambiguityState: normalizedContext?.ambiguityState ?? null,
        notice: normalizedContext?.notice ?? null,
        trackerDocument: authority.trackerOwner ?? normalizedContext?.trackerDocument ?? trackedActor,
        combatId: normalizedContext?.combat?.id ?? game?.combat?.id ?? null,
        round: this._getCombatRound(),
        turn: this._getCombatTurn()
      });
    } catch (err) {
      _trackerDebug("hook emit failed", {
        actor: trackedActor?.uuid ?? null,
        reason,
        err: err?.message ?? String(err)
      });
    }
  }

  static _getCombatRound() {
    return game?.combat?.round ?? 0;
  }

  static _getCombatTurn() {
    return game?.combat?.turn ?? 0;
  }

  static _getTracking(actor, trackerContext = {}) {
    return this._readTrackerState(this._resolveTrackerAuthority(actor, trackerContext));
  }

  static _getRoundScopedTracking(actor, trackerContext = {}) {
    const authority = this._resolveTrackerAuthority(actor, trackerContext);
    const normalizedContext = authority.trackerContext;
    const trackedActor = authority.trackedActor;
    const tracking = this._readTrackerState(authority);
    const currentRound = this._getCombatRound();
    const currentTurn = this._getCombatTurn();
    const lastResetRound = Number(tracking?.last_reset_round ?? 0) || 0;
    const isStaleRound = currentRound !== lastResetRound;
    const rawUses = tracking?.weapon_uses_this_round;
    return {
      trackedActor,
      tracking,
      currentRound,
      currentTurn,
      lastResetRound,
      isStaleRound,
      attacksThisRound: isStaleRound ? 0 : Math.max(0, Number(tracking?.attacks_this_round ?? 0) || 0),
      attacksThisTurn: isStaleRound ? 0 : Math.max(0, Number(tracking?.attacks_this_turn ?? 0) || 0),
      weaponUsesThisRound: (!isStaleRound && rawUses && typeof rawUses === "object") ? rawUses : {}
    };
  }

  static _getEquippedOneHandMeleeWeapons(actor, trackerContext = {}) {
    const { trackedActor } = this._resolveTrackerAuthority(actor, trackerContext);
    const weapons = [];
    for (const it of (trackedActor?.items ?? [])) {
      if (!it || it.type !== "weapon") continue;
      if (it.system?.equipped !== true) continue;
      const mode = getAttackModeFromWeapon(it);
      if (String(mode ?? "").toLowerCase() !== "melee") continue;
      const hands = getEffectiveWeaponHands(it);
      const eff = Number(hands?.effectiveHands ?? 0);
      if (eff !== 1) continue;
      weapons.push(it);
    }
    return weapons;
  }

  static _dualFighterWeaponIds(actor, trackerContext = {}) {
    const weapons = this._getEquippedOneHandMeleeWeapons(actor, trackerContext);
    if (weapons.length < 2) return [];
    return [String(weapons[0].id), String(weapons[1].id)];
  }

  static _readOverride(actor, path, trackerContext = {}) {
    const normalizedContext = buildAttackTrackerContext(actor, trackerContext);
    const trackedActor = actor ?? normalizedContext.trackerOwner ?? normalizedContext.trackerDocument ?? this._resolveTrackerActor(actor, normalizedContext);
    if (!trackedActor) return null;
    try {
      const key = path.replace(`flags.${FLAG_SCOPE}.`, "");
      const v = getFlagValueWithFallback(trackedActor, key);
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    } catch (_e) {
      return null;
    }
  }

  static getOverrides(actor, trackerContext = {}) {
    const snapshot = this._buildTrackerSnapshot(actor, trackerContext);
    this._recordTrackerPhase(actor, {
      type: "read",
      reason: "get-overrides",
      eventType: "attack-read",
      phase: "read-overrides",
      trackerContext: snapshot.trackerContext,
      trackedActor: snapshot.trackedActor,
      details: {
        returnedCurrentOverride: snapshot.overrides.current,
        returnedMaxOverride: snapshot.overrides.max
      }
    });
    return snapshot.overrides;
  }

  static async _applyTrackerUpdate(actor, updates, { reason = "update", trackerContext = {} } = {}) {
    const authority = this._resolveTrackerAuthority(actor, trackerContext);
    const normalizedContext = authority.trackerContext;
    const trackedActor = authority.trackedActor;
    const trackerOwner = authority.trackerOwner;
    if (!trackerOwner || !updates || typeof updates !== "object") return false;

    this._recordResolutionDiagnostic(actor, normalizedContext, trackedActor, { reason });

    const { requestUpdateDocument } = await import("../../utils/authority-proxy.js");
    const ok = await requestUpdateDocument(trackerOwner, updates);
    if (!ok) {
      console.warn("UESRPG | AttackTracker update failed", {
        actor: trackerOwner?.uuid ?? trackedActor?.uuid ?? null,
        reason,
        updateKeys: Object.keys(updates ?? {})
      });
      _trackerDebug("update rejected", {
        actor: trackerOwner?.uuid ?? trackedActor?.uuid ?? null,
        sourceActor: actor?.uuid ?? null,
        reason,
        updates
      });
      recordAttackTrackerDiagnostic({
        type: "write",
        source: normalizedContext?.source ?? "attack-tracker",
        sourceTag: normalizedContext?.sourceTag ?? normalizedContext?.source ?? "attack-tracker",
        reason,
        eventType: "attack-write",
        attackTraceId: normalizedContext?.attackTraceId ?? null,
        phase: normalizedContext?.phase ?? reason,
        attackMode: normalizedContext?.attackMode ?? null,
        updateMode: this._getTrackerUpdateMode(trackedActor),
        sourceActor: actor,
        resolvedActor: trackedActor,
        combatantActor: normalizedContext?.combatantActor ?? null,
        combatantId: normalizedContext?.combatantId ?? null,
        resolutionSource: normalizedContext?.resolutionSource ?? null,
        authorityState: normalizedContext?.authorityState ?? null,
        ambiguityState: normalizedContext?.ambiguityState ?? null,
        explicitTokenUuid: normalizedContext?.tokenUuid ?? null,
        trackerDocument: trackerOwner ?? normalizedContext?.trackerDocument ?? trackedActor ?? null,
        combatId: normalizedContext?.combat?.id ?? game?.combat?.id ?? null,
        round: this._getCombatRound(),
        turn: this._getCombatTurn(),
        details: {
          ok: false,
          updateKeys: Object.keys(updates ?? {}),
          updatePayload: foundry.utils.deepClone(updates ?? {})
        }
      });
      return false;
    }

    const postSnapshot = this._buildTrackerSnapshot(actor, normalizedContext);
    recordAttackTrackerDiagnostic({
      type: "write",
      source: normalizedContext?.source ?? "attack-tracker",
      sourceTag: normalizedContext?.sourceTag ?? normalizedContext?.source ?? "attack-tracker",
      reason,
      eventType: "attack-write",
      attackTraceId: normalizedContext?.attackTraceId ?? null,
      phase: normalizedContext?.phase ?? reason,
      attackMode: normalizedContext?.attackMode ?? null,
      updateMode: this._getTrackerUpdateMode(trackerOwner),
      sourceActor: actor,
      resolvedActor: trackedActor,
      combatantActor: normalizedContext?.combatantActor ?? null,
      combatantId: normalizedContext?.combatantId ?? null,
      resolutionSource: normalizedContext?.resolutionSource ?? null,
        authorityState: normalizedContext?.authorityState ?? null,
        ambiguityState: normalizedContext?.ambiguityState ?? null,
        explicitTokenUuid: normalizedContext?.tokenUuid ?? null,
        trackerDocument: trackerOwner ?? normalizedContext?.trackerDocument ?? trackedActor ?? null,
        combatId: normalizedContext?.combat?.id ?? game?.combat?.id ?? null,
      round: this._getCombatRound(),
      turn: this._getCombatTurn(),
      details: {
        ok: true,
        updateKeys: Object.keys(updates ?? {}),
        updatePayload: foundry.utils.deepClone(updates ?? {}),
        rawCurrent: postSnapshot.rawCurrent,
        rawTurnCurrent: postSnapshot.rawTurnCurrent,
        rawMax: postSnapshot.rawLimit,
        overrideCurrent: postSnapshot.rawOverrideCurrent,
        overrideMax: postSnapshot.rawOverrideMax,
        computedCurrent: postSnapshot.current,
        computedMax: postSnapshot.max
      }
    });
    this._emitTrackerChanged(actor, {
      reason,
      sourceActor: actor,
      resolvedActor: trackedActor,
      trackerContext: normalizedContext
    });
    return true;
  }

  /**
   * Increment attack count for the current round/turn
   * @param {Actor} actor - The actor making the attack
   * @returns {Promise<void>}
   */
  static async incrementAttacks(actor, trackerContext = {}) {
    const authority = this._resolveTrackerAuthority(actor, trackerContext);
    const normalizedContext = authority.trackerContext;
    const trackedActor = authority.trackedActor;
    if (!trackedActor) return;
    if (!isActorInStartedCombatEncounter(trackedActor, {
      combat: normalizedContext?.combat ?? game?.combat ?? null,
      tokenUuid: normalizedContext?.tokenUuid ?? null,
      combatantId: normalizedContext?.combatantId ?? null
    })) return;
    this._recordTrackerPhase(actor, {
      type: "phase",
      reason: "increment-request",
      eventType: "attack-trace",
      phase: "increment-request",
      trackerContext: normalizedContext,
      trackedActor
    });
    
    // RAW (Invisibility): Attacking breaks invisibility. Fire and forget (non-blocking).
    if (game.user?.isGM && Boolean(trackedActor.system?.traits?.condition?.invisible)) {
      import("../magic/services/condition-triggers.js").then(({ breakInvisibility }) => {
        breakInvisibility(trackedActor, "attack").catch(_e => {});
      }).catch(_e => {});
    }

    const scoped = this._getRoundScopedTracking(trackedActor, normalizedContext);
    const nextCount = scoped.attacksThisRound + 1;
    const overrides = this.getOverrides(trackedActor, normalizedContext);
    const updates = this._buildStateUpdateData(authority, {
      attacksThisRound: nextCount,
      attacksThisTurn: scoped.attacksThisTurn,
      lastResetRound: scoped.currentRound,
      lastResetTurn: scoped.currentTurn
    });
    if (overrides.current != null) {
      updates[ATTACK_OVERRIDE_CURRENT_PATH] = nextCount;
    }

    await this._applyTrackerUpdate(actor, updates, { reason: "increment", trackerContext: normalizedContext });
  }

  /**
   * Record a weapon use for this round.
   * This supports talents that depend on "use each weapon at least once" constraints.
   *
   * Contract:
   *  - We store uses keyed by embedded Item ID (not UUID) to avoid unsafe update paths.
   *
   * @param {Actor} actor
   * @param {string|null} weaponUuidOrId
   * @returns {Promise<string>} resolved embedded Item id (or "")
   */
  static async recordWeaponUse(actor, weaponUuidOrId, trackerContext = {}) {
    const authority = this._resolveTrackerAuthority(actor, trackerContext);
    const normalizedContext = authority.trackerContext;
    const trackedActor = authority.trackedActor;
    if (!trackedActor) return "";
    if (!isActorInStartedCombatEncounter(trackedActor, {
      combat: normalizedContext?.combat ?? game?.combat ?? null,
      tokenUuid: normalizedContext?.tokenUuid ?? null,
      combatantId: normalizedContext?.combatantId ?? null
    })) return "";
    this._recordTrackerPhase(actor, {
      type: "phase",
      reason: "weapon-use-request",
      eventType: "attack-trace",
      phase: "weapon-use-request",
      trackerContext: normalizedContext,
      trackedActor,
      details: { weaponUuidOrId: String(weaponUuidOrId ?? "") }
    });
    const raw = String(weaponUuidOrId ?? "").trim();
    if (!raw) return "";

    let weaponId = raw;
    if (raw.includes(".")) {
      try {
        const doc = await fromUuid(raw);
        if (doc?.documentName === "Item") weaponId = String(doc.id);
      } catch (_e) {
        // keep raw
      }
    }

    if (!weaponId || weaponId.includes(".")) return "";
    const scoped = this._getRoundScopedTracking(trackedActor, normalizedContext);
    const nextUses = { ...scoped.weaponUsesThisRound };
    nextUses[weaponId] = (Number(nextUses[weaponId] ?? 0) || 0) + 1;

    await this._applyTrackerUpdate(actor, this._buildStateUpdateData(authority, {
      weaponUsesThisRound: nextUses,
      lastResetRound: scoped.currentRound,
      lastResetTurn: scoped.currentTurn
    }), { reason: "weapon-use", trackerContext: normalizedContext });

    return weaponId;
  }
  
  /**
   * Get current attack count for this round
   * @param {Actor} actor - The actor to check
   * @returns {number} - Number of attacks made this round
   */
  static getAttackCount(actor, trackerContext = {}) {
    if (!actor) return 0;
    const snapshot = this._buildTrackerSnapshot(actor, trackerContext);
    this._recordTrackerPhase(actor, {
      type: "read",
      reason: "get-attack-count",
      eventType: "attack-read",
      phase: "read-count",
      trackerContext: snapshot.trackerContext,
      trackedActor: snapshot.trackedActor
    });
    return snapshot.current;
  }

  /**
   * Get weapon-use counts for the current round.
   *
   * @param {Actor} actor
   * @returns {Record<string, number>}
   */
  static getWeaponUsesThisRound(actor, trackerContext = {}) {
    if (!actor) return {};
    return this._getRoundScopedTracking(actor, trackerContext).weaponUsesThisRound;
  }

  static getTrackerViewState(actor, context = {}, trackerContext = {}) {
    const snapshot = this._buildTrackerSnapshot(actor, trackerContext, context);
    this._recordTrackerPhase(actor, {
      type: "read",
      reason: "get-tracker-view",
      eventType: "attack-read",
      phase: "read-tracker-view",
      trackerContext: snapshot.trackerContext,
      trackedActor: snapshot.trackedActor,
      limitContext: context
    });
    return {
      trackerContext: snapshot.trackerContext,
      trackedActor: snapshot.trackedActor,
      trackerCombatant: snapshot.trackerCombatant,
      trackerOwner: snapshot.trackerOwner,
      current: snapshot.current,
      max: snapshot.max,
      overrides: snapshot.overrides,
      rawCurrent: snapshot.rawCurrent,
      rawTurnCurrent: snapshot.rawTurnCurrent,
      rawMax: snapshot.rawLimit,
      rawOverrideCurrent: snapshot.rawOverrideCurrent,
      rawOverrideMax: snapshot.rawOverrideMax,
      rawLastResetRound: snapshot.rawLastResetRound,
      rawLastResetTurn: snapshot.rawLastResetTurn,
      rawWeaponUses: snapshot.rawWeaponUses
    };
  }
  
  /**
   * Reset attack counter (called on round change)
   * @param {Actor} actor - The actor to reset
   * @returns {Promise<void>}
   */
  static async resetAttacks(actor, trackerContext = {}) {
    const authority = this._resolveTrackerAuthority(actor, trackerContext);
    const normalizedContext = authority.trackerContext;
    const trackedActor = authority.trackedActor;
    if (!trackedActor) return;
    this._recordTrackerPhase(actor, {
      type: "phase",
      reason: "reset-request",
      eventType: "attack-reset",
      phase: "reset-request",
      trackerContext: normalizedContext,
      trackedActor
    });
    const updates = this._buildResetUpdateData(trackedActor, normalizedContext);
    await this._applyTrackerUpdate(actor, updates, { reason: "reset", trackerContext: normalizedContext });
  }

  static _buildResetUpdateData(actor, trackerContext = {}) {
    const authority = this._resolveTrackerAuthority(actor, trackerContext);
    const normalizedContext = authority.trackerContext;
    const trackedActor = authority.trackedActor;
    const currentRound = this._getCombatRound();
    const currentTurn = this._getCombatTurn();
    const updates = this._buildStateUpdateData(authority, {
      attacksThisRound: 0,
      attacksThisTurn: 0,
      lastResetRound: currentRound,
      lastResetTurn: currentTurn,
      weaponUsesThisRound: {}
    });
    if (this.getOverrides(trackedActor, normalizedContext).current != null) {
      updates[ATTACK_OVERRIDE_CURRENT_PATH] = 0;
    }
    return updates;
  }

  /**
   * Compute per-actor maximum attacks for the current round.
   *
   * Priority:
   * 1) GM max override flag
   * 2) Talent baseline (Dual Wielder / Dual Fighter => 3)
   * 3) Default baseline (2)
   *
   * @param {Actor} actor
   * @param {{attackMode?: string, weaponId?: string|null, weaponUuid?: string|null}} [context]
   * @returns {number}
   */
  static getAttackLimit(actor, context = {}, trackerContext = {}) {
    const snapshot = this._buildTrackerSnapshot(actor, trackerContext, context);
    this._recordTrackerPhase(actor, {
      type: "read",
      reason: "get-attack-limit",
      eventType: "attack-read",
      phase: "read-limit",
      trackerContext: snapshot.trackerContext,
      trackedActor: snapshot.trackedActor,
      limitContext: context
    });
    return snapshot.max;
  }

  static async setCurrentAttacks(actor, currentValue, trackerContext = {}) {
    const authority = this._resolveTrackerAuthority(actor, trackerContext);
    const normalizedContext = authority.trackerContext;
    const trackedActor = authority.trackedActor;
    if (!trackedActor) return false;
    const current = Math.max(0, Math.floor(Number(currentValue) || 0));
    const currentRound = this._getCombatRound();
    const currentTurn = this._getCombatTurn();
    this._recordTrackerPhase(actor, {
      type: "phase",
      reason: "set-current-request",
      eventType: "attack-write",
      phase: "set-current-request",
        trackerContext: normalizedContext,
        trackedActor,
        details: { requestedCurrent: current }
      });
    return this._applyTrackerUpdate(actor, {
      ...this._buildStateUpdateData(authority, {
        attacksThisRound: current,
        lastResetRound: currentRound,
        lastResetTurn: currentTurn
      }),
      [ATTACK_OVERRIDE_CURRENT_PATH]: current
      }, { reason: "set-current", trackerContext: normalizedContext });
  }

  static async adjustCurrentAttacks(actor, delta = 0, trackerContext = {}) {
    const d = Number(delta) || 0;
    return this.setCurrentAttacks(actor, this.getAttackCount(actor, trackerContext) + d, trackerContext);
  }

  static async setAttackLimitOverride(actor, limitValue, trackerContext = {}) {
    const authority = this._resolveTrackerAuthority(actor, trackerContext);
    const normalizedContext = authority.trackerContext;
    const trackedActor = authority.trackedActor;
    if (!trackedActor) return false;
    const limit = Math.max(1, Math.floor(Number(limitValue) || 1));
    this._recordTrackerPhase(actor, {
      type: "phase",
      reason: "set-max-request",
      eventType: "attack-write",
      phase: "set-max-request",
        trackerContext: normalizedContext,
        trackedActor,
        details: { requestedMax: limit }
      });
    return this._applyTrackerUpdate(actor, { [ATTACK_OVERRIDE_MAX_PATH]: limit }, { reason: "set-max", trackerContext: normalizedContext });
  }

  static async adjustAttackLimitOverride(actor, delta = 0, trackerContext = {}) {
    const d = Number(delta) || 0;
    const currentLimit = this.getAttackLimit(actor, {}, trackerContext);
    return this.setAttackLimitOverride(actor, currentLimit + d, trackerContext);
  }
  
  /**
   * Check if actor has exceeded the 2 attack limit
   * @param {Actor} actor - The actor to check
   * @returns {boolean} - True if >= 2 attacks made
   */
  static hasExceededLimit(actor, context = {}, trackerContext = {}) {
    const normalizedContext = buildAttackTrackerContext(actor, trackerContext);
    const trackedActor = normalizedContext.trackerDocument ?? normalizedContext.combatantActor ?? actor ?? null;
    if (!isActorInStartedCombatEncounter(trackedActor, {
      combat: normalizedContext?.combat ?? game?.combat ?? null,
      tokenUuid: normalizedContext?.tokenUuid ?? null,
      combatantId: normalizedContext?.combatantId ?? null
    })) return false;
    const limit = this.getAttackLimit(actor, context, trackerContext);
    return this.getAttackCount(actor, trackerContext) >= limit;
  }
  
  /**
   * Get warning message for attack limit
   * @param {Actor} actor - The actor to check
   * @returns {string} - Warning message or empty string
   */
  static getLimitWarning(actor, context = {}, trackerContext = {}) {
    const normalizedContext = buildAttackTrackerContext(actor, trackerContext);
    const trackedActor = normalizedContext.trackerDocument ?? normalizedContext.combatantActor ?? actor ?? null;
    if (!isActorInStartedCombatEncounter(trackedActor, {
      combat: normalizedContext?.combat ?? game?.combat ?? null,
      tokenUuid: normalizedContext?.tokenUuid ?? null,
      combatantId: normalizedContext?.combatantId ?? null
    })) return "";
    const count = this.getAttackCount(actor, trackerContext);
    const limit = this.getAttackLimit(actor, context, trackerContext);

    if (count === limit) {
      return `Maximum attacks (${limit}) reached this round.`;
    }
    if (count > limit) {
      return `Attack limit exceeded (${count}/${limit}) this round. This attack may violate RAW.`;
    }
    return "";
  }
}

/**
 * Hook into combat updates to auto-reset attack counters on round changes
 */
let _combatHooksRegistered = false;
const _combatRoundState = new Map();

function _setCombatRoundState(combat) {
  if (!combat?.id) return;
  _combatRoundState.set(String(combat.id), Number(combat.round ?? 0));
}

function _getCombatRoundState(combat) {
  if (!combat?.id) return null;
  return _combatRoundState.get(String(combat.id)) ?? null;
}

async function _handleCombatBoundaryAttackReset(payload) {
  if (!game.user?.isGM) return;
  if (payload?.source !== "combat") return;
  if (payload?.combat?.phase && payload.combat.phase !== "post") return;

  const combat = game?.combat ?? null;
  if (!combat?.id) return;
  if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;

  const prevRound = _getCombatRoundState(combat);
  const nextRound = Number(combat.round ?? 0);
  if (prevRound !== null && prevRound === nextRound) return;

  _setCombatRoundState(combat);

  if (isAttackTrackerEagerResetSkipped()) {
    recordAttackTrackerDiagnostic({
      type: "reset",
      source: "combat-boundary",
      sourceTag: "combat-boundary",
      reason: "reset-skipped-policy",
      eventType: "attack-reset",
      phase: "boundary-reset-skipped",
      combatId: combat.id,
      round: combat.round,
      turn: combat.turn,
      details: {
        payloadSource: payload?.source ?? null,
        previousRound: prevRound,
        nextRound,
      }
    });
    return;
  }

  const batchRows = [];
  for (const combatant of combat.combatants) {
    const combatantActor = combatant?.token?.actor ?? combatant?.actor ?? null;
    if (combatantActor) {
      const trackerContext = {
        combatantId: combatant.id,
        tokenUuid: combatant?.token?.uuid ?? combatant?.token?.document?.uuid ?? null,
        trackerCombatant: combatant,
        trackerOwner: combatant,
        trackerDocument: combatantActor,
        combatantActor,
        source: "combat-boundary",
        sourceTag: "combat-boundary",
        phase: "boundary-reset-build"
      };
      batchRows.push({
        docOrUuid: combatant,
        updateData: AttackTracker._buildResetUpdateData(combatantActor, trackerContext),
        trackerContext
      });
    }
  }
  if (!batchRows.length) return;

  const result = await requestBatchUpdateDocuments(batchRows);
  const failedUuidSet = new Set((result?.failures ?? []).map((f) => String(f?.uuid ?? "")).filter(Boolean));
  for (const row of batchRows) {
    const combatant = row.docOrUuid;
    const actor = combatant?.token?.actor ?? combatant?.actor ?? null;
    const uuid = String(combatant?.uuid ?? "");
    if (failedUuidSet.size && failedUuidSet.has(uuid)) continue;
    AttackTracker._emitTrackerChanged(actor, { reason: "reset", trackerContext: row.trackerContext });
    AttackTracker._recordTrackerPhase(actor, {
      type: "reset",
      reason: "boundary-reset-applied",
      eventType: "attack-reset",
      phase: "boundary-reset-applied",
      trackerContext: {
        ...row.trackerContext,
        phase: "boundary-reset-applied"
      },
      details: {
        previousRound: prevRound,
        nextRound,
        batchOk: result?.ok === true,
      }
    });
  }
  if (result?.ok === true) return;

  for (const row of batchRows) {
    const combatant = row.docOrUuid;
    const actor = combatant?.token?.actor ?? combatant?.actor ?? null;
    const uuid = String(combatant?.uuid ?? "");
    if (failedUuidSet.size && !failedUuidSet.has(uuid)) continue;
    await AttackTracker.resetAttacks(actor, {
      ...row.trackerContext,
      phase: "boundary-reset-fallback"
    });
  }
}

if (!_combatHooksRegistered) {
  _combatHooksRegistered = true;

  if (game?.combat) _setCombatRoundState(game.combat);

  Hooks.on("createCombat", (combat) => {
    _setCombatRoundState(combat);
  });

  Hooks.on("deleteCombat", (combat) => {
    if (!combat?.id) return;
    _combatRoundState.delete(String(combat.id));
  });
  registerCombatBoundaryConsumer({
    id: "attack-tracker",
    // Attack reset is a late round-boundary cleanup and can no-op under lazy reset mode.
    order: 350,
    handle: _handleCombatBoundaryAttackReset
  });

  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
    if (noteCombatBoundaryLegacyFallbackSkip("attack-tracker", payload)) return;
    await _handleCombatBoundaryAttackReset(payload);
  });
}
