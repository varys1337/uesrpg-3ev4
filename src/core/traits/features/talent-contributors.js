/**
 * src/core/features/talent-contributors.js
 *
 * Emit FeatureMods for Talent items (passive, derived-data effects only).
 *
 * Does NOT rewrite activation-based talent logic — that stays in the
 * individual talent automation modules (combat-talents, racial-talents, etc.).
 * This module handles "always-on" passive bonuses that talents contribute
 * to derived actor totals.
 */

import { makeFeatureMod, FEATURE_DOMAINS, STACKING_MODES, normalizeFeatureKey } from "./feature-mod.js";
import { normalizeTalentKey } from "../talents-api.js";

// ─── Item bonus fields (same as traits — talents can also set hpBonus etc.) ──

const ITEM_BONUS_FIELDS = [
  { field: "hpBonus",     domain: FEATURE_DOMAINS.HP,              path: "system.hp.bonus",              stacking: STACKING_MODES.ADD },
  { field: "mpBonus",     domain: FEATURE_DOMAINS.MP,              path: "system.magicka.bonus",         stacking: STACKING_MODES.ADD },
  { field: "spBonus",     domain: FEATURE_DOMAINS.SP,              path: "system.stamina.bonus",         stacking: STACKING_MODES.ADD },
  { field: "lpBonus",     domain: FEATURE_DOMAINS.LP,              path: "system.luck_points.bonus",     stacking: STACKING_MODES.ADD },
  { field: "wtBonus",     domain: FEATURE_DOMAINS.WOUND_THRESHOLD, path: "system.wound_threshold.bonus", stacking: STACKING_MODES.ADD },
  { field: "speedBonus",  domain: FEATURE_DOMAINS.SPEED,           path: "system.speed.bonus",           stacking: STACKING_MODES.ADD },
  { field: "iniBonus",    domain: FEATURE_DOMAINS.INITIATIVE,      path: "system.initiative.bonus",      stacking: STACKING_MODES.ADD },
  { field: "swimBonus",   domain: FEATURE_DOMAINS.SPEED,           path: "system.speed.swimBonus",       stacking: STACKING_MODES.ADD },
  { field: "flyBonus",    domain: FEATURE_DOMAINS.SPEED,           path: "system.speed.flyBonus",        stacking: STACKING_MODES.ADD },
];

const RESIST_FIELDS = [
  { field: "diseaseR",  path: "system.resistance.diseaseR"  },
  { field: "fireR",     path: "system.resistance.fireR"     },
  { field: "frostR",    path: "system.resistance.frostR"    },
  { field: "shockR",    path: "system.resistance.shockR"    },
  { field: "poisonR",   path: "system.resistance.poisonR"   },
  { field: "magicR",    path: "system.resistance.magicR"    },
  { field: "silverR",   path: "system.resistance.silverR"   },
  { field: "sunlightR", path: "system.resistance.sunlightR" },
];


// ─── Known passive talent contributions ──────────────────────────────
// Some talents have hardcoded derived effects that are currently
// implemented inline in character.js / npc.js. We emit FeatureMods
// for these so the Feature Inspector sees them, but the actual math
// still runs in prepare (we're not changing behavior yet).

/**
 * Talents with deterministic passive effects (Chapter 4).
 * Each entry maps a normalized talent slug to its contributions.
 */
const PASSIVE_TALENT_EFFECTS = {
  "untouchable": {
    note: "WT = 3×LB (override; computed in prepare)",
    domain: FEATURE_DOMAINS.WOUND_THRESHOLD,
    path: "system.wound_threshold.override",
    mode: "set",
    stacking: STACKING_MODES.OVERRIDE,
    label: "Untouchable (WT = 3×LB)",
    // Value is actor-dependent, emitted dynamically below
  },
  "enduring": {
    note: "Halve fatigue penalties",
    domain: FEATURE_DOMAINS.MISC,
    path: "system.fatigue.halvePenalty",
    mode: "boolean",
    stacking: STACKING_MODES.ANY,
    label: "Enduring (halve fatigue penalties)",
    value: true,
  },
  "unstoppable": {
    note: "Halve passive wound penalties",
    domain: FEATURE_DOMAINS.MISC,
    path: "system.wounds.halvePenalty",
    mode: "boolean",
    stacking: STACKING_MODES.ANY,
    label: "Unstoppable (halve wound penalties)",
    value: true,
  },
  "wallofsteel": {
    note: "Ignore armor speed penalties",
    domain: FEATURE_DOMAINS.SPEED,
    path: "system.speed.ignoreArmorPenalty",
    mode: "boolean",
    stacking: STACKING_MODES.ANY,
    label: "Wall of Steel (ignore armor speed penalties)",
    value: true,
  },
};


