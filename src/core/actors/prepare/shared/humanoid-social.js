import { getCampaignRankFromXpTotal } from "../../../advancement/progression.js";
import { getSocialStateFromSystem } from "../../../social/social-data.js";

export function applyHumanoidSocialStage(stage) {
  const { actorSystemData, options } = stage;

  if (!options.isNPC) {
    actorSystemData.campaignRank = getCampaignRankFromXpTotal(actorSystemData.xpTotal);
  }

  const intBonus = Number(stage.characteristicBonuses?.int ?? 0);
  actorSystemData.linguistics = actorSystemData.linguistics ?? {};
  actorSystemData.linguistics.max = Math.min(4, Math.max(0, intBonus - 2));
  actorSystemData.linguistics.known = actorSystemData.linguistics.known ?? "";

  const socialState = getSocialStateFromSystem(actorSystemData);
  actorSystemData.social = actorSystemData.social ?? {};
  actorSystemData.social.languages = actorSystemData.social.languages ?? {};
  actorSystemData.social.languages.entries = socialState.languages.entries;
  actorSystemData.social.factions = socialState.factions;
  actorSystemData.linguistics.known = socialState.languages.knownString;
}
