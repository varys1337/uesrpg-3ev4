/**
 * src/core/combat/damage/tokens.js
 * UESRPG 3e v4 — Item Token Collection and Normalization
 *
 * Utilities for extracting quality/trait tokens from items and normalizing them for comparison.
 */

/**
 * Normalize a token to lowercase with whitespace trimmed.
 * @param {string} token
 * @returns {string}
 */
export function normalizeToken(token) {
  return String(token ?? "").trim().toLowerCase();
}

/**
 * Normalize a token with aggressive whitespace/punctuation removal for loose matching.
 * @param {string} token
 * @returns {string}
 */
export function normalizeTokenLoose(token) {
  return normalizeToken(token).replace(/[\s._-]+/g, "");
}

/**
 * Collect all quality/trait tokens from an item's structured qualities, traits, and activation data.
 * Returns normalized (lowercase, trimmed) tokens.
 *
 * @param {Item} item
 * @returns {string[]}
 */
export function collectItemTokens(item) {
  const sys = item?.system ?? {};
  const tokens = [];

  // Structured qualities
  const structured = Array.isArray(sys.qualitiesStructuredInjected)
    ? sys.qualitiesStructuredInjected
    : Array.isArray(sys.qualitiesStructured)
      ? sys.qualitiesStructured
      : [];

  for (const q of structured) {
    if (!q) continue;
    const key = typeof q === "string" ? q : (q.key ?? q.name ?? q.label ?? "");
    if (key) tokens.push(key);
  }

  // Traits
  const traits = Array.isArray(sys.qualitiesTraitsInjected)
    ? sys.qualitiesTraitsInjected
    : Array.isArray(sys.qualitiesTraits)
      ? sys.qualitiesTraits
      : [];

  for (const t of traits) {
    if (!t) continue;
    tokens.push(t);
  }

  // Activation damage qualities
  const activationDamage = sys.activation?.damage ?? null;
  const activationStructured = Array.isArray(activationDamage?.qualitiesStructured) 
    ? activationDamage.qualitiesStructured 
    : [];
  
  for (const q of activationStructured) {
    if (!q) continue;
    const key = typeof q === "string" ? q : (q.key ?? q.name ?? q.label ?? "");
    if (key) tokens.push(key);
  }

  // Activation damage traits
  const activationTraits = Array.isArray(activationDamage?.qualitiesTraits) 
    ? activationDamage.qualitiesTraits 
    : [];
  
  for (const t of activationTraits) {
    if (!t) continue;
    tokens.push(t);
  }

  // Activation roll tags
  const tags = Array.isArray(sys.activation?.roll?.tags) 
    ? sys.activation.roll.tags 
    : [];
  
  for (const tag of tags) {
    if (!tag) continue;
    tokens.push(tag);
  }

  return tokens.map(normalizeToken).filter(Boolean);
}

/**
 * Check if an item has a specific token (loose comparison).
 *
 * @param {Item} item
 * @param {string} tokenKey
 * @returns {boolean}
 */
export function itemHasToken(item, tokenKey) {
  const target = normalizeTokenLoose(tokenKey);
  if (!target) return false;
  
  const tokens = collectItemTokens(item);
  if (!tokens.length) return false;
  
  return tokens.some(t => normalizeTokenLoose(t) === target);
}
