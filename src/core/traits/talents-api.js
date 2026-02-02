/**
 * src/core/traits/talents-api.js
 *
 * Minimal, schema-safe helpers for working with Talent items.
 *
 * Design goals:
 *  - No schema churn: infer talent presence from embedded Item type "talent".
 *  - No hidden state: pure queries over actor/items.
 *  - Deterministic normalization: tolerate naming punctuation/case.
 */

/**
 * Normalize an arbitrary label into a stable lookup key.
 *
 * @param {string} v
 * @returns {string}
 */
export function normalizeTalentKey(v) {
  return String(v ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

// Canonical talent slugs we automate.
// Note: we intentionally map multiple human-readable names to a single slug.
const TALENT_NAME_ALIASES = {
  // Awareness talents
  honedsenses: ["Honed Senses"],
  onewithall: ["One with All"],
  keenintuition: ["Keen Intuition"],

  // Combat talents (automation)
  gladiator: ["Gladiator"],
  defender: ["Defender"],
  dualfighter: ["Dual Fighter", "Dual-Fighter"],
  rapidreload: ["Rapid Reload", "RapidReload"],
  dualrapidreloadfighter: ["Dual Rapid Reload Fighter", "Dual Rapid-Reload Fighter", "Dual RapidReload Fighter"],
  followupstrike: ["Follow-up Strike", "Follow Up Strike", "Followup Strike"],
  mightycleave: ["Mighty Cleave"],

  // DoS / test modifiers
  brawler: ["Brawler"],
  champion: ["Champion"],
  combatsenses: ["Combat Senses"],
  duelist: ["Duelist"],
  godofwar: ["God of War"],
  hyperawareness: ["Hyper Awareness"],
  lightningreflexes: ["Lightning Reflexes"],
  teamwork: ["Teamwork"],
  trickyfighter: ["Tricky Fighter"],
  unstoppablemight: ["Unstoppable Might"],
  wrestler: ["Wrestler"],

  // Initiative / defense
  fearsome: ["Fearsome"],

  exploitadvantage: ["Exploit Advantage"],

  // Damage / WT / penalties
  cripplingstrikes: ["Crippling Strikes"],
  eyeofvengeance: ["Eye of Vengeance"],
  killingblow: ["Killing Blow"],
  precise: ["Precise"],
  sneakattack: ["Sneak Attack"],
  assassinate: ["Assassinate"]
};

/**
 * Resolve a known talent slug from an arbitrary user-provided key.
 *
 * @param {string} key
 * @returns {string}
 */
export function resolveTalentSlug(key) {
  const k = normalizeTalentKey(key);
  if (!k) return "";
  if (TALENT_NAME_ALIASES[k]) return k;
  // Attempt to resolve by name.
  for (const [slug, names] of Object.entries(TALENT_NAME_ALIASES)) {
    if (names.some(n => normalizeTalentKey(n) === k)) return slug;
  }
  return k;
}

/**
 * Find the embedded Talent item on an actor.
 *
 * @param {Actor} actor
 * @param {string} keyOrName - slug (preferred) or display name
 * @returns {Item|null}
 */
export function getTalentItem(actor, keyOrName) {
  if (!actor) return null;
  const slug = resolveTalentSlug(keyOrName);
  const names = TALENT_NAME_ALIASES[slug] ?? [keyOrName];
  const nameKeys = new Set(names.map(normalizeTalentKey));

  const items = actor.items ?? [];
  for (const it of items) {
    if (!it || it.type !== "talent") continue;
    const n = normalizeTalentKey(it.name);
    if (n && (n === slug || nameKeys.has(n))) return it;
  }
  return null;
}

/**
 * @param {Actor} actor
 * @param {string} keyOrName
 * @returns {boolean}
 */
export function hasTalent(actor, keyOrName) {
  return Boolean(getTalentItem(actor, keyOrName));
}

const SKILL_RANK_TO_NUMBER = {
  untrained: 0,
  novice: 0,
  apprentice: 1,
  journeyman: 2,
  adept: 3,
  expert: 4,
  master: 5
};

/**
 * Return a skill rank (numeric) for a named Skill/MagicSkill/CombatStyle item.
 *
 * This is used by multiple talents that replace rolled DoS with "skill rank".
 *
 * @param {Actor} actor
 * @param {string} itemName
 * @param {{types?: string[]}} [opts]
 * @returns {number}
 */
export function getNamedItemRank(actor, itemName, { types = ["skill", "magicSkill", "combatStyle"] } = {}) {
  if (!actor || !itemName) return 0;
  const key = normalizeTalentKey(itemName);
  const allowed = new Set(types);
  for (const it of (actor.items ?? [])) {
    if (!it) continue;
    if (!allowed.has(it.type)) continue;
    if (normalizeTalentKey(it.name) !== key) continue;
    const rankKey = String(it.system?.rank ?? it.system?.level ?? "").toLowerCase().trim();
    return Number(SKILL_RANK_TO_NUMBER[rankKey] ?? 0);
  }
  return 0;
}

/**
 * Return a skill rank (numeric) for a Skill item by name.
 *
 * @param {Actor} actor
 * @param {string} skillName
 * @returns {number}
 */
export function getSkillRank(actor, skillName) {
  return getNamedItemRank(actor, skillName, { types: ["skill"] });
}

/**
 * Return a combat style rank (numeric) by style UUID or by display name.
 *
 * @param {Actor} actor
 * @param {{styleUuid?: string|null, styleName?: string|null}} [opts]
 * @returns {number}
 */
export function getCombatStyleRank(actor, { styleUuid = null, styleName = null } = {}) {
  if (!actor) return 0;

  if (styleUuid) {
    try {
      const doc = fromUuidSync(styleUuid);
      const styleItem = (doc?.documentName === "Item") ? doc : null;
      if (styleItem && styleItem.type === "combatStyle" && styleItem.actor?.id === actor.id) {
        const rankKey = String(styleItem.system?.rank ?? "").toLowerCase().trim();
        return Number(SKILL_RANK_TO_NUMBER[rankKey] ?? 0);
      }
    } catch (_e) {
      // ignore
    }
  }

  if (styleName) {
    return getNamedItemRank(actor, styleName, { types: ["combatStyle"] });
  }

  return 0;
}
