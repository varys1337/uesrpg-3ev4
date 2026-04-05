/**
 * src/core/mass-warfare/clash/pending.js
 *
 * State management and creation for the Warfare Clash asynchronous flow.
 *
 * Mirrors the opposed test "createPending" pattern:
 *  - Creates a ChatMessage with phase "pending"
 *  - Stores all state in flags["uesrpg-3ev4"].warfareClash
 *  - Both sides must commit independently via handleClashCommit()
 *  - Auto-roll is triggered when both sides are committed
 */

import { SYSTEM_ID } from "../../../core/constants.js";
import { renderClashCard } from "./card.js";

export const CLASH_FLAG_KEY = "warfareClash";

/**
 * Read the warfareClash flag state from a ChatMessage.
 *
 * @param {ChatMessage} message
 * @returns {object|null}
 */
export function readClashState(message) {
  return message?.flags?.[SYSTEM_ID]?.[CLASH_FLAG_KEY] ?? null;
}

/**
 * Build an empty unit-state object for initial pending state.
 *
 * @param {SimpleActor} actor
 * @returns {object}
 */
function _emptyUnitState(actor, tokenDoc = null) {
  return {
    actorId:         actor.id,
    actorUuid:       actor.uuid,
    tokenUuid:       tokenDoc?.uuid ?? "",
    sceneId:         tokenDoc?.parent?.id ?? "",
    actorName:       actor.name,
    // Committed by the unit's owner during the pending phase:
    role:            null,    // "attack" | "defend" | "none"
    attackType:      "melee", // "melee" | "ranged" — set at initiation for unit1; always "melee" for unit2
    joinFray:        false,
    modifier:        0,       // manual flat TN modifier applied before roll
    charged:         false,
    incomingChargeSide: "none",
    contactSide:     "front",
    commanderJoinFray: null,
    features:        {},      // { [featureId]: boolean } — unit-type feature toggles
    banked: {
      committed:    false,
      committedAt:  null,
      committedBy:  null,
    },
    // Filled in after auto-roll (phase "resolved"):
    tn:              null,
    tnBreakdown:     [],
    testRollTotal:   null,
    testIsSuccess:   null,
    testDegree:      null,
    dmgFormula:      null,
    dmgRawTotal:     null,
    dmgTotal:        null,
    damageBreakdown: null,
    ar:              null,
    armorBreakdown:  null,
    mitigationBreakdown: null,
    holdApplied:     false,
    conditionBefore: null,
    conditionLoss:   null,
    conditionAfter:  null,
    breakTest:       null,
  };
}

/**
 * Create an initial "pending" Clash ChatMessage.
 *
 * Both sides must subsequently choose their stance via the "Choose Stance"
 * button on the card, which calls handleClashCommit(). Once both commit,
 * the GM-side auto-roll resolves the clash and updates the card.
 *
 * @param {SimpleActor} attacker — the unit initiating the clash (unit1)
 * @param {SimpleActor} defender — the targeted unit (unit2)
 * @returns {Promise<ChatMessage>}
 */
export async function createClashPending(attacker, defender, {
  attackerTokenDoc = null,
  defenderTokenDoc = null,
  attackType = "melee",
  attackerCharged = false,
  defenderCharged = false,
  attackerIncomingChargeSide = "none",
  defenderIncomingChargeSide = "none",
  attackerContactSide = "front",
  defenderContactSide = "front",
  clashGroupId = "",
  groupMembers = [],
  commanderJoinFray = { unit1: null, unit2: null },
} = {}) {
  const unit1 = _emptyUnitState(attacker, attackerTokenDoc);
  unit1.attackType = attackType === "ranged" ? "ranged" : "melee";
  unit1.charged = Boolean(attackerCharged);
  unit1.incomingChargeSide = String(attackerIncomingChargeSide ?? "none");
  unit1.contactSide = String(attackerContactSide ?? "front");
  unit1.commanderJoinFray = commanderJoinFray?.unit1 ?? null;
  const unit2 = _emptyUnitState(defender, defenderTokenDoc);
  unit2.charged = Boolean(defenderCharged);
  unit2.incomingChargeSide = String(defenderIncomingChargeSide ?? "none");
  unit2.contactSide = String(defenderContactSide ?? "front");
  unit2.commanderJoinFray = commanderJoinFray?.unit2 ?? null;

  const data = {
    phase:             "pending",
    autoRollRequested: false,
    autoRollStarted:   false,
    autoRollStartedBy: null,
    unit1,
    unit2,
    clashGroupId:      String(clashGroupId ?? ""),
    groupMembers:      Array.isArray(groupMembers) ? groupMembers.map((value) => String(value ?? "")).filter(Boolean) : [],
    createdAt:         Date.now(),
  };

  // Render card with empty message ID first (no buttons yet)
  const content = renderClashCard(data, "");

  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content,
    flags: { [SYSTEM_ID]: { [CLASH_FLAG_KEY]: data } },
  });

  // Re-render with the real message ID so action buttons contain the correct reference
  const finalContent = renderClashCard(data, message.id);
  await message.update({ content: finalContent });

  return message;
}
