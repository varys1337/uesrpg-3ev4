/**
 * Shared lightweight view builders for AppV2 sheet contexts.
 *
 * These helpers intentionally avoid full `toObject()` cloning for actor sheets.
 * They provide the minimum stable shape consumed by templates and existing
 * prepare helpers while preserving live derived `system` data.
 */

export function buildActorSheetActorView(actor) {
  return {
    _id: actor?.id ?? null,
    id: actor?.id ?? null,
    uuid: actor?.uuid ?? null,
    name: actor?.name ?? "",
    img: actor?.img ?? CONST.DEFAULT_TOKEN,
    type: actor?.type ?? "",
    flags: actor?.flags ?? {},
    system: actor?.system ?? {},
  };
}

export function buildActorSheetItemView(item) {
  return {
    _id: item?.id ?? null,
    id: item?.id ?? null,
    name: item?.name ?? "",
    img: item?.img ?? CONST.DEFAULT_TOKEN,
    type: item?.type ?? "",
    flags: item?.flags ?? {},
    system: item?.system ?? {},
  };
}

export function buildActorSheetEffectView(effect) {
  return {
    _id: effect?.id ?? null,
    id: effect?.id ?? null,
    name: effect?.name ?? "",
    img: effect?.img ?? CONST.DEFAULT_TOKEN,
    transfer: Boolean(effect?.transfer),
    disabled: Boolean(effect?.disabled),
  };
}

export function buildActorSheetItems(actor) {
  return Array.from(actor?.items?.contents ?? [], buildActorSheetItemView);
}

export function buildActorSheetEffects(actor, { filter = null } = {}) {
  const out = [];
  for (const effect of actor?.effects?.contents ?? []) {
    if (typeof filter === "function" && !filter(effect)) continue;
    out.push(buildActorSheetEffectView(effect));
  }
  return out;
}
