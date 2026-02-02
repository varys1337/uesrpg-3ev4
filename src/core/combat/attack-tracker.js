/**
 * src/core/combat/attack-tracker.js
 *
 * Track attacks made per round/turn for the UESRPG 3ev4 system.
 * According to RAW: "A character may make no more than two total attacks in a single round"
 */

import { hasTalent } from "../traits/talents-api.js";
import { getAttackModeFromWeapon, getEffectiveWeaponHands } from "./combat-utils.js";

export class AttackTracker {
  static _getCombatRound() {
    return game?.combat?.round ?? 0;
  }

  static _getCombatTurn() {
    return game?.combat?.turn ?? 0;
  }

  static _getTracking(actor) {
    return actor?.system?.combat_tracking ?? {
      attacks_this_round: 0,
      attacks_this_turn: 0,
      last_reset_round: 0,
      last_reset_turn: 0,
      // Non-breaking additive structure for per-weapon usage tracking.
      // Keys are embedded Item IDs (not UUIDs) to keep update paths safe.
      weapon_uses_this_round: {}
    };
  }

  static _getEquippedOneHandMeleeWeapons(actor) {
    const weapons = [];
    for (const it of (actor?.items ?? [])) {
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

  static _dualFighterWeaponIds(actor) {
    const weapons = this._getEquippedOneHandMeleeWeapons(actor);
    if (weapons.length < 2) return [];
    return [String(weapons[0].id), String(weapons[1].id)];
  }

  /**
   * Increment attack count for the current round/turn
   * @param {Actor} actor - The actor making the attack
   * @returns {Promise<void>}
   */
  static async incrementAttacks(actor) {
    if (!actor) return;

    const { requestUpdateDocument } = await import("../../utils/authority-proxy.js");
    
    // Ensure combat_tracking exists with safe defaults
    const tracking = this._getTracking(actor);
    
    const currentRound = this._getCombatRound();
    const currentTurn = this._getCombatTurn();
    
    // Reset if round has changed
    let attacks = tracking.attacks_this_round ?? 0;
    if (currentRound !== (tracking.last_reset_round ?? 0)) {
      attacks = 0;
    }
    
    attacks += 1;
    
    await requestUpdateDocument(actor, {
      "system.combat_tracking.attacks_this_round": attacks,
      "system.combat_tracking.last_reset_round": currentRound,
      "system.combat_tracking.last_reset_turn": currentTurn
    });
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
  static async recordWeaponUse(actor, weaponUuidOrId) {
    if (!actor) return "";
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

    const { requestUpdateDocument } = await import("../../utils/authority-proxy.js");

    const tracking = this._getTracking(actor);
    const currentRound = this._getCombatRound();
    const currentTurn = this._getCombatTurn();

    let uses = tracking.weapon_uses_this_round;
    if (!uses || typeof uses !== "object") uses = {};
    // Reset on round change.
    if (currentRound !== (tracking.last_reset_round ?? 0)) {
      uses = {};
    }

    const nextUses = { ...uses };
    nextUses[weaponId] = (Number(nextUses[weaponId] ?? 0) || 0) + 1;

    await requestUpdateDocument(actor, {
      "system.combat_tracking.weapon_uses_this_round": nextUses,
      "system.combat_tracking.last_reset_round": currentRound,
      "system.combat_tracking.last_reset_turn": currentTurn
    });

    return weaponId;
  }
  
  /**
   * Get current attack count for this round
   * @param {Actor} actor - The actor to check
   * @returns {number} - Number of attacks made this round
   */
  static getAttackCount(actor) {
    if (!actor) return 0;
    
    const tracking = actor.system?.combat_tracking;
    if (!tracking) return 0;
    
    const currentRound = this._getCombatRound();
    
    // If round has changed but not reset yet, return 0
    if (currentRound !== (tracking.last_reset_round ?? 0)) {
      return 0;
    }
    
    return tracking.attacks_this_round ?? 0;
  }

  /**
   * Get weapon-use counts for the current round.
   *
   * @param {Actor} actor
   * @returns {Record<string, number>}
   */
  static getWeaponUsesThisRound(actor) {
    if (!actor) return {};
    const tracking = actor.system?.combat_tracking;
    if (!tracking) return {};
    const currentRound = this._getCombatRound();
    if (currentRound !== (tracking.last_reset_round ?? 0)) return {};
    const uses = tracking.weapon_uses_this_round;
    if (!uses || typeof uses !== "object") return {};
    return uses;
  }
  
  /**
   * Reset attack counter (called on round change)
   * @param {Actor} actor - The actor to reset
   * @returns {Promise<void>}
   */
  static async resetAttacks(actor) {
    if (!actor) return;

    const { requestUpdateDocument } = await import("../../utils/authority-proxy.js");
    
    const currentRound = this._getCombatRound();
    const currentTurn = this._getCombatTurn();
    
    await requestUpdateDocument(actor, {
      "system.combat_tracking.attacks_this_round": 0,
      "system.combat_tracking.attacks_this_turn": 0,
      "system.combat_tracking.last_reset_round": currentRound,
      "system.combat_tracking.last_reset_turn": currentTurn,
      "system.combat_tracking.weapon_uses_this_round": {}
    });
  }

  /**
   * Compute per-actor maximum attacks for the current round.
   *
   * Dual Fighter (Chapter 4): while dual wielding two one-handed melee weapons,
   * raise the maximum melee attacks per round from 2 to 3 as long as, across
   * those attacks, each weapon is used to attack at least once.
   *
   * We treat this as a conditional 3rd attack allowance:
   *  - The first two attacks follow the normal limit.
   *  - The third is only allowed if, after taking the third with the selected
   *    weapon, both weapons will have been used at least once this round.
   *
   * @param {Actor} actor
   * @param {{attackMode?: string, weaponId?: string|null, weaponUuid?: string|null}} [context]
   * @returns {number}
   */
  static getAttackLimit(actor, context = {}) {
    const baseLimit = 2;
    if (!actor) return baseLimit;

    const attackMode = String(context?.attackMode ?? "").toLowerCase();
    if (attackMode && attackMode !== "melee") return baseLimit;

    if (!hasTalent(actor, "dualfighter")) return baseLimit;

    const weaponIds = this._dualFighterWeaponIds(actor);
    if (weaponIds.length < 2) return baseLimit;

    // Potentially 3, but conditional on weapon-use distribution.
    const count = this.getAttackCount(actor);
    if (count < 2) return 3;

    // For the 3rd (and beyond), we require the current weapon selection to satisfy
    // the "each weapon at least once" constraint.
    if (count >= 2) {
      const uses = this.getWeaponUsesThisRound(actor);
      const [w1, w2] = weaponIds;

      // Resolve current weapon to an embedded item ID, best-effort.
      const curId = String(context?.weaponId ?? "").trim();
      // If we don't have an embedded Item id, be conservative.
      if (!curId) return baseLimit;

      if (!curId || (curId !== w1 && curId !== w2)) return baseLimit;

      const would1 = (Number(uses[w1] ?? 0) || 0) + (curId === w1 ? 1 : 0);
      const would2 = (Number(uses[w2] ?? 0) || 0) + (curId === w2 ? 1 : 0);

      if (would1 >= 1 && would2 >= 1) return 3;
      return baseLimit;
    }

    return baseLimit;
  }
  
  /**
   * Check if actor has exceeded the 2 attack limit
   * @param {Actor} actor - The actor to check
   * @returns {boolean} - True if >= 2 attacks made
   */
  static hasExceededLimit(actor, context = {}) {
    const limit = this.getAttackLimit(actor, context);
    return this.getAttackCount(actor) >= limit;
  }
  
  /**
   * Get warning message for attack limit
   * @param {Actor} actor - The actor to check
   * @returns {string} - Warning message or empty string
   */
  static getLimitWarning(actor, context = {}) {
    const count = this.getAttackCount(actor);
    const limit = this.getAttackLimit(actor, context);

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

  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
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

    // Reset attack counters for all combatants in parallel
    const resetPromises = [];
    for (const combatant of combat.combatants) {
      if (combatant.actor) {
        resetPromises.push(AttackTracker.resetAttacks(combatant.actor));
      }
    }
    await Promise.all(resetPromises);
  });
}
