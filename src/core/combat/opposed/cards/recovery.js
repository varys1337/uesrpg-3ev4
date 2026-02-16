/**
 * @file Opposed card self-healing and recovery logic.
 * @module opposed/card-recovery
 *
 * Extracted from monolithic opposed-workflow.js Phase 16 (2025-01-27).
 * Handles recovery of incomplete opposed cards by:
 * - Hydrating attacker/defender results from roll message IDs
 * - Normalizing "No Defense" deterministic failures
 * - Computing outcomes/advantage when both sides are complete
 *
 * Dependencies:
 * - Schema helpers (_resolveActor, _selectDefenderEntry, _getDefenderOutcome, etc.)
 * - Outcome resolution (_resolveOutcomeRAW, _computeAdvantageRAW)
 * - Banking state (_cleanupAutoRollContext)
 * - Card update (_updateCard)
 *
 * This is primarily used for post-GM-login recovery when roll messages exist
 * but the opposed card state was not fully updated.
 */
import { _resolveActorViaToken } from "../helpers/docs.js";

/**
 * Self-heal an opposed card by hydrating missing results from stored roll messages.
 *
 * **Healing Strategy:**
 * 1. Attacker lane: If rollMessageId exists but result is missing, hydrate from roll message
 * 2. Defender lane (No Defense): If noDefense=true but result is missing, create deterministic failure
 * 3. Defender lane (Normal): If rollMessageId exists but result is missing, hydrate from roll message
 * 4. Normalization: If both sides exist, compute outcome/advantage and mark as resolved
 *
 * **When is this called?**
 * - Post-GM-login recovery (rolls succeeded but card update failed)
 * - Defender commits but card wasn't updated (race condition)
 * - Manual recovery via debug commands
 *
 * @param {ChatMessage} message - Opposed card chat message
 * @param {Object} data - Opposed card data (flags.uesrpgOpposed)
 * @param {Object} options - Recovery options
 * @param {string} [options.reason=""] - Reason for healing (for logging)
 * @param {number} [options.defenderIndex=null] - Specific defender index
 * @param {string} [options.defenderTokenUuid=null] - Defender token UUID
 * @param {string} [options.defenderActorUuid=null] - Defender actor UUID
 * @param {Function} _resolveActor - Actor resolution helper
 * @param {Function} _selectDefenderEntry - Defender entry selector
 * @param {Function} _getDefenderOutcome - Outcome getter
 * @param {Function} _setDefenderOutcome - Outcome setter
 * @param {Function} _setDefenderAdvantage - Advantage setter
 * @param {Function} _getDefenderEntries - Get all defender entries
 * @param {Function} _resolveOutcomeRAW - RAW outcome resolver
 * @param {Function} _computeAdvantageRAW - RAW advantage computer
 * @param {Function} _applyAoEEvadeOutcome - AoE evade outcome applicator
 * @param {Function} _hydrateSideResultFromRollMessageId - Roll message hydrator
 * @param {Function} _cleanupAutoRollContext - Banking context cleanup
 * @param {Function} _updateCard - Card update helper
 * @param {Function} _logDebug - Debug logger
 * @returns {Promise<{dirty: boolean, resolved: boolean}>} Healing result
 */
