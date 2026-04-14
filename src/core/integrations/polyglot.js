/**
 * src/core/integrations/polyglot.js
 *
 * Polyglot module integration: expose the UESRPG language catalog using the
 * generic CONFIG[SYSTEM_ID_UPPER].languages convention that Polyglot reads.
 *
 * This module is the single source of truth for language exposure.
 * Called once during Hooks.once("init") via initHandler() in src/hooks/init.js.
 *
 * Safe: this only *defines* the catalog and does not mutate any Actor data.
 */

import { getChoiceLabel, LANGUAGE_CHOICES } from "../social/social-choices.js";

/**
 * Build a URL-safe slug from a language label.
 * Strips diacritics, apostrophes, and non-alphanumeric chars; collapses runs to "-".
 * @param {string} s
 * @returns {string}
 */
function slugifyLanguage(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Register the system language list on CONFIG[SYSTEM_ID_UPPER].languages.
 * Detects and warns on slug collisions (keeps the first occurrence).
 * No-ops gracefully if game.system is unavailable.
 */
export function registerPolyglotLanguages() {
  try {
    const systemIdUpper = String(game.system?.id ?? "").toUpperCase();
    if (!systemIdUpper) return;

    CONFIG[systemIdUpper] = CONFIG[systemIdUpper] ?? {};
    if (CONFIG[systemIdUpper].languages) return; // already registered

    const languages = {};
    const collisions = new Map();

    for (const choice of LANGUAGE_CHOICES ?? []) {
      const label = getChoiceLabel(choice);
      const key = slugifyLanguage(choice?.name);
      if (!key) continue;
      if (languages[key] && languages[key] !== label) {
        const list = collisions.get(key) ?? [languages[key]];
        list.push(label);
        collisions.set(key, list);
        continue;
      }
      languages[key] = label;
    }

    if (collisions.size > 0) {
      console.warn(
        "UESRPG | Polyglot language key collision(s) detected; keeping first occurrence:",
        Array.from(collisions.entries()).map(([k, v]) => ({ key: k, names: v }))
      );
    }

    CONFIG[systemIdUpper].languages = languages;
  } catch (err) {
    console.warn("UESRPG | Polyglot language exposure failed", err);
  }
}
