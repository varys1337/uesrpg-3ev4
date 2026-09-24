import { registerOnce } from "../_internal/hook-registry.js";
import { isDebugEnabled } from "../../utils/debug.js";
import {
  bumpActorSheetRevision,
  invalidateActorDerivedCache,
} from "../../core/actors/derived-cache/actor-derived-cache.js";

function _owningActor(document) {
  if (document?.documentName === "Actor") return document;
  if (document?.documentName === "Item" && document.parent?.documentName === "Actor") return document.parent;
  if (document?.documentName === "ActiveEffect") return _owningActor(document.parent);
  return null;
}

function _invalidateItemOwner(item) {
  const actor = _owningActor(item);
  if (!actor) return;
  invalidateActorDerivedCache(actor, { lanes: ["items", "ae", "prepare"] });
  bumpActorSheetRevision(actor);
}

function _invalidateEffectOwner(effect) {
  const actor = _owningActor(effect);
  if (!actor) return;
  invalidateActorDerivedCache(actor, { lanes: ["ae", "prepare"] });
  bumpActorSheetRevision(actor);
}

export function registerActorDerivedCacheInvalidation() {
  registerOnce("hooks:actor-derived-cache-invalidation", () => {
    Hooks.on("createItem", _invalidateItemOwner);
    Hooks.on("updateItem", _invalidateItemOwner);
    Hooks.on("deleteItem", _invalidateItemOwner);

    Hooks.on("createActiveEffect", _invalidateEffectOwner);
    Hooks.on("updateActiveEffect", _invalidateEffectOwner);
    Hooks.on("deleteActiveEffect", _invalidateEffectOwner);

    Hooks.on("updateActor", (actor, changed) => {
      if (actor?.documentName !== "Actor") return;
      bumpActorSheetRevision(actor);
      const touchedEquippedWeapons = Boolean(changed?.system?.equippedWeapons)
        || foundry.utils.hasProperty(changed, "system.equippedWeapons");
      if (touchedEquippedWeapons) invalidateActorDerivedCache(actor, { lanes: ["ae"] });
    });

    Hooks.on("preDeleteItem", (item) => {
      if (item?.type !== "skill" || !isDebugEnabled()) return;
      console.warn("UESRPG | preDeleteItem skill", item.name, new Error().stack);
    });
  });
}
