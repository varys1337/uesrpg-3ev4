/**
 * @module core/combat/dynamic-initiative
 *
 * Deterministic initiative preparation helpers used by:
 * - SystemCombat.rollInitiative (manual orchestration)
 * - SystemCombat._preUpdate dynamic round rerolls (non-interactive)
 */

import { hasTalent } from "../traits/talents-api.js";
import { listGroupActorsForMember } from "../traits/intellectual-talents.js";
import { resolveSurpriseState } from "./surprise-state.js";
import { resolveActorFromUuidSync } from "../../utils/uuid-cache.js";
import {
  compareProjectedInitiativeEntries,
  getCombatSensesInitiativeRating,
  getInitiativeTieBreakTuple,
} from "../documents/combat/initiative-helpers.js";

function _findDeterministicTacticianProvider(actor, initiativeByActorUuid) {
  if (!actor?.uuid || !initiativeByActorUuid) return null;
  const groups = listGroupActorsForMember(actor.uuid);
  if (!groups.length) return null;

  const providers = [];
  for (const group of groups) {
    const members = Array.isArray(group?.system?.members) ? group.system.members : [];
    for (const member of members) {
      const memberUuid = String(member?.id ?? "").trim();
      if (!memberUuid || memberUuid === actor.uuid) continue;
      const memberActor = resolveActorFromUuidSync(memberUuid);
      if (!memberActor) continue;
      if (!hasTalent(memberActor, "tactician")) continue;
      const ini = Number(initiativeByActorUuid.get(memberActor.uuid));
      if (!Number.isFinite(ini)) continue;
      providers.push({
        uuid: memberActor.uuid,
        name: String(memberActor.name ?? "Tactician"),
        initiative: ini
      });
    }
  }

  if (!providers.length) return null;
  providers.sort((a, b) => {
    if (a.initiative !== b.initiative) return b.initiative - a.initiative;
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.uuid.localeCompare(b.uuid);
  });
  return providers[0];
}

/**
 * Resolve one combatant's initiative using shared deterministic semantics.
 *
 * @param {Combat} combat
 * @param {Combatant} combatant
 * @param {object} [opts]
 * @param {boolean} [opts.useCombatSenses=false]
 * @param {{mode: "provider", initiative: number, tacticianName: string}|null} [opts.tacticianChoice=null]
 * @param {boolean} [opts.deterministicTactician=false]
 * @param {Map<string, number>} [opts.initiativeByActorUuid]
 * @returns {Promise<{initiative: number, formula: string, roll: Roll, choice: string, tacticianName: string|null, isSurprised: boolean}>}
 */
export async function resolveCombatantInitiative(combat, combatant, opts = {}) {
  const actor = combatant?.actor ?? null;
  if (!combatant || !actor) {
    return { initiative: Number.NEGATIVE_INFINITY, formula: "0", roll: null, choice: "invalid", tacticianName: null, isSurprised: false };
  }

  const surpriseState = resolveSurpriseState(actor, { combatContext: combat });
  const isSurprised = surpriseState?.onlyReactions === true;

  let tacticianChoice = opts?.tacticianChoice ?? null;
  if (!tacticianChoice && opts?.deterministicTactician === true) {
    const provider = _findDeterministicTacticianProvider(actor, opts?.initiativeByActorUuid);
    if (provider) {
      tacticianChoice = {
        mode: "provider",
        initiative: provider.initiative,
        tacticianName: provider.name
      };
    }
  }

  const useCombatSenses = Boolean(opts?.useCombatSenses) && !isSurprised && !tacticianChoice;
  const normalIR = Number(actor?.system?.initiative?.value ?? 0) || 0;
  const combatSensesIR = getCombatSensesInitiativeRating(actor);
  const ir = useCombatSenses ? combatSensesIR : normalIR;
  const dice = hasTalent(actor, "lightningreflexes") ? "2d6kh" : "1d6";

  const formula = tacticianChoice?.mode === "provider"
    ? `${Number(tacticianChoice.initiative)}`
    : (isSurprised ? `${normalIR}` : (useCombatSenses ? `${ir}` : `${dice} + ${ir}`));

  const roll = combatant.getInitiativeRoll(formula);
  await roll.evaluate();
  const initiative = Number(roll?.total ?? Number.NEGATIVE_INFINITY);

  const choice = tacticianChoice?.mode === "provider"
    ? "tactician"
    : (useCombatSenses ? "combatSenses" : "normal");

  return {
    initiative,
    formula,
    roll,
    choice,
    tacticianName: tacticianChoice?.tacticianName ?? null,
    isSurprised
  };
}

