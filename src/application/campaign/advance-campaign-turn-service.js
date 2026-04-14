import {
  createArmyCampaignHistoryEntry,
  updateArmyCampaignState,
  WARFARE_ARMY_ACTIONS_PER_TURN,
} from "../../core/mass-warfare/campaign/state.js";
import { resolveGroupActorDocument } from "../foundry/adapters.js";

export const AdvanceCampaignTurnService = {
  async advanceTurn({ groupActorOrUuid } = {}) {
    const group = await resolveGroupActorDocument(groupActorOrUuid);
    if (!group) throw new Error("Missing Group actor for campaign turn advancement.");

    return updateArmyCampaignState(group, async (next) => {
      next.campaignTurn = Math.max(1, Number(next.campaignTurn ?? 1) + 1);
      next.remainingArmyActions = WARFARE_ARMY_ACTIONS_PER_TURN;
      next.campaignState.forcedMarchUsed = false;
      next.campaignState.scoutedThisTurn = false;
      next.campaignState.concealedThisTurn = false;
      next.campaignState.contactState = "none";
      next.campaignState.surpriseState = "none";
      next.supply.consecutiveOutOfSupplyTurns = next.supply.inSupply
        ? 0
        : Math.max(0, Number(next.supply.consecutiveOutOfSupplyTurns ?? 0) + 1);
      next.history.unshift(createArmyCampaignHistoryEntry("Advance Campaign Turn", `Turn ${next.campaignTurn}`, {
        consumesAction: false,
      }));
      return next;
    });
  },
};
