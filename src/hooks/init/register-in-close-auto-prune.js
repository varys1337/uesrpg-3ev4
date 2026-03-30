import { pruneInClosePair } from "../../core/conditions/status-hud.js";
import { FLAG_SCOPE } from "../../core/constants.js";
import { isReachLengthHomebrewEnabled } from "../../core/homebrew/reach-length/weapon.js";
import { measureTokenDistance } from "../../core/combat/opposed/range.js";
import { registerOnce } from "../_internal/hook-registry.js";
import { isDebugEnabled } from "../../utils/debug.js";
import { resolveUuidSync } from "../../utils/uuid-cache.js";

async function pruneMissingPartnerUuid(tokenDoc, partnerUuid) {
  const staleMap = foundry.utils.deepClone(tokenDoc.getFlag(FLAG_SCOPE, "reachLength.inCloseWith") ?? {});
  delete staleMap[partnerUuid];
  if (Object.keys(staleMap).length > 0) {
    await tokenDoc.setFlag(FLAG_SCOPE, "reachLength.inCloseWith", staleMap);
    return;
  }
  await tokenDoc.unsetFlag(FLAG_SCOPE, "reachLength.inCloseWith");
}

export function registerInCloseAutoPrune() {
  registerOnce("hooks:in-close-auto-prune", () => {
    Hooks.on("updateToken", async (tokenDoc, changed) => {
      try {
        if (!("x" in changed) && !("y" in changed)) return;
        if (!game.user?.isGM) return;
        if (!isReachLengthHomebrewEnabled()) return;

        const inCloseWith = tokenDoc.getFlag(FLAG_SCOPE, "reachLength.inCloseWith");
        if (!inCloseWith || !Object.keys(inCloseWith).length) return;

        const tokenPlaceable = canvas?.tokens?.get(tokenDoc.id);
        if (!tokenPlaceable) return;

        const cache = new Map();
        for (const [partnerUuid] of Object.entries(inCloseWith)) {
          const partnerDoc = resolveUuidSync(partnerUuid, { cache });
          if (!partnerDoc) {
            await pruneMissingPartnerUuid(tokenDoc, partnerUuid);
            continue;
          }

          const partnerPlaceable = canvas?.tokens?.get(partnerDoc.id);
          const dist = partnerPlaceable
            ? measureTokenDistance(tokenPlaceable, partnerPlaceable)
            : Infinity;

          if (dist != null && dist <= 1) continue;

          if (isDebugEnabled()) {
            console.log(`UESRPG | In Close auto-prune: ${tokenDoc.name} - ${partnerDoc.name} (dist=${dist})`);
          }
          await pruneInClosePair(tokenDoc, partnerDoc);
        }
      } catch (err) {
        if (isDebugEnabled()) console.warn("UESRPG | In Close auto-prune hook error", err);
      }
    });
  });
}
