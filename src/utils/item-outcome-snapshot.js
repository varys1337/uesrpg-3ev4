import { resolveUuidSync } from "./uuid-cache.js";

export function captureItemOutcomeContext(item) {
  return { parentUuid: item?.parent?.uuid ?? null, pack: item?.compendium?.collection ?? null };
}

/** Restore source data without recreating or updating the consumed Item. */
export function restoreOutcomeItem(data, context = {}) {
  return new Item.implementation(foundry.utils.deepClone(data), {
    parent: resolveUuidSync(context.parentUuid), pack: context.pack ?? null,
  });
}
