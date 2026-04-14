/**
 * src/core/conditions/bleeding.js
 *
 * Chapter 5: Bleeding (X) condition automation.
 *
 * RAW summary (implemented):
 *  - At the start of the bleeding character's turn, they take X damage (bypasses AR/resistance).
 *  - Then X is reduced by 1.
 *  - If X reaches 0, the Bleeding condition is removed.
 *  - If multiple Bleeding effects exist, their values are combined into one.
 *
 * Partial (known limitation vs RAW):
 *  - Healing reduces X by the amount of HP actually restored by applyHealing().
 *    (The RAW text counts overheal; current system healing hook only reports actual HP restored.)
 *
 * This module does not mutate documents directly; it uses embedded document APIs.
 */

import { adjustConditionValue, getConditionValue, hasCondition, removeCondition, setConditionValue } from "./condition-engine.js";
import { applyDamage } from "../combat/damage-automation.js";
import { registerCombatBoundaryConsumer, noteCombatBoundaryLegacyFallbackSkip } from "../time/combat-boundary-orchestrator.js";
const CONDITION_KEY = "bleeding";

let _registered = false;

/** @type {Map<string, {round: number, turn: number, combatantId: string|null}>} */
const _combatState = new Map();

async function _handleCombatBoundaryBleeding(payload) {
  if (game?.user?.isGM !== true) return;
  if (payload?.source !== "combat") return;
  if (payload?.combat?.phase && payload.combat.phase !== "post") return;

  const combat = game?.combat ?? null;
  if (!combat?.id) return;
  if (payload?.combat?.id && String(payload.combat.id) !== String(combat.id)) return;

  const prev = _getState(combat);
  const next = {
    round: Number(combat.round ?? 0),
    turn: Number(combat.turn ?? 0),
    combatantId: String(combat.combatantId ?? "") || null
  };

  const changed =
    !prev ||
    prev.round !== next.round ||
    prev.turn !== next.turn ||
    prev.combatantId !== next.combatantId;

  _combatState.set(String(combat.id), next);
  if (!changed) return;

  const cId = next.combatantId;
  if (!cId) return;

  const combatant = combat.combatants?.get?.(cId) ?? null;
  const actor = combatant?.actor ?? null;
  if (!actor) return;

  try {
    await tickBleedingStartTurn(actor);
  } catch (err) {
    console.warn("UESRPG | Bleeding | tick failed", err);
  }
}

function _getState(combat) {
  if (!combat?.id) return null;
  return _combatState.get(String(combat.id)) ?? null;
}

function _setState(combat) {
  if (!combat?.id) return;
  _combatState.set(String(combat.id), {
    round: Number(combat.round ?? 0),
    turn: Number(combat.turn ?? 0),
    combatantId: String(combat.combatantId ?? "") || null
  });
}

/**
 * Apply Bleeding (X) to an actor, stacking with any existing Bleeding.
 *
 * @param {Actor} actor
 * @param {number} x
 * @param {object} options
 * @param {string} options.source
 */
export async function applyBleeding(actor, x, { source = "Bleeding" } = {}) {
  const amt = Math.floor(Number(x) || 0);
  if (!actor || amt <= 0) return null;
  return adjustConditionValue(actor, CONDITION_KEY, amt, { source });
}

/**
 * Reduce Bleeding (X) by an amount (e.g., from healing).
 *
 * @param {Actor} actor
 * @param {number} amount
 */
export async function reduceBleeding(actor, amount) {
  const amt = Math.floor(Number(amount) || 0);
  if (!actor || amt <= 0) return;
  const current = Math.max(0, Number(getConditionValue(actor, CONDITION_KEY) ?? 0) || 0);
  if (current <= 0) return;
  const next = Math.max(0, current - amt);
  if (next <= 0) return removeCondition(actor, CONDITION_KEY);
  return setConditionValue(actor, CONDITION_KEY, next);
}

/**
 * Tick bleeding at the start of the actor's turn (GM-only).
 */
export async function tickBleedingStartTurn(actor) {
  if (!actor) return;
  const value = Math.max(0, Number(getConditionValue(actor, CONDITION_KEY) ?? 0) || 0);
  if (value <= 0) return;

  // Apply X damage, bypassing all reductions.
  try {
    await applyDamage(actor, value, "physical", {
      ignoreReduction: true,
      source: `Bleeding (${value})`,
      hitLocation: "Body"
    });
  } catch (err) {
    console.warn("UESRPG | Bleeding | applyDamage failed", err);
  }

  const next = Math.max(0, value - 1);
  if (next <= 0) return removeCondition(actor, CONDITION_KEY);
  return setConditionValue(actor, CONDITION_KEY, next);
}

/**
 * Register Bleeding hooks once.
 */
export function registerBleeding() {
  if (_registered) return;
  _registered = true;

  // Combat ticker (start-of-turn).
  if (game?.combat) _setState(game.combat);

  Hooks.on("createCombat", (combat) => _setState(combat));

  Hooks.on("deleteCombat", (combat) => {
    if (!combat?.id) return;
    _combatState.delete(String(combat.id));
  });

  registerCombatBoundaryConsumer({
    id: "bleeding",
    // Start-of-turn bleeding follows broader condition automation but precedes later cleanup.
    order: 175,
    handle: _handleCombatBoundaryBleeding
  });

  Hooks.on("uesrpg.combatTimeChanged", async (payload) => {
    if (noteCombatBoundaryLegacyFallbackSkip("bleeding", payload)) return;
    await _handleCombatBoundaryBleeding(payload);
  });

  // Healing reduction (GM only).
  Hooks.on("uesrpgHealingApplied", async (actor, data) => {
    try {
      if (game?.user?.isGM !== true) return;
      if (!actor) return;
      const healing = Math.floor(Number(data?.healing ?? 0) || 0);
      if (healing <= 0) return;
      await reduceBleeding(actor, healing);
    } catch (err) {
      console.warn("UESRPG | Bleeding | healing reduction failed", err);
    }
  });
}

export const BleedingAPI = {
  applyBleeding,
  reduceBleeding
};
