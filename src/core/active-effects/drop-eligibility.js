import { getFlagValueWithFallback } from "../system/flags.js";
import { getEffectChanges } from "../../utils/compat.js";
import { getEffectGenericExpiry } from "./expiry.js";

/** Classify relocation without changing an effect or reconstructing its mechanics. */
export function getEffectDropRestriction(effect) {
  if (!effect || effect.documentName !== "ActiveEffect") return "Unavailable";
  if (effect.duration?.expired === true) return "Expired";
  const flag = key => getFlagValueWithFallback(effect, key);
  const expiry = getEffectGenericExpiry(effect);
  // Unanchored turn-relative effects depend implicitly on their current actor's workflow.
  if (["turn-start", "turn-end"].includes(expiry?.mode) && !expiry.combatantId) return "Managed";
  const managed = [
    "wound", "wounds", "shock", "isOriginAE", "originAEUuid", "originAEId",
    "hasUpkeep", "upkeepAwaiting", "pairedBuff", "pairedSourceTargetUuids",
    "linkedEntities", "bufferApplied", "OverTime", "overTime", "overtime",
    "zone", "rune", "summon", "areaUuid", "areaUuids", "regionUuid", "regionUuids",
    "overTimeState", "sourceActorUuid", "targetActorUuid", "sourceTokenUuid", "targetTokenUuid",
  ];
  if (managed.some(key => {
    const value = flag(key);
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  })) return "Managed";
  if (getEffectChanges(effect).some(change => /^(?:flags\.(?:uesrpg|uesrpg-3ev4)\.)?OverTime(?:\.|$)/i.test(change.key ?? ""))) return "Managed";
  if (["opponentUuid", "opponentTokenUuid", "actorTokenUuid", "itemUuid", "requireIsolatedDuel"].some(key => flag(`conditions.${key}`))) return "Managed";
  if (["source.tokenUuid", "target.tokenUuid", "source.actorUuid", "target.actorUuid"].some(key => flag(key))) return "Managed";
  if (String(flag("condition.source") ?? "").startsWith("grappleOwner:")) return "Managed";
  // Frenzied removal runs its own resource/fatigue workflow, so it is not standalone.
  if (String(flag("condition.key") ?? effect.flags?.core?.statusId ?? "").toLowerCase() === "frenzied"
    || Array.from(effect.statuses ?? []).includes("frenzied")) return "Managed";
  return null;
}
