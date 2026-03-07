import { registerOnce } from "../../_internal/hook-registry.js";
import {
  TALENT_LEARNING_MODE,
  validateTalentLearning,
  notifyTalentLearningResult,
  applyTalentLearningXpCost,
} from "../../../core/traits/talent-learning.js";
import { requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";

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

        const validation = validateTalentLearning(actor, data, { source: "preCreateItem" });
        if (validation.mode === TALENT_LEARNING_MODE.OFF) return;

        if (validation.mode === TALENT_LEARNING_MODE.WARN) {
          notifyTalentLearningResult(validation);
          return;
        }

        if (validation.mode === TALENT_LEARNING_MODE.ENFORCE && !validation.ok) {
          notifyTalentLearningResult(validation, { force: true });
          return false;
        }
      } catch (err) {
        console.error("UESRPG | Talent learning preCreateItem hook failed", err);
      }
    });

    Hooks.on("createItem", async (item, _options, userId) => {
      try {
        if (game.userId !== userId) return;

        if (!item || item.documentName !== "Item") return;
        if (String(item.type ?? "").toLowerCase() !== "talent") return;

        const actor = item.parent;
        if (!actor || actor.documentName !== "Actor") return;
        if (actor.type !== "Player Character") return;

        const validation = validateTalentLearning(actor, item, {
          source: "createItem",
          ignoreItemId: item.id,
        });

        if (validation.mode !== TALENT_LEARNING_MODE.ENFORCE) return;
        if (!validation.rulesOk) {
          notifyTalentLearningResult(validation, { force: true });
          await requestDeleteEmbeddedDocuments(actor, "Item", [item.id]);
          return;
        }

        const spend = await applyTalentLearningXpCost(actor, validation);
        if (!spend.ok) {
          ui.notifications?.warn?.(
            `Talent learning blocked (${item.name}). ${spend.reason ?? "Unable to deduct XP."}`
          );
          await requestDeleteEmbeddedDocuments(actor, "Item", [item.id]);
          return;
        }

        if (spend.spentXp > 0) {
          ui.notifications?.info?.(`Spent ${spend.spentXp} XP to learn ${item.name}.`);
        }
      } catch (err) {
        console.error("UESRPG | Talent learning createItem hook failed", err);
      }
    });
  });
}
