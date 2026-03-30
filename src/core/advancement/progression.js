import { _num as asNumber } from "../../utils/coerce.js";
import { CAMPAIGN_RANK_THRESHOLDS } from "../domain/constants.js";

export { CAMPAIGN_RANK_THRESHOLDS } from "../domain/constants.js";

function normalizeXpTotal(xpTotal) {
  return Math.max(0, asNumber(xpTotal, 0));
}

export function getCampaignRankThreshold(xpTotal) {
  const total = normalizeXpTotal(xpTotal);
  let match = CAMPAIGN_RANK_THRESHOLDS[0];
  for (const threshold of CAMPAIGN_RANK_THRESHOLDS) {
    if (total < threshold.minXp) break;
    match = threshold;
  }
  return match;
}

export function getCampaignRankFromXpTotal(xpTotal) {
  return getCampaignRankThreshold(xpTotal).label;
}

export function getMaxPurchasableSkillRankKeyFromXpTotal(xpTotal) {
  const rank = getCampaignRankThreshold(xpTotal).key;
  return rank === "master" ? "master" : rank;
}
