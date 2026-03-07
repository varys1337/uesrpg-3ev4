import { FLAG_SCOPE } from "../../../core/constants.js";
import { registerOnce } from "../../_internal/hook-registry.js";
import { requestUpdateDocument } from "../../../utils/authority-proxy.js";

export function registerDefaultItemAETransferHook() {
  registerOnce("hooks:default-item-ae-transfer", () => {
    Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
      try {
        if (game.userId !== userId) return;

        const parent = effect?.parent ?? options?.parent ?? null;
        if (!parent || parent.documentName !== "Item") return;

        if (data?.transfer !== undefined) return;

        if (foundry?.utils?.mergeObject) {
          foundry.utils.mergeObject(data, { transfer: true }, { inplace: true });
        } else {
          data.transfer = true;
        }

        const existingFlags = data?.flags ?? {};
        const scopeFlags = existingFlags[FLAG_SCOPE] ?? {};

        const itemUuid = parent?.uuid ?? parent?.id ?? "";
        const effectName = String(data?.name ?? "").trim().toLowerCase().replace(/\s+/g, "-") || "effect";
        const effectGroup = `enchantment.${itemUuid}.${effectName}`;

        const enhancedFlags = {
          ...existingFlags,
          [FLAG_SCOPE]: {
            ...scopeFlags,
            constant: true,
            owner: scopeFlags.owner ?? "item",
            effectGroup: scopeFlags.effectGroup ?? effectGroup,
            stackRule: scopeFlags.stackRule ?? "override",
            source: scopeFlags.source ?? "enchantment",
            cursed: scopeFlags.cursed ?? false
          }
        };

        if (foundry?.utils?.mergeObject) {
          foundry.utils.mergeObject(data, { flags: enhancedFlags }, { inplace: true });
        } else {
          data.flags = enhancedFlags;
        }
      } catch (err) {
        console.error("UESRPG | Default Item AE transfer preCreate failed", err);
      }
    });

    Hooks.on("createActiveEffect", async (effect, _options, userId) => {
      try {
        if (game.userId !== userId) return;
        const parent = effect?.parent;
        if (!parent || parent.documentName !== "Item") return;

        if (effect.transfer) return;

        const itemType = String(parent.type ?? "").toLowerCase();
        if (itemType === "talent" || itemType === "trait" || itemType === "power") return;

        const ownerActor = parent?.parent;
        if (!ownerActor) return;
        await requestUpdateDocument(effect, { transfer: true });
      } catch (err) {
        console.error("UESRPG | Default Item AE transfer create fallback failed", err);
      }
    });
  });
}