/**
 * Build an atomic initiative update payload for next-round dynamic rerolls.
 *
 * @param {Combat} combat
 * @param {object} [opts]
 * @param {boolean} [opts.interactive=false]
 * @param {boolean} [opts.suppressChat=true]
 * @returns {Promise<{combatantUpdates: Array<{_id: string, initiative: number}>, orderedCombatantIds: string[], startingTurn: number, summary: {round: number, rows: Array<{combatantId: string, combatantName: string, initiative: number, formula: string, choice: string, tacticianName: string|null, roll: Roll|null}>}, projectedFirstCombatantId: string|null}>}
 */
export async function prepareDynamicRoundInitiativeUpdate(combat, opts = {}) {
  const _interactive = opts?.interactive === true;
  const _suppressChat = opts?.suppressChat !== false;
  void _interactive;
  void _suppressChat;

  const combatants = Array.from(combat?.combatants ?? []).filter((c) => c?.actor);
  const ordered = combatants.slice().sort((a, b) => {
    const aT = hasTalent(a?.actor, "tactician") ? 0 : 1;
    const bT = hasTalent(b?.actor, "tactician") ? 0 : 1;
    if (aT !== bT) return aT - bT;
    const an = String(a?.actor?.name ?? "");
    const bn = String(b?.actor?.name ?? "");
    if (an !== bn) return an.localeCompare(bn);
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });

  const initiativeByActorUuid = new Map();
  const updates = [];
  const summaryRows = [];

  for (const combatant of ordered) {
    const result = await resolveCombatantInitiative(combat, combatant, {
      deterministicTactician: true,
      initiativeByActorUuid
    });
    updates.push({ _id: String(combatant.id), initiative: Number(result.initiative) });
    initiativeByActorUuid.set(String(combatant.actor.uuid), Number(result.initiative));
    summaryRows.push({
      combatantId: String(combatant.id),
      combatantName: String(combatant?.name ?? combatant.actor?.name ?? ""),
      initiative: Number(result.initiative),
      formula: String(result.formula ?? ""),
      choice: String(result.choice ?? "normal"),
      tacticianName: result?.tacticianName ? String(result.tacticianName) : null,
      roll: result?.roll ?? null
    });
  }

  const projected = combatants.map((c) => {
    const nextInitiative = Number(updates.find((u) => u._id === c.id)?.initiative ?? Number.NEGATIVE_INFINITY);
    return {
      combatantId: String(c.id),
      defeated: Boolean(c?.defeated),
      tuple: getInitiativeTieBreakTuple(c, nextInitiative)
    };
  }).sort(compareProjectedInitiativeEntries);

  const orderedCombatantIds = projected.map((p) => p.combatantId);
  let startingTurn = 0;
  const firstActiveIdx = projected.findIndex((p) => p.defeated !== true);
  if (firstActiveIdx >= 0) startingTurn = firstActiveIdx;

  const projectedFirstCombatantId = orderedCombatantIds[startingTurn] ?? null;
  const summary = {
    round: Number(combat?.round ?? 0) + 1,
    rows: summaryRows
  };

  return {
    combatantUpdates: updates,
    orderedCombatantIds,
    startingTurn,
    summary,
    projectedFirstCombatantId
  };
}
