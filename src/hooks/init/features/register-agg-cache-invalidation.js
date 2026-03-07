import { registerOnce } from "../../_internal/hook-registry.js";
import { isDebugEnabled } from "../../../utils/debug.js";

export function registerAggCacheInvalidationHooks() {
  registerOnce("hooks:agg-cache-invalidation", () => {
    const invalidateActorAggCacheFromItem = (item) => {
      const actor = item?.parent;
      if (!actor || actor.documentName !== "Actor") return;
      if (Object.prototype.hasOwnProperty.call(actor, "_aggCache")) actor._aggCache = null;
      if (Object.prototype.hasOwnProperty.call(actor, "_aeApplicableCache")) actor._aeApplicableCache = null;
      if (Object.prototype.hasOwnProperty.call(actor, "_aeTotalsMap")) actor._aeTotalsMap = null;
    };

    Hooks.on("preUpdateItem", (item, _changes, _options, _userId) => invalidateActorAggCacheFromItem(item));
    Hooks.on("updateItem", (item, _changes, _options, _userId) => invalidateActorAggCacheFromItem(item));
    Hooks.on("createItem", (item, _options, _userId) => invalidateActorAggCacheFromItem(item));
    Hooks.on("deleteItem", (item, _options, _userId) => invalidateActorAggCacheFromItem(item));

    Hooks.on("preDeleteItem", (item) => {
      if (item.type !== "skill") return;
      if (!isDebugEnabled()) return;
      console.warn("UESRPG | preDeleteItem skill", item.name, new Error().stack);
    });
  });
}
