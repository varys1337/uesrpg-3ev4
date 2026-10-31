/**
 * src/core/integrations/polyglot.js
 *
 * Expose the language catalog and register a Polyglot provider before init.
 * The provider reads actor language and trait data without rewriting it.
 */

import { getChoiceLabel, getLanguageComparisonKey, LANGUAGE_CHOICES } from "../social/social-choices.js";
import { getSocialStateFromSystem } from "../social/social-data.js";
import { hasActorTrait } from "../traits/trait-registry.js";
import { actorHasTrait as hasNamedActorTrait } from "../magic/magic-modifiers.js";

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

const CHOICE_KEYS = new Map(LANGUAGE_CHOICES.map(choice => [
  getLanguageComparisonKey(choice.name), slugifyLanguage(choice.id),
]));

function polyglotLanguageKeys(name, languages) {
  const comparison = getLanguageComparisonKey(name);
  if (!comparison) return [];
  const knownKey = CHOICE_KEYS.get(comparison);
  const keys = new Set();
  if (knownKey && Object.hasOwn(languages ?? {}, knownKey)) keys.add(knownKey);
  for (const [key, entry] of Object.entries(languages ?? {})) {
    if (getLanguageComparisonKey(entry?.label) === comparison) keys.add(key);
  }
  if (!keys.size) keys.add(knownKey ?? String(name).slugify({ replacement: "_" }));
  return [...keys];
}

/** Register before Foundry's init hook so Polyglot can discover this provider. */
export function registerPolyglotProvider() {
  Hooks.once("polyglot.init", (LanguageProvider) => {
    if (typeof LanguageProvider !== "function" || !game.polyglot?.api?.registerSystem) return;

    class UesrpgLanguageProvider extends LanguageProvider {
      async getLanguages() {
        if (this.replaceLanguages) {
          this.languages = {};
          return;
        }
        const settings = game.settings.get("polyglot", "Languages") ?? {};
        const languages = {};
        for (const choice of LANGUAGE_CHOICES) {
          const key = slugifyLanguage(choice.id);
          if (!key || languages[key]) continue;
          languages[key] = {
            label: getChoiceLabel(choice),
            font: settings[key]?.font ?? this.languages?.[key]?.font ?? this.defaultFont,
            rng: settings[key]?.rng ?? this.languages?.[key]?.rng ?? "default",
          };
        }
        this.languages = languages;
      }

      getSystemDefaultLanguage() {
        return this.languages?.cyrodilic ? "cyrodilic" : super.getSystemDefaultLanguage();
      }

      getUserLanguages(actor) {
        const cyrodilic = polyglotLanguageKeys("Cyrodilic", this.languages);
        const spoken = new Set(cyrodilic);
        const illiterate = hasActorTrait(actor, "illiterate") || hasNamedActorTrait(actor, "Illiterate");
        const written = new Set(illiterate ? [] : cyrodilic);
        const entries = getSocialStateFromSystem(actor?.system ?? {}).languages.entries;
        for (const entry of entries) {
          for (const key of polyglotLanguageKeys(entry.name, this.languages)) {
            if (entry.speak) spoken.add(key);
            if (entry.readWrite && !illiterate) written.add(key);
          }
        }
        return [spoken, written];
      }

      conditions(language) {
        return Boolean(game.polyglot?.literateLanguages?.has(language));
      }
    }

    game.polyglot.api.registerSystem(UesrpgLanguageProvider);
  });
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
      // Catalog IDs retain the established Polyglot keys when a book spelling changes.
      const key = slugifyLanguage(choice?.id ?? choice?.name);
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
