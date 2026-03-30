/**
 * @module traits/intellectual-talents
 * @description Automation helpers for Intellectual talents (Chapter 4):
 *  - Businessman: on successful Commerce test, choose rolled DoS or Commerce rank
 *  - Interrogator: on successful Persuade test made to interrogate, choose rolled DoS or Persuade rank
 *  - Questioning: on successful Persuade info-gathering test, choose rolled DoS or Persuade rank
 *  - Prediction: use Int bonus in place of Agi bonus for Initiative Rating
 *  - Tactician: allies may use tactician's initiative result instead of their own
 */

import { hasTalent, getSkillRank, normalizeTalentKey } from "./talents-api.js";
import { promptDoSReplacement } from "./combat-talents.js";
import { _canPromptForActor, _applyDoSOverride } from "./_primitives.js";
import { createUuidResolver } from "../../utils/uuid-cache.js";

/**
 * Apply Businessman / Interrogator / Questioning DoS overrides to a successful skill test result.
 *
 * - Does not mutate actor/item data.
 * - Stores metadata on the result object for callers to propagate into chat flags.
 *
 * @param {object} params
 * @param {Actor} params.actor
 * @param {string} params.skillName
 * @param {object} params.result - doTestRoll result (mutable)
 * @param {boolean} [params.isInterrogationTest=false]
 * @param {boolean} [params.isQuestioningTest=false]
 * @param {object|null} [params.storedOverride=null] - {source, mode, value} to apply without prompting
 * @param {boolean} [params.allowPrompt=true]
 * @returns {Promise<{applied: boolean, override: object|null}>}
 */
export async function applyIntellectualTalentDoSOverrides({
  actor,
  skillName,
  result,
  isInterrogationTest = false,
  isQuestioningTest = false,
  storedOverride = null,
  allowPrompt = true
} = {}) {
  if (!actor || !result) return { applied: false, override: null };
  if (result.isSuccess !== true) return { applied: false, override: null };

  const key = normalizeTalentKey(skillName);
  if (!key) return { applied: false, override: null };

  // Apply a stored override (e.g., from chat flags) without prompting.
  if (storedOverride && typeof storedOverride === "object") {
    const src = String(storedOverride.source ?? "").trim().toLowerCase();
    const mode = String(storedOverride.mode ?? "").trim().toLowerCase();
    const value = Number(storedOverride.value ?? 0) || 0;
    if ((src === "businessman" || src === "interrogator" || src === "questioning") && (mode === "rolled" || mode === "rank") && value > 0) {
      _applyDoSOverride(result, { source: src, mode, value });
      return { applied: true, override: result.uesrpgDosOverride ?? null };
    }
  }

  // Interrogator (Persuade + explicit interrogation toggle).
  if (key === "persuade" && isInterrogationTest === true && hasTalent(actor, "interrogator")) {
    const rankDoS = Math.max(0, getSkillRank(actor, "Persuade"));
    if (rankDoS > 0) {
      const rolledDoS = Math.max(1, Number(result.degree ?? 1) || 1);
      const canPrompt = allowPrompt && _canPromptForActor(actor);
      let choice = { choice: "rolled" };
      if (canPrompt) {
          choice = await promptDoSReplacement({
          title: "Interrogator \u2014 Degrees of Success",
          rolledDoS,
          rankDoS,
          rankLabel: "Persuade Rank"
        });
      }
      const mode = (choice?.choice === "rank") ? "rank" : "rolled";
      const value = (mode === "rank") ? rankDoS : rolledDoS;
      _applyDoSOverride(result, { source: "interrogator", mode, value });
      return { applied: true, override: result.uesrpgDosOverride ?? null };
    }
  }

  // Questioning (Persuade + explicit questioning toggle).
  // RAW: "When the character passes a Persuade skill test made to try to elicit information
  // from a character through conversation they can choose to take the number of degrees of
  // success that they rolled or take a number equal to their Persuade skill rank instead."
  if (key === "persuade" && isQuestioningTest === true && hasTalent(actor, "questioning")) {
    const rankDoS = Math.max(0, getSkillRank(actor, "Persuade"));
    if (rankDoS > 0) {
      const rolledDoS = Math.max(1, Number(result.degree ?? 1) || 1);
      const canPrompt = allowPrompt && _canPromptForActor(actor);
      let choice = { choice: "rolled" };
      if (canPrompt) {
          choice = await promptDoSReplacement({
          title: "Questioning \u2014 Degrees of Success",
          rolledDoS,
          rankDoS,
          rankLabel: "Persuade Rank"
        });
      }
      const mode = (choice?.choice === "rank") ? "rank" : "rolled";
      const value = (mode === "rank") ? rankDoS : rolledDoS;
      _applyDoSOverride(result, { source: "questioning", mode, value });
      return { applied: true, override: result.uesrpgDosOverride ?? null };
    }
  }

  // Businessman (Commerce).
  if (key === "commerce" && hasTalent(actor, "businessman")) {
    const rankDoS = Math.max(0, getSkillRank(actor, "Commerce"));
    if (rankDoS > 0) {
      const rolledDoS = Math.max(1, Number(result.degree ?? 1) || 1);
      const canPrompt = allowPrompt && _canPromptForActor(actor);
      let choice = { choice: "rolled" };
      if (canPrompt) {
          choice = await promptDoSReplacement({
          title: "Businessman \u2014 Degrees of Success",
          rolledDoS,
          rankDoS,
          rankLabel: "Commerce Rank"
        });
      }
      const mode = (choice?.choice === "rank") ? "rank" : "rolled";
      const value = (mode === "rank") ? rankDoS : rolledDoS;
      _applyDoSOverride(result, { source: "businessman", mode, value });
      return { applied: true, override: result.uesrpgDosOverride ?? null };
    }
  }

  return { applied: false, override: null };
}

