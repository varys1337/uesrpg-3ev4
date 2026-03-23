/**
 * src/core/mass-warfare/clash/auto-roll.js
 *
 * GM-side auto-roll trigger for the Warfare Clash flow.
 *
 * Mirrors OpposedWorkflow._autoRollBanked:
 *  - Called from the updateChatMessage hook when autoRollRequested becomes true
 *  - Only runs on the active GM client
 *  - Uses a local in-flight lock to prevent re-entrancy
 *  - Marks autoRollStarted before doing async work
 *  - Writes full resolved state and re-renders the card on completion
 *
 * Dice So Nice (3D dice) support:
 *  - After evaluating all rolls, calls game.dice3d?.showForRoll() for each
 *    so the dice animation plays before the final card is revealed.
 */

import { SYSTEM_ID } from "../../../core/constants.js";
import { safeUpdateChatMessage } from "../../../utils/chat-message-socket.js";
import { CLASH_FLAG_KEY, readClashState } from "./pending.js";
import { renderClashCard } from "./card.js";
import { resolveClash } from "./engine.js";
import { consumeHoldNextDefend, consumeJoinFrayNextClash } from "../actions.js";
import { resolveWarfareUnitReference } from "../condition-target.js";

/** Prevents concurrent auto-roll executions for the same message on this client. */
const _autoRollLocks = new Set();

/**
 * Called from the updateChatMessage hook.
 * Detects when both sides have committed and fires the auto-roll (GM only).
 *
 * @param {ChatMessage} message
 * @returns {Promise<void>}
 */
export async function maybeAutoRollClash(message) {
  const data = readClashState(message);
  if (!data)                              return;
  if (!data.autoRollRequested)            return;
  if (data.autoRollStarted)              return;
  if (data.phase === "resolved")          return;
  if (!data.unit1?.banked?.committed)     return;
  if (!data.unit2?.banked?.committed)     return;

  // Only the active GM executes the auto-roll
  if (!game.user.isGM || !game.user.active) return;

  const lockKey = message.id;
  if (_autoRollLocks.has(lockKey)) return;
  _autoRollLocks.add(lockKey);

  try {
    await _executeAutoRoll(message, data);
  } catch (err) {
    console.error("UESRPG | Warfare Clash auto-roll failed", err);
  } finally {
    _autoRollLocks.delete(lockKey);
  }
}

/**
 * Execute the full Clash resolution: roll discipline tests, damage, break tests,
 * apply Resolve losses, and update the card to "resolved" state.
 *
 * @param {ChatMessage} message
 * @param {object}      data    — current warfareClash flag state
 * @returns {Promise<void>}
 */
