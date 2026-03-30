import { cloneFlagState } from "../../../utils/clone.js";
import { SYSTEM_ID } from "../../constants.js";
import { updateCard as updateCombatCard } from "../../combat/opposed/cards/updater.js";
import { resolveOutcomeRAW, computeAdvantageRAW } from "../../combat/opposed/outcome-resolution.js";
import { _renderCard as renderCombatCard } from "../../combat/opposed/render.js";
import {
  _getDefenderEntries,
  _getDefenderOutcome,
  _setDefenderOutcome,
  _setDefenderAdvantage,
  _getDefenderDamage,
  _setDefenderDamage,
  _getDefenderResolutionState,
} from "../../combat/opposed/schema.js";
import { applyAoEEvadeOutcome } from "../../combat/opposed/helpers/workflow.js";
import { applyExtraLuckContext, didPersistLuckResult, finalizeResolvedLuckContext, getLiveLuckMessage } from "./shared.js";

export function getCombatAffectedDefenders(data, side) {
  const defenders = _getDefenderEntries(data);
  if (side?.role === "attacker") return defenders;
  const idx = side?.defenderIndex ?? 0;
  return defenders[idx] ? [defenders[idx]] : [];
}

export function combatLaneHasTerminalState(data, defender) {
  if (!defender) return false;
  const damage = _getDefenderDamage(data, defender);
  if (damage?.rolled === true || damage?.applied === true) return true;
  const resolutionState = _getDefenderResolutionState(data, defender);
  if (resolutionState?.advantageSpent?.attacker === true || resolutionState?.advantageSpent?.defender === true) return true;
  if (resolutionState?.defenderAdvantage?.resolved === true) return true;
  if (Array.isArray(data?.context?.advantageMarkers) && data.context.advantageMarkers.length > 0) return true;
  return false;
}

function resetCombatLane(data, defender) {
  _setDefenderOutcome(data, defender, null);
  _setDefenderAdvantage(data, defender, null);
  const damage = _getDefenderDamage(data, defender);
  if (damage && damage.rolled !== true && damage.applied !== true) _setDefenderDamage(data, defender, null);
  const resolutionState = _getDefenderResolutionState(data, defender);
  if (!resolutionState) return;
  resolutionState.advantageResolution = {};
  resolutionState.advantageSpent = {};
  resolutionState.defenderAdvantage = {};
  if (Array.isArray(data.defenders)) {
    defender.advantageResolution = resolutionState.advantageResolution;
    defender.advantageSpent = resolutionState.advantageSpent;
    defender.defenderAdvantage = resolutionState.defenderAdvantage;
  } else {
    data.advantageResolution = resolutionState.advantageResolution;
    data.advantageSpent = resolutionState.advantageSpent;
    data.defenderAdvantage = resolutionState.defenderAdvantage;
  }
}

export async function applyLuckCombatMutation(message, side, newResult, extraContext, classifyMessage) {
  const live = getLiveLuckMessage(message);
  const raw = live?.flags?.[SYSTEM_ID]?.opposed;
  if (!raw) return false;
  const data = cloneFlagState(raw);
  if (side.role === "attacker") {
    data.attacker.result = newResult;
  } else {
    const defender = _getDefenderEntries(data)[side.defenderIndex ?? 0] ?? null;
    if (!defender) return false;
    defender.result = newResult;
  }

  const affectedDefenders = getCombatAffectedDefenders(data, side);
  if (!affectedDefenders.length) return false;
  for (const defender of affectedDefenders) {
    resetCombatLane(data, defender);
    if (!data.attacker?.result || !defender?.result) continue;
    const baseOutcome = resolveOutcomeRAW(data, defender);
    const outcome = applyAoEEvadeOutcome(data, baseOutcome, defender);
    _setDefenderOutcome(data, defender, outcome);
    _setDefenderAdvantage(data, defender, computeAdvantageRAW(data, outcome, defender));
  }

  applyExtraLuckContext(data, extraContext);
  const allResolved = _getDefenderEntries(data).every((defender) => Boolean(_getDefenderOutcome(data, defender)));
  finalizeResolvedLuckContext(data, { resolved: allResolved });
  await updateCombatCard(live, data, renderCombatCard);
  return didPersistLuckResult(live, "combatOpposed", side, newResult, classifyMessage);
}