/**
 * Prediction (Chapter 4): use Intelligence bonus in place of Agility bonus for Initiative Rating.
 *
 * @param {object} params
 * @param {Actor} params.actor
 * @param {number} params.agiBonus
 * @param {number} params.intBonus
 * @returns {number} The initiative "Agility Bonus" component to use.
 */
export function getPredictionInitiativeAgiBonus({ actor, agiBonus, intBonus } = {}) {
  const ab = Number(agiBonus ?? 0) || 0;
  if (!actor) return ab;
  if (!hasTalent(actor, "prediction")) return ab;
  return Number(intBonus ?? 0) || 0;
}

/**
 * Find Group actors that include a given member UUID.
 *
 * @param {string} memberUuid
 * @returns {Actor[]} Group actors (sorted deterministically)
 */
export function listGroupActorsForMember(memberUuid) {
  const uuid = String(memberUuid ?? "").trim();
  if (!uuid) return [];
  const groups = (game.actors?.contents ?? []).filter(a => String(a?.type ?? "") === "Group");
  const hits = [];
  for (const g of groups) {
    const members = g?.system?.members ?? [];
    if (!Array.isArray(members)) continue;
    if (members.some(m => String(m?.id ?? "") === uuid)) hits.push(g);
  }
  hits.sort((a, b) => {
    const an = String(a?.name ?? "");
    const bn = String(b?.name ?? "");
    if (an !== bn) return an.localeCompare(bn);
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });
  return hits;
}

/**
 * List available Tactician initiative providers (initiative already rolled) for a given actor.
 *
 * RAW: "Allies of this character may use the character's initiative result in place of their own..."
 * We interpret "allies" via Group membership (Group actor contains members).
 *
 * @param {Actor} actor
 * @param {Combat} combat
 * @returns {Array<{tactician: Actor, initiative: number, group: Actor}>}
 */
export function listTacticianInitiativeProvidersForActor(actor, combat) {
  if (!actor || !combat) return [];
  const groups = listGroupActorsForMember(actor.uuid);
  if (!groups.length) return [];
  const resolver = createUuidResolver();

  const combatants = Array.from(combat.combatants ?? []);
  const initByActorUuid = new Map();
  for (const c of combatants) {
    const a = c?.actor ?? null;
    if (!a?.uuid) continue;
    const ini = Number(c?.initiative ?? NaN);
    if (!Number.isFinite(ini)) continue;
    initByActorUuid.set(a.uuid, ini);
  }

  const out = [];
  for (const g of groups) {
    const members = Array.isArray(g?.system?.members) ? g.system.members : [];
    for (const m of members) {
      const memberUuid = String(m?.id ?? "").trim();
      if (!memberUuid || memberUuid === actor.uuid) continue;
      const memberActor = resolver.resolveSync(memberUuid);
      if (!memberActor) continue;
      if (!hasTalent(memberActor, "tactician")) continue;
      const ini = initByActorUuid.get(memberActor.uuid);
      if (!Number.isFinite(ini)) continue;
      out.push({ tactician: memberActor, initiative: ini, group: g });
    }
  }

  // Deterministic ordering: highest initiative first, then name/uuid.
  out.sort((a, b) => {
    const d = Number(b.initiative) - Number(a.initiative);
    if (d) return d;
    const an = String(a.tactician?.name ?? "");
    const bn = String(b.tactician?.name ?? "");
    if (an !== bn) return an.localeCompare(bn);
    return String(a.tactician?.uuid ?? "").localeCompare(String(b.tactician?.uuid ?? ""));
  });

  return out;
}
