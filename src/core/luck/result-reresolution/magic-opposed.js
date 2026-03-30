import { cloneFlagState } from "../../../utils/clone.js";
import { SYSTEM_ID } from "../../constants.js";
import { updateCard as updateMagicCard } from "../../magic/opposed/updater.js";
import { renderCard as renderMagicCard } from "../../magic/opposed/render.js";
import {
  getDefenderEntries as getMagicDefenderEntries,
  selectDefenderEntry as selectMagicDefenderEntry,
  getDefenderOutcome as getMagicDefenderOutcome,
  setDefenderOutcome as setMagicDefenderOutcome,
  getMagicDefenderDamage,
  setMagicDefenderDamage,
  resolveActor as resolveMagicActor,
} from "../../magic/opposed/schema.js";
import { resolveOutcome as resolveMagicOutcome } from "../../magic/opposed/outcome-resolution.js";
import { applyExtraLuckContext, didPersistLuckResult, getLiveLuckMessage } from "./shared.js";

export function getMagicAffectedDefenders(data, side) {
  const defenders = getMagicDefenderEntries(data);
  if (side?.role === "attacker") return defenders;
  const idx = side?.defenderIndex ?? 0;
  return defenders[idx] ? [defenders[idx]] : [];
}

export function magicLaneHasTerminalState(data, defender) {
  if (!defender) return false;
  const damage = getMagicDefenderDamage(data, defender);
  if (damage?.rolled === true || damage?.applied === true) return true;
  const outcome = getMagicDefenderOutcome(data, defender);
  if (outcome?.needsBlockResolution === false && damage) return true;
  return false;
}

function resetMagicLane(data, defender) {
  setMagicDefenderOutcome(data, defender, null);
  const damage = getMagicDefenderDamage(data, defender);
  if (damage && damage.rolled !== true && damage.applied !== true) setMagicDefenderDamage(data, defender, null);
  delete defender?.aoeEvadeEscaped;
  delete defender?.aoeEvadeFailed;
}

export async function applyLuckMagicOpposedMutation(message, side, newResult, extraContext, classifyMessage) {
  const live = getLiveLuckMessage(message);
  const raw = live?.flags?.[SYSTEM_ID]?.magicOpposed;
  if (!raw) return false;
  const data = cloneFlagState(raw.state ?? raw);
  if (side.role === "attacker") {
    data.attacker.result = newResult;
  } else {
    const defender = getMagicDefenderEntries(data)[side.defenderIndex ?? 0] ?? null;
    if (!defender) return false;
    defender.result = newResult;
  }

  const affectedDefenders = getMagicAffectedDefenders(data, side);
  if (!affectedDefenders.length) return false;

  const attacker = resolveMagicActor(data.attacker?.actorUuid) ?? null;
  if (!attacker) return false;
  const spell = data.attacker?.spellUuid ? await fromUuid(data.attacker.spellUuid) : null;
  if (!spell) return false;

  for (const defenderEntry of affectedDefenders) {
    resetMagicLane(data, defenderEntry);
    const defender = resolveMagicActor(defenderEntry.actorUuid) ?? null;
    if (!defender) return false;
    const { defenderIndex } = selectMagicDefenderEntry(data, { defenderActorUuid: defenderEntry.actorUuid, defenderTokenUuid: defenderEntry.tokenUuid });
    await resolveMagicOutcome({
      message: live,
      data,
      attacker,
      defender,
      defenderEntry,
      spell,
      defenderIndex,
      isAoE: Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE),
      forcedHitLocation: String(data?.context?.forcedHitLocation ?? "").trim(),
      _updateCard: async () => {},
      skipAttackerSideEffects: true,
    });
  }

  applyExtraLuckContext(data, extraContext);
  data.context = data.context ?? {};
  data.status = "resolved";
  data.context.phase = "resolved";
  if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
  await updateMagicCard(live, data, renderMagicCard);
  return didPersistLuckResult(live, "magicOpposed", side, newResult, classifyMessage);
}