export async function selfHealOpposedCardFromStoredRolls(
  message,
  data,
  {
    reason = "",
    defenderIndex = null,
    defenderTokenUuid = null,
    defenderActorUuid = null,
  } = {},
  {
    _resolveActor,
    _selectDefenderEntry,
    _getDefenderOutcome,
    _setDefenderOutcome,
    _setDefenderAdvantage,
    _getDefenderEntries,
    _resolveOutcomeRAW,
    _computeAdvantageRAW,
    _applyAoEEvadeOutcome,
    _hydrateSideResultFromRollMessageId,
    _cleanupAutoRollContext,
    _updateCard,
    _logDebug,
  }
) {
  if (!message || !data) return { dirty: false, resolved: false };

  let dirty = false;
  const fixes = [];

  data.context = data.context ?? {};

  _selectDefenderEntry(data, { defenderIndex, defenderTokenUuid, defenderActorUuid });
  const attacker = _resolveActorViaToken(data.attacker?.actorUuid, data.attacker?.tokenUuid);
  const defender = _resolveActorViaToken(data.defender?.actorUuid, data.defender?.tokenUuid);

  // Heal attacker lane if the rollMessageId exists but result is missing.
  if (attacker && data.attacker?.rollMessageId && !data.attacker?.result) {
    const r = await _hydrateSideResultFromRollMessageId({
      message,
      data,
      sideKey: "attacker",
      expectedStage: "attacker-roll",
      expectedActor: attacker,
    });
    if (r.dirty) {
      dirty = true;
      fixes.push("attacker.result");
    }
  }

  // Heal defender lane: No Defense is a deterministic failure state.
  if (data.defender?.noDefense === true && !data.defender?.result) {
    data.defender = data.defender ?? {};
    data.defender.defenseType = data.defender.defenseType ?? "none";
    data.defender.label = data.defender.label ?? "No Defense";
    data.defender.testLabel = data.defender.testLabel ?? "No Defense";
    data.defender.defenseLabel = data.defender.defenseLabel ?? "No Defense";
    data.defender.target = Number.isFinite(Number(data.defender.target))
      ? Number(data.defender.target)
      : 0;
    data.defender.tn = data.defender.tn ?? {
      finalTN: 0,
      baseTN: 0,
      totalMod: 0,
      breakdown: [{ key: "base", label: "No Defense", value: 0, source: "base" }],
    };
    data.defender.result = {
      rollTotal: 100,
      target: 0,
      isSuccess: false,
      degree: 1,
      textual: "1 DoF",
      isCriticalSuccess: false,
      isCriticalFailure: false,
    };
    dirty = true;
    fixes.push("defender.result(noDefense)");
  }

  // Heal defender lane from roll message (includes TN commit).
  if (
    defender &&
    data.defender?.rollMessageId &&
    !data.defender?.result &&
    data.defender?.noDefense !== true
  ) {
    const r = await _hydrateSideResultFromRollMessageId({
      message,
      data,
      sideKey: "defender",
      expectedStage: "defender-roll",
      expectedActor: defender,
    });
    if (r.dirty) {
      dirty = true;
      fixes.push("defender.result");
    }
  }

  // Normalize resolved state: if both sides exist, ensure outcome/advantage/status are present.
  const hasAttacker = Boolean(data.attacker?.result);
  const hasDefender = Boolean(data.defender?.result) || Boolean(data.defender?.noDefense);

  if (hasAttacker && hasDefender) {
    const currentOutcome = _getDefenderOutcome(data, data.defender);
    const needsOutcome = !currentOutcome || typeof currentOutcome !== "object";

    if (needsOutcome) {
      const baseOutcome = _resolveOutcomeRAW(data, data.defender);
      const outcome = _applyAoEEvadeOutcome(data, baseOutcome);
      if (outcome) {
        _setDefenderOutcome(data, data.defender, outcome);
        _setDefenderAdvantage(
          data,
          data.defender,
          _computeAdvantageRAW(data, outcome, data.defender)
        );

        const allResolved = _getDefenderEntries(data).every((def) =>
          Boolean(_getDefenderOutcome(data, def))
        );
        if (allResolved) {
          data.status = "resolved";
          data.context.phase = "resolved";
          if (!data.context.resolvedAt) data.context.resolvedAt = Date.now();
          _cleanupAutoRollContext(data.context);
        }
        dirty = true;
        fixes.push("outcome/status");
      }
    }
  }

  if (dirty) {
    data.context = data.context ?? {};
    data.context.selfHeal = {
      at: Date.now(),
      by: game.user.id,
      reason: String(reason ?? ""),
      fixes,
    };

    _logDebug("selfHeal", {
      messageId: message.id,
      reason,
      fixes,
      attackerRollMessageId: data.attacker?.rollMessageId ?? null,
      defenderRollMessageId: data.defender?.rollMessageId ?? null,
    });

    await _updateCard(message, data);
  }

  return { dirty, resolved: Boolean(_getDefenderOutcome(data, data.defender)) };
}
