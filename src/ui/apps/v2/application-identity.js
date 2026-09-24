/**
 * Supply the documented ApplicationV2 `uniqueId` discriminator for a
 * document-scoped application whose DEFAULT_OPTIONS.id contains `{id}`.
 */
export function withApplicationUniqueId(options = {}, discriminator = "default") {
  const source = String(options?.uniqueId ?? "").trim()
    || discriminator?.uuid
    || discriminator?.id
    || discriminator
    || "default";
  const normalized = String(source)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "default";
  return { ...options, uniqueId: normalized };
}
