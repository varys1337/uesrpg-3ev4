/**
 * src/core/combat/opposed/cards/hydration.js
 *
 * Roll message validation and result hydration logic.
 * Phase 18.2 extraction - card healing/self-repair utilities.
 */

import { computeResultFromRollTotal } from "../../../../utils/degree-roll-helper.js";
import { _logDebug } from "../helpers/util.js";

/**
 * Validate that a roll message is eligible to heal an opposed card.
 * Guards against spoofed/mismatched rolls, cross-user permission violations.
 */
export function isValidOpposedRollMessageForHeal(
  { rollMessage, parentMessageId, expectedStage, expectedActor },
  { getChatMessageAuthorUser, userHasActorOwnership }
) {
  if (!rollMessage || !parentMessageId || !expectedStage || !expectedActor) return false;

  const meta = rollMessage?.flags?.["uesrpg-3ev4"]?.opposed ?? null;
  if (!meta) return false;
  if (meta.parentMessageId !== parentMessageId) return false;
  if (meta.stage !== expectedStage) return false;

  const speakerActorId = rollMessage?.speaker?.actor ?? null;
  if (speakerActorId && speakerActorId !== expectedActor.id) return false;

  const authorUser = getChatMessageAuthorUser(rollMessage);
  if (!authorUser) return false;
  if (!authorUser.isGM && !userHasActorOwnership(authorUser, expectedActor)) return false;

  return true;
}

/**
 * Extract the numeric total from the first roll in a ChatMessage.
 */
export function extractFirstRollTotal(rollMessage) {
  const roll = rollMessage?.rolls?.[0] ?? null;
  const total = Number(roll?.total ?? NaN);
  return Number.isFinite(total) ? total : null;
}

/**
 * Hydrate attacker/defender result from stored rollMessageId.
 * Used to heal partial opposed cards where roll exists but result is missing.
 */
export async function hydrateSideResultFromRollMessageId(
  { message, data, sideKey, expectedStage, expectedActor },
  { getChatMessageAuthorUser, userHasActorOwnership, applyDefenderCommitToData }
) {
  if (!message || !data || !sideKey || !expectedStage || !expectedActor) return { dirty: false };

  const side = data?.[sideKey] ?? null;
  const rollMessageId = side?.rollMessageId ?? null;
  if (!rollMessageId) return { dirty: false };
  if (side?.result) return { dirty: false };

  const rollMessage = game.messages.get(rollMessageId) ?? null;
  if (!rollMessage) return { dirty: false };

  if (!isValidOpposedRollMessageForHeal(
    { rollMessage, parentMessageId: message.id, expectedStage, expectedActor },
    { getChatMessageAuthorUser, userHasActorOwnership }
  )) {
    return { dirty: false };
  }

  const rollTotal = extractFirstRollTotal(rollMessage);
  if (rollTotal == null) return { dirty: false };

  // Defender roll messages can carry the computed TN + labels to support cross-user banking.
  // Use that commit payload to heal partial states where the defender lane is incomplete.
  if (sideKey === "defender") {
    const commit = rollMessage?.flags?.["uesrpg-3ev4"]?.opposed?.commit?.defender ?? null;
    applyDefenderCommitToData(data, commit);
  }

  const target = Number(side?.target ?? side?.tn?.finalTN ?? NaN);
  if (!Number.isFinite(target)) return { dirty: false };

  const res = computeResultFromRollTotal(expectedActor, {
    rollTotal,
    target,
    allowLucky: true,
    allowUnlucky: true
  });

  side.result = {
    rollTotal: res.rollTotal,
    target: res.target,
    isSuccess: res.isSuccess,
    degree: res.degree,
    textual: res.textual,
    isCriticalSuccess: res.isCriticalSuccess,
    isCriticalFailure: res.isCriticalFailure
  };

  if (!side.rolledAt) side.rolledAt = Date.now();

  return { dirty: true };
}

/**
 * Ensure the opposed card is in a resolved state before running post-resolution actions
 * (e.g. Roll Damage). Some edge cases can display resolved HTML while the stored
 * flags are still missing outcome/status due to out-of-order or partial updates.
 * This helper is a safe, deterministic self-heal: if both roll results exist, it
 * computes outcome + advantage and persists them to the card.
 */
export async function ensureResolvedForPostActions(
  message,
  data,
  { defenderIndex = null, defenderTokenUuid = null, defenderActorUuid = null } = {},
  {
    selectDefenderEntry,
    getDefenderOutcome,
    selfHealOpposedCardFromStoredRolls,
    updateCard,
    logDebug
  }
) {
  try {
    if (!message || !data) return false;
    selectDefenderEntry(data, { defenderIndex, defenderTokenUuid, defenderActorUuid });
    if (getDefenderOutcome(data, data.defender)) return true;

    // Self-heal: if rollMessageIds exist but card flags are incomplete, rehydrate from the roll messages
    if (data?.attacker?.rollMessageId || data?.defender?.rollMessageId) {
      const { dirty } = await selfHealOpposedCardFromStoredRolls(message, data, { 
        defenderIndex, 
        defenderTokenUuid, 
        defenderActorUuid 
      });
      if (dirty) {
        await updateCard(message, data);
        _logDebug("ensureResolvedForPostActions: self-healed card from stored rollMessageIds");
      }
    }

    // Recheck outcome after potential self-heal
    selectDefenderEntry(data, { defenderIndex, defenderTokenUuid, defenderActorUuid });
    return Boolean(getDefenderOutcome(data, data.defender));
  } catch (err) {
    console.error("UESRPG | ensureResolvedForPostActions failed", err);
    return false;
  }
}
