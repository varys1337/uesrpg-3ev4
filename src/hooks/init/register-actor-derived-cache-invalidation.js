import { isOverTimeTickStateOnlyUpdate } from "../../core/active-effects/metadata.js";
import { registerOnce } from "../_internal/hook-registry.js";
import { isDebugEnabled } from "../../utils/debug.js";
import {
  bumpActorSheetRevision,
  bumpActorInventoryRevision,
  invalidateActorDerivedCache,
} from "../../core/actors/derived-cache/actor-derived-cache.js";
import { SYSTEM_ID } from "../../core/constants.js";
import { isDamageReceiptOnlyUpdate } from "../../core/combat/damage/receipt-metadata.js";

const RESOURCE_ONLY_PATHS = new Set([
  "system.hp.value", "system.tempHP", "system.hp.temp",
  "system.magicka.value", "system.stamina.value", "system.luck_points.value", "system.action_points.value", `flags.${SYSTEM_ID}.damageApplications`,
]);

function resourceOnlyChange(value, path = "") {
  if (RESOURCE_ONLY_PATHS.has(path)) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([key, entry]) => resourceOnlyChange(entry, path ? `${path}.${key}` : key));
}

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
  bumpActorInventoryRevision(actor);
}

function _invalidateEffectOwner(effect) {
  const actor = _owningActor(effect);
  if (!actor) return;
  invalidateActorDerivedCache(actor, { lanes: ["ae", "prepare"] });
  bumpActorSheetRevision(actor);
  bumpActorInventoryRevision(actor);
}

export function registerActorDerivedCacheInvalidation() {
  registerOnce("hooks:actor-derived-cache-invalidation", () => {
    Hooks.on("createItem", _invalidateItemOwner);
    Hooks.on("updateItem", _invalidateItemOwner);
    Hooks.on("deleteItem", _invalidateItemOwner);

    Hooks.on("createActiveEffect", _invalidateEffectOwner);
    Hooks.on("updateActiveEffect", (effect, changed) => {
      if (isOverTimeTickStateOnlyUpdate(changed)) {
        const actor = _owningActor(effect);
        if (actor) bumpActorSheetRevision(actor);
        return;
      }
      _invalidateEffectOwner(effect);
    });
    Hooks.on("deleteActiveEffect", _invalidateEffectOwner);

    Hooks.on("updateActor", (actor, changed) => {
      if (actor?.documentName !== "Actor") return;
      if (isDamageReceiptOnlyUpdate(changed)) return;
      bumpActorSheetRevision(actor);
      if (!resourceOnlyChange(changed)) bumpActorInventoryRevision(actor);
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
