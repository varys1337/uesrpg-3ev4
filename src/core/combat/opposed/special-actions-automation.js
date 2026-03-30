/**
 * src/core/combat/opposed/special-actions-automation.js
 *
 * Special Actions advantage automation for opposed combat.
 * Extracted from monolith (Phase 15) to eliminate code duplication and improve modularity.
 *
 * Exported functions:
 * - executeAdvantageSpecialActions: Handle auto-win and free special actions from advantage spending
 */

import { getSpecialActionById } from "../combat-style-utils.js";
import { safeUpdateChatMessage } from "../../../utils/chat-message-socket.js";
import { _resolveDoc } from "./helpers/docs.js";

/**
 * Execute special actions selected during advantage spending.
 * Handles both auto-win (1 AP, auto-succeed) and free (0 AP, initiate test) modes.
 * 
 * @param {Object} opts
 * @param {Array<string>} opts.specialActionIds - Array of special action IDs to execute
 * @param {Object} opts.actor - Actor using the special actions
 * @param {Object} opts.opponent - Opponent actor
 * @param {string} opts.role - "attacker" or "defender" (for opposite result winner)
 * @param {string} opts.actorTokenUuid - UUID of actor's token
 * @param {string} opts.opponentTokenUuid - UUID of opponent's token
 */
export async function executeAdvantageSpecialActions({
  specialActionIds = [],
  actor,
  opponent,
  role = "attacker",
  actorTokenUuid = null,
  opponentTokenUuid = null,
  attackerStyleUuid = null,
  defenderStyleUuid = null,
  source = "advantage-free"
} = {}) {
  if (!Array.isArray(specialActionIds) || specialActionIds.length === 0) return;
  if (!actor) return;

  try {
    const { showSpecialAdvantageDialog, executeSpecialAction } = await import("../special-actions-helper.js");
    
    for (const saId of specialActionIds) {
      const choice = await showSpecialAdvantageDialog(saId);
      if (!choice) continue;

      if (choice.mode === "autowin") {
        // Auto-Win: consume 1 AP, skip test, auto-succeed
        const { ActionEconomy } = await import("../action-economy.js");
        const def = getSpecialActionById(saId);
        await ActionEconomy.spendAP(actor, 1, { 
          reason: `Special Advantage: ${def?.name} (Auto-Win)`, 
          silent: false 
        });

        const result = await executeSpecialAction({
          specialActionId: saId,
          actor: actor,
          target: opponent ?? null,
          isAutoWin: true,
          opposedResult: { winner: role }
        });

        if (result.success) {
          await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: actor }),
            content: `<div class="uesrpg-special-action-advantage"><b>Special Advantage (Auto-Win):</b><p>${result.message}</p></div>`,
            style: CONST.CHAT_MESSAGE_STYLES.OTHER
          });
        }
      } else if (choice.mode === "free") {
        // Free Action: 0 AP, initiate test with dropdown selection
        const actorToken = actorTokenUuid ? _resolveDoc(actorTokenUuid)?.object : null;
        const opponentToken = opponentTokenUuid ? _resolveDoc(opponentTokenUuid)?.object : null;

        if (actorToken && opponentToken) {
          const { SkillOpposedWorkflow } = await import("../../skills/opposed-workflow/index.js");
          const def = getSpecialActionById(saId);
          
          // Actor initiates the free action test against opponent
          const message = await SkillOpposedWorkflow.createPending({
            attackerTokenUuid: actorToken?.document?.uuid ?? actorToken?.uuid,
            defenderTokenUuid: opponentToken?.document?.uuid ?? opponentToken?.uuid,
            attackerSkillUuid: null,  // Let user choose from dropdown in card
            attackerSkillLabel: `${def?.name} (Special Action)`
          });

          const state = message?.flags?.["uesrpg-3ev4"]?.skillOpposed?.state;
          if (state) {
            state.specialActionId = saId;
            state.allowCombatStyle = true;
            state.isFreeAction = true;
            state.specialActionContext = {
              id: saId,
              source,
              attackerStyleUuid: attackerStyleUuid ?? null,
              defenderStyleUuid: defenderStyleUuid ?? null
            };

            await safeUpdateChatMessage(message, {
              flags: {
                "uesrpg-3ev4": {
                  skillOpposed: {
                    version: state.version ?? 1,
                    state
                  }
                }
              }
            });
          }

          ui.notifications.info(`Special Advantage: ${def?.name} used as free action.`);
        }
      }
    }
  } catch (err) {
    console.error("UESRPG | Failed to execute Special Advantage automation", err);
  }
}
