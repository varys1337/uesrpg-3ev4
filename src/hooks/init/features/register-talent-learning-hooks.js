import { registerOnce } from "../../_internal/hook-registry.js";
import {
  TALENT_LEARNING_MODE,
  getTalentLearningMode,
  validateTalentLearning,
  notifyTalentLearningResult,
} from "../../../core/traits/talent-learning.js";
import { isManagedXpPurchaseItem } from "../../../core/advancement/purchase-service.js";

export function registerTalentLearningHooks() {
  registerOnce("hooks:talent-learning", () => {
    Hooks.on("preCreateItem", (item, data, _options, userId) => {
      try {
        if (game.userId !== userId) return;

        const actor = item?.parent;
        if (!actor || actor.documentName !== "Actor") return;
        if (actor.type !== "Player Character") return;

        const itemType = String(data?.type ?? item?.type ?? "").toLowerCase();
        if (itemType !== "talent") return;
        if (isManagedXpPurchaseItem(actor, item)) return;

        // Enforce mode validates the complete projected batch on the purchase
        // authority. Individual pre-create hooks cannot see earlier batch grants.
        if (getTalentLearningMode() !== TALENT_LEARNING_MODE.WARN) return;
        notifyTalentLearningResult(validateTalentLearning(actor, data, { source: "preCreateItem" }));
      } catch (err) {
        console.error("UESRPG | Talent learning preCreateItem hook failed", err);
      }
    });

    // Paid creation is prepared/finalized by SimpleItem batch lifecycle overrides.
  });
}
