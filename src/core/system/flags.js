import { FLAG_SCOPE } from "./namespace.js";

export const LEGACY_FLAG_SCOPE = "uesrpg";

export function getCanonicalFlags(doc) {
  return doc?.flags?.[FLAG_SCOPE] ?? {};
}

export function getLegacyFlags(doc) {
  return doc?.flags?.[LEGACY_FLAG_SCOPE] ?? {};
}

export function getSystemFlagsWithFallback(doc) {
  const canonical = getCanonicalFlags(doc);
  if (canonical && Object.keys(canonical).length) return canonical;
  return getLegacyFlags(doc);
}

export function getFlagValueWithFallback(doc, key) {
  const canonical = getCanonicalFlags(doc);
  if (foundry.utils.hasProperty(canonical, key)) {
    return foundry.utils.getProperty(canonical, key);
  }
  const legacy = getLegacyFlags(doc);
  return foundry.utils.getProperty(legacy, key);
}

export function buildSystemFlagUpdate(partial) {
  return { [`flags.${FLAG_SCOPE}`]: partial };
}

export async function getDocumentFlagWithFallback(doc, key) {
  const canonical = await doc?.getFlag?.(FLAG_SCOPE, key);
  if (canonical !== undefined) return canonical;
  return await doc?.getFlag?.(LEGACY_FLAG_SCOPE, key);
}

export async function setSystemFlag(doc, key, value) {
  return await doc?.setFlag?.(FLAG_SCOPE, key, value);
}

export async function unsetSystemFlag(doc, key) {
  return await doc?.unsetFlag?.(FLAG_SCOPE, key);
}
