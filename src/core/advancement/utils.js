export function asTrimmedString(value) {
  return String(value ?? "").trim();
}

export function normalizeLowercaseString(value) {
  return asTrimmedString(value).toLowerCase();
}

export function getActorItemsArray(actorLike) {
  const items = actorLike?.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (typeof items?.[Symbol.iterator] === "function") return Array.from(items);
  if (Array.isArray(items?.contents)) return items.contents;
  return [];
}
