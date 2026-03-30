/**
 * @module traits/mobility-talents
 * @description Automation helpers for Mobility talents (Chapter 4):
 *  - Armored Agility: reduce Acrobatics armor-class penalties
 *  - Assassin Strike: target cannot make AoO against you this turn (enforced on AoO action entrypoint)
 *  - Hard Target: activated; ranged attacks against you suffer -20 until your next turn
 *  - Step Aside: Evade reactions vs AoO cost 0 AP unless you fail the Evade test
 *  - Swashbuckler: ignore limits on combat-related tests imposed by Athletics/Acrobatics ranks
 */

import { hasTalent, getSkillRank, normalizeTalentKey } from "./talents-api.js";
import { createOrUpdateStatusEffect } from "../active-effects/status-effect.js";
import { buildEffectDuration } from "../time/effect-duration.js";
import { _lower } from "./_primitives.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { evaluateAEModifierKeys, getActorCapabilityFlag } from "../active-effects/modifier-evaluator.js";

function _asInt(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

/**
 * Compute the Armored Agility TN bonus to apply to Acrobatics tests.
 *
 * RAW (Chapter 4): reduce Acrobatics test penalties gained from armor class by
 * (Acrobatics rank - 1) * 10.
 *
 * @param {Actor} actor
 * @param {object} mobility - actor.system.mobility
 * @returns {number} Positive TN bonus to add (0 if not applicable)
 */
export function getArmoredAgilityAcrobaticsBonus(actor, mobility = null) {
  if (!actor || !hasTalent(actor, "armoredagility")) return 0;

  const rank = Math.max(0, getSkillRank(actor, "Acrobatics"));
  const reduction = Math.max(0, (rank - 1) * 10);
  if (!reduction) return 0;

  const m = mobility ?? actor.system?.mobility ?? {};
  let armorPenalty = 0;

  // Armor-class penalties that can affect Acrobatics:
  armorPenalty += Number(m?.allTestPenalty ?? 0) || 0;
  armorPenalty += Number(m?.skillTestPenalties?.acrobatics ?? 0) || 0;
  armorPenalty += Number(m?.agilityTestPenalty ?? 0) || 0; // Acrobatics is Agility-based

  if (armorPenalty >= 0) return 0;
  return Math.min(reduction, Math.abs(armorPenalty));
}

/** @private */
function isAttackOfOpportunityLabel(label) {
  return _lower(label).includes("attack of opportunity");
}

/**
 * Step Aside (Chapter 4):
 * Evade reactions against attacks of opportunity cost 0 AP unless the character fails the associated Evade test.
 *
 * @param {object} params
 * @param {Actor} params.defender
 * @param {string} params.defenseType
 * @param {string|null} params.attackerLabel
 * @returns {boolean}
 */
export function shouldDeferEvadeApForStepAside({ defender, defenseType, attackerLabel = null } = {}) {
  if (!defender) return false;
  if (_lower(defenseType) !== "evade") return false;
  if (!isAttackOfOpportunityLabel(attackerLabel)) return false;
  const aeResolved = evaluateAEModifierKeys(defender, ["system.modifiers.combat.evadeAoOCost"], {
    context: { defenseType: "evade", attackerLabel: String(attackerLabel ?? "") },
    enforceConditions: true,
    dedupeByOrigin: true
  });
  const evadeAoOCost = Number(aeResolved?.["system.modifiers.combat.evadeAoOCost"] ?? 0) || 0;
  if (evadeAoOCost <= 0) return true;
  return hasTalent(defender, "stepaside");
}

/**
 * Apply the "Hard Target" activated effect to an actor.
 *
 * RAW (Chapter 4): If the character takes the Dash action and moves at least half their base Speed,
 * ranged attacks against them until the start of their next turn suffer -20.
 *
 * Matrix note: activation is manual (user activates the talent).
 *
 * This function only applies the effect marker. The attack TN penalty is enforced in the opposed
 * attack pipeline by checking for the enabled effect key.
 *
 * @param {Actor} actor
 * @returns {Promise<ActiveEffect|null>}
 */
export async function activateHardTargetEffect(actor) {
  if (!actor) return null;

  const combat = game?.combat ?? null;
  const inCombat = Boolean(combat?.started);
  if (!inCombat) {
    ui.notifications?.warn?.("Hard Target requires an active combat to determine its duration.");
    return null;
  }

  // Expire at the start of the actor's next turn (system turn ticker cleanup).
  let combatant = null;
  try {
    if (typeof combat.getCombatantsByActor === "function") {
      const arr = combat.getCombatantsByActor(actor);
      combatant = Array.isArray(arr) ? (arr[0] ?? null) : null;
    } else {
      const combatants = Array.from(combat.combatants ?? []);
      combatant = combatants.find(c => c?.actor?.id === actor.id || c?.actorId === actor.id) ?? null;
    }
  } catch (_e) {
    combatant = null;
  }

  if (!combatant?.id) {
    ui.notifications?.warn?.("Hard Target requires the actor to be a combatant in the active combat.");
    return null;
  }

  const duration = buildEffectDuration({ actor, rounds: 1, preferCombat: true });
  return await createOrUpdateStatusEffect(actor, {
    name: "Hard Target",
    img: "systems/uesrpg-3ev4/images/Icons/hardTarget.webp",
    duration,
    changes: [],
    flags: {
      uesrpg: {
        key: "hardTarget",
        source: "talent",
        expiresOnTurnStart: true,
        expiresCombatId: String(combat.id ?? ""),
        expiresCombatantId: String(combatant.id ?? "")
      }
    }
  });
}

/**
 * Record Assassin Strike suppression on a defender actor so they cannot make AoO vs the attacker this turn.
 *
 * Stored under `flags.uesrpg-3ev4.combat.aOOBlocks` as a bounded array.
 *
 * @param {Actor} defender
 * @param {{attackerUuid: string, combatId: string|null, round: number, turn: number}} ctx
 * @returns {Promise<void>}
 */
export async function recordAssassinStrikeAoOBlock(defender, { attackerUuid, combatId = null, round = 0, turn = 0 } = {}) {
  if (!defender || !attackerUuid) return;
  const scope = "uesrpg-3ev4";
  const key = "combat.aOOBlocks";

  const now = Date.now();
  const entry = {
    source: "assassinstrike",
    attackerUuid: String(attackerUuid),
    combatId: combatId ? String(combatId) : null,
    round: _asInt(round, 0),
    turn: _asInt(turn, 0),
    at: now
  };

  const prev = defender.getFlag(scope, key);
  const list = Array.isArray(prev) ? prev.slice() : [];

  // Prune stale entries (keep last 50, and entries newer than 1 hour).
  const oneHour = 60 * 60 * 1000;
  const filtered = list.filter(e => (now - _asInt(e?.at, 0)) < oneHour).slice(-50);

  // Dedupe exact match
  const sig = `${entry.source}|${entry.attackerUuid}|${entry.combatId ?? ""}|${entry.round}|${entry.turn}`;
  const seen = new Set(filtered.map(e => `${String(e?.source ?? "")}|${String(e?.attackerUuid ?? "")}|${String(e?.combatId ?? "")}|${_asInt(e?.round, 0)}|${_asInt(e?.turn, 0)}`));
  if (!seen.has(sig)) filtered.push(entry);

  await requestUpdateDocument(defender, { [`flags.${scope}.${key}`]: filtered });
}

/**
 * Check whether an actor is blocked from making an AoO against a target right now.
 *
 * @param {Actor} actor - the would-be AoO attacker
 * @param {Actor} target - the intended AoO target
 * @returns {boolean}
 */
export function isActorBlockedFromAoOAgainstTarget(actor, target) {
  if (!actor || !target) return false;

  // Global "noAoO" effects (e.g., Overwhelm advantage sets a flag-lane change on the actor).
  if (getActorCapabilityFlag(actor, `flags.${FLAG_SCOPE}.combat.noAoO`)) return true;

  // Target-scoped blocks (Assassin Strike).
  const scope = "uesrpg-3ev4";
  const key = "combat.aOOBlocks";
  const blocks = actor.getFlag(scope, key);
  const list = Array.isArray(blocks) ? blocks : [];
  if (!list.length) return false;

  const combat = (game.combat && game.combat.started) ? game.combat : null;
  const combatId = combat?.id ?? null;
  const round = _asInt(combat?.round, -1);
  const turn = _asInt(combat?.turn, -1);
  const currentActorUuid = combat?.combatant?.actor?.uuid ?? null;

  for (const e of list) {
    if (String(e?.source ?? "") !== "assassinstrike") continue;
    if (String(e?.attackerUuid ?? "") !== String(target.uuid)) continue;

    // Only enforce during the original attacker's turn (as per RAW wording).
    if (combatId && e?.combatId && String(e.combatId) !== String(combatId)) continue;
    if (_asInt(e?.round, -2) !== round) continue;
    if (_asInt(e?.turn, -2) !== turn) continue;
    if (currentActorUuid && String(currentActorUuid) !== String(target.uuid)) continue;
    return true;
  }

  return false;
}

/**
 * Swashbuckler (Chapter 4): ignore limits placed on combat-related skill tests
 * by Athletics/Acrobatics ranks, except when fighting underwater.
 *
 * @param {Actor} actor
 * @param {string} skillName
 * @param {{ignoreUnderwaterException?: boolean, context?: {movementAction?: string|null}}} [opts]
 * @returns {boolean}
 */
export function swashbucklerIgnoresCombatSkillRankLimits(actor, skillName, { ignoreUnderwaterException = false, context = {} } = {}) {
  if (!actor) return false;
  if (!hasTalent(actor, "swashbuckler")) return false;
  if (!ignoreUnderwaterException && String(context?.movementAction ?? "").trim().toLowerCase() === "swim") return false;
  const k = normalizeTalentKey(skillName);
  return k === "athletics" || k === "acrobatics";
}