/**
 * Emit FeatureMods for a single Talent item.
 *
 * @param {Actor}  actor  The owning actor (read-only context).
 * @param {Item}   item   The talent item.
 * @returns {FeatureMod[]}
 */
export function contributeTalentMods(actor, item) {
  if (!item || String(item.type ?? "") !== "talent") return [];

  const sys = item.system ?? {};
  const talentSlug = normalizeTalentKey(item.name);

  const source = {
    type: "talent",
    key: talentSlug,
    itemName: item.name ?? "",
    itemUuid: item.uuid ?? "",
    itemId: item.id ?? "",
  };

  const mods = [];

  // ── Item-level bonus fields (hpBonus, resistances, etc.) ──
  for (const { field, domain, path, stacking } of ITEM_BONUS_FIELDS) {
    const val = Number(sys[field] ?? 0);
    if (!Number.isFinite(val) || val === 0) continue;
    mods.push(makeFeatureMod({
      domain,
      path,
      mode: "add",
      value: val,
      source,
      rule: { chapter: 4, name: `${item.name}: ${field}`, stacking },
    }));
  }

  for (const { field, path } of RESIST_FIELDS) {
    const val = Number(sys[field] ?? 0);
    if (!Number.isFinite(val) || val === 0) continue;
    mods.push(makeFeatureMod({
      domain: FEATURE_DOMAINS.RESISTANCE,
      path,
      mode: "add",
      value: val,
      source,
      rule: { chapter: 4, name: `${item.name}: ${field}`, stacking: STACKING_MODES.ADD },
    }));
  }

  // ── Known passive effects ──
  const passiveEntry = PASSIVE_TALENT_EFFECTS[talentSlug];
  if (passiveEntry) {
    let value = passiveEntry.value;

    // Dynamic value for Untouchable: 3 × LB
    if (talentSlug === "untouchable") {
      const lckBonus = Math.max(0, Math.floor(Number(actor?.system?.characteristics?.lck?.total ?? 0) / 10));
      value = 3 * lckBonus;
    }

    if (value !== undefined && value !== null) {
      mods.push(makeFeatureMod({
        domain: passiveEntry.domain,
        path: passiveEntry.path,
        mode: passiveEntry.mode,
        value,
        source,
        rule: { chapter: 4, name: passiveEntry.label, stacking: passiveEntry.stacking },
      }));
    }
  }

  // ── Characteristic bonus overrides (replace IR/WT characteristic) ──
  if (sys.replace?.ini?.characteristic && sys.replace.ini.characteristic !== "none") {
    mods.push(makeFeatureMod({
      domain: FEATURE_DOMAINS.INITIATIVE,
      path: "system.initiative.replaceCharacteristic",
      mode: "set",
      value: sys.replace.ini.characteristic,
      source,
      rule: { chapter: 4, name: `${item.name}: IR uses ${sys.replace.ini.characteristic}`, stacking: STACKING_MODES.OVERRIDE },
    }));
  }

  if (sys.replace?.wt?.characteristic && sys.replace.wt.characteristic !== "none") {
    mods.push(makeFeatureMod({
      domain: FEATURE_DOMAINS.WOUND_THRESHOLD,
      path: "system.wound_threshold.replaceCharacteristic",
      mode: "set",
      value: sys.replace.wt.characteristic,
      source,
      rule: { chapter: 4, name: `${item.name}: WT uses ${sys.replace.wt.characteristic}`, stacking: STACKING_MODES.OVERRIDE },
    }));
  }

  return mods;
}