async function _executeAutoRoll(message, data) {
  // Claim the roll immediately to prevent concurrent execution on other GM clients
  const working = foundry.utils.deepClone(data);
  working.autoRollStarted   = true;
  working.autoRollStartedBy = game.user.id;

  await safeUpdateChatMessage(message, {
    flags: { [SYSTEM_ID]: { [CLASH_FLAG_KEY]: working } },
  });

  // Resolve actors from flag state
  const attackerRef = await resolveWarfareUnitReference({
    actorId: working.unit1.actorId,
    actorUuid: working.unit1.actorUuid,
    tokenUuid: working.unit1.tokenUuid,
    sceneId: working.unit1.sceneId,
  });
  const defenderRef = await resolveWarfareUnitReference({
    actorId: working.unit2.actorId,
    actorUuid: working.unit2.actorUuid,
    tokenUuid: working.unit2.tokenUuid,
    sceneId: working.unit2.sceneId,
  });
  const attacker = attackerRef.actor;
  const defender = defenderRef.actor;

  if (!attacker || !defender) {
    console.error("UESRPG | Warfare Clash auto-roll: could not resolve actors", {
      unit1ActorId: working.unit1.actorId,
      unit2ActorId: working.unit2.actorId,
    });
    return;
  }

  // Run the full clash math (also writes Condition to actors)
  const clashResult = await resolveClash({
    attacker,
    defender,
    attackerTokenDoc: attackerRef.tokenDoc,
    defenderTokenDoc: defenderRef.tokenDoc,
    attackerRole:       working.unit1.role       ?? "attack",
    defenderRole:       working.unit2.role       ?? "defend",
    attackerJoinFray:   working.unit1.joinFray   ?? false,
    defenderJoinFray:   working.unit2.joinFray   ?? false,
    attackerModifier:   Number(working.unit1.modifier ?? 0),
    defenderModifier:   Number(working.unit2.modifier ?? 0),
    attackerFeatures:   working.unit1.features   ?? {},
    defenderFeatures:   working.unit2.features   ?? {},
    attackerCharged:    Boolean(working.unit1.charged),
    defenderCharged:    Boolean(working.unit2.charged),
    attackerIncomingChargeSide: working.unit1.incomingChargeSide ?? "none",
    defenderIncomingChargeSide: working.unit2.incomingChargeSide ?? "none",
    attackType:         working.unit1.attackType ?? "melee",
    applyDamage:        true,
  });

  await Promise.all([
    clashResult.unit1.joinFray ? consumeJoinFrayNextClash(attacker).catch(() => false) : Promise.resolve(false),
    clashResult.unit2.joinFray ? consumeJoinFrayNextClash(defender).catch(() => false) : Promise.resolve(false),
    clashResult.unit1.holdApplied ? consumeHoldNextDefend(attacker).catch(() => false) : Promise.resolve(false),
    clashResult.unit2.holdApplied ? consumeHoldNextDefend(defender).catch(() => false) : Promise.resolve(false),
  ]);

  // ── Dice So Nice 3D animation ─────────────────────────────────────────────
  // Show all evaluated rolls simultaneously so players see all dice at once.
  // game.dice3d is provided by the Dice So Nice module; gracefully skip if absent.
  if (game.dice3d) {
    const rolls = [
      clashResult.unit1.testResult?.roll,
      clashResult.unit2.testResult?.roll,
      clashResult.unit1.dmgRoll,
      clashResult.unit2.dmgRoll,
      clashResult.unit1.breakTest?.result?.roll,
      clashResult.unit2.breakTest?.result?.roll,
    ].filter(Boolean);

    await Promise.all(rolls.map(r => game.dice3d.showForRoll(r, game.user, true).catch(() => {})));
  }

  // Merge results into the flag state
  _writeUnitResults(working.unit1, clashResult.unit1);
  _writeUnitResults(working.unit2, clashResult.unit2);

  working.phase             = "resolved";
  working.autoRollRequested = false;

  // Final card render + flag write
  const content = renderClashCard(working, message.id);
  await safeUpdateChatMessage(message, {
    content,
    flags: { [SYSTEM_ID]: { [CLASH_FLAG_KEY]: working } },
  });
}

/**
 * Copy resolved roll data from a ClashResult unit side into the flag state unit.
 *
 * @param {object} flagUnit   — warfareClash flag state unit (mutated in-place)
 * @param {object} resultUnit — unit side from resolveClash() result
 */
function _writeUnitResults(flagUnit, resultUnit) {
  flagUnit.tn              = resultUnit.tn;
  flagUnit.tnBreakdown     = Array.isArray(resultUnit.tnData?.breakdown) ? resultUnit.tnData.breakdown : [];
  flagUnit.testRollTotal   = resultUnit.testResult?.rollTotal  ?? null;
  flagUnit.testIsSuccess   = resultUnit.testResult?.isSuccess  ?? null;
  flagUnit.testDegree      = resultUnit.testResult?.degree     ?? null;
  flagUnit.dmgFormula      = resultUnit.dmgFormula;
  flagUnit.dmgRawTotal     = resultUnit.dmgRawTotal ?? null;
  flagUnit.dmgTotal        = resultUnit.dmgTotal;
  flagUnit.damageBreakdown = resultUnit.damageBreakdown ?? null;
  flagUnit.ar              = resultUnit.ar;
  flagUnit.armorBreakdown  = resultUnit.armorBreakdown ?? null;
  flagUnit.mitigationBreakdown = resultUnit.mitigationBreakdown ?? null;
  flagUnit.holdApplied     = Boolean(resultUnit.holdApplied);
  flagUnit.conditionBefore = resultUnit.conditionBefore;
  flagUnit.conditionLoss   = resultUnit.conditionLoss;
  flagUnit.conditionAfter  = resultUnit.conditionAfter;
  flagUnit.breakTest       = resultUnit.breakTest ?? null;
}
