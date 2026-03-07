/**
 * src/core/combat/opposed-rolls.js
 *
 * Thin canonical adapter for opposed attack entry.
 */

import { OpposedWorkflow } from "./opposed-workflow.js";

function _tokenUuid(token) {
  return token?.document?.uuid ?? token?.uuid ?? null;
}

async function _performCanonicalPending(attackerToken, defenderToken, {
  attackerTarget = null,
  weapon = null
} = {}) {
  if (!attackerToken || !defenderToken) {
    ui.notifications.warn("Both attacker and defender tokens must be specified.");
    return null;
  }

  const attacker = attackerToken.actor;
  const defender = defenderToken.actor;
  if (!attacker || !defender) {
    ui.notifications.warn("Both attacker and defender actors must be resolved.");
    return null;
  }

  const attackerTokenUuid = _tokenUuid(attackerToken);
  const defenderTokenUuid = _tokenUuid(defenderToken);
  if (!attackerTokenUuid || !defenderTokenUuid) {
    ui.notifications.warn("Unable to resolve token UUIDs for the opposed workflow.");
    return null;
  }

  return OpposedWorkflow.createPending({
    attackerTokenUuid,
    defenderTokenUuid,
    attackerTarget,
    weaponUuid: weapon?.uuid ?? null,
    mode: "attack"
  });
}

export const OpposedRoll = {
  /**
   * Canonical opposed attack entry-point.
   * Returns a pending opposed chat message (or null).
   */
  async perform(attackerToken, defenderToken, options = {}) {
    return _performCanonicalPending(attackerToken, defenderToken, options);
  }
};
