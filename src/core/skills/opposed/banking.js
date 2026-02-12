/**
 * src/core/skills/opposed/banking.js
 * Banked-choice workflow automation for opposed skill tests
 */

import { bankedAutoRollLocalLocks } from "./constants.js";
import { _bothSidesCommitted, _getMessageState } from "./schema.js";
import { _anyActiveGMOnline } from "./util.js";

/**
 * Banked-choice auto roll hook helper (GM-present).
 * Called from the global updateChatMessage hook when the parent card updates.
 */
export async function maybeAutoRollBanked(message, workflow) {
  try {
    const activeGM = game.users.activeGM ?? null;
    if (!activeGM) return;
    if (game.user.id !== activeGM.id) return;

    const data = _getMessageState(message);
    if (!data) return;

    // Only proceed once both sides have committed and no roll results exist yet.
    if (!_bothSidesCommitted(data)) return;
    if (data.attacker?.result || data.defender?.result || data.outcome || data.status === "resolved") return;

    await _autoRollBanked(message.id, { trigger: "hook" }, workflow);
  } catch (err) {
    console.error("UESRPG | Skill opposed banked GM auto-roll hook failed", err);
  }
}

/**
 * Banked-choice auto roll hook helper (no active GM).
 * Uses the parent message author as the authority runner.
 */
export async function maybeAutoRollBankedNoGM(message, workflow) {
  try {
    const activeGM = game.users.activeGM ?? null;
    if (activeGM) return;

    // Only the message author should attempt auto-roll to avoid concurrent updates.
    if (!message.isAuthor) return;

    const data = _getMessageState(message);
    if (!data) return;

    if (!_bothSidesCommitted(data)) return;
    if (data.attacker?.result || data.defender?.result || data.outcome || data.status === "resolved") return;

    await _autoRollBanked(message.id, { trigger: "hook-no-gm" }, workflow);
  } catch (err) {
    console.error("UESRPG | Skill opposed banked no-GM auto-roll hook failed", err);
  }
}

/**
 * Begin rolling a banked-choice opposed skill test once both sides have committed.
 * Rolls any unresolved lanes without prompting for additional choices.
 */
async function _autoRollBanked(parentMessageId, { trigger = "unknown" } = {}, workflow) {
  if (!parentMessageId) return;
  if (bankedAutoRollLocalLocks.has(parentMessageId)) return;
  bankedAutoRollLocalLocks.add(parentMessageId);

  try {
    const message = game.messages.get(parentMessageId) ?? null;
    if (!message) return;

    const data = _getMessageState(message);
    if (!data) return;

    if (!_bothSidesCommitted(data)) return;

    // If already resolved, do nothing.
    if (data.outcome || data.status === "resolved" || (data.attacker?.result && data.defender?.result)) return;

    // Roll attacker lane first if needed.
    if (!data.attacker?.result) {
      await workflow.handleAction(message, "attacker-roll-committed");
    }

    // Reload message for latest state.
    const fresh = game.messages.get(parentMessageId) ?? message;

    // Roll defender lane if needed.
    const updatedData = _getMessageState(fresh);
    if (updatedData && !updatedData.defender?.result) {
      await workflow.handleAction(fresh, "defender-roll-committed");
    }
  } catch (err) {
    console.error("UESRPG | Skill opposed banked auto-roll failed", err);
  } finally {
    setTimeout(() => bankedAutoRollLocalLocks.delete(parentMessageId), 2000);
  }
}

export { _autoRollBanked };
