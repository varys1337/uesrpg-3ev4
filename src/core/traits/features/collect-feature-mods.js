/**
 * @module traits/features/collect-feature-mods
 * @description Central "collect" stage that harvests FeatureMods from all trait/talent/power
 * items on an actor. This is called during actor derived-data preparation so that
 * the Feature Inspector and stacking enforcement have a single source of truth.
 *
 * Design invariants:
 *  - Pure read — **never** mutates documents.
 *  - Resilient — skips items with partial/bad data; logs once in debug mode.
 *  - Deterministic — same items in always produce same mods out.
 */

import { contributeTraitMods, contributeTalentMods, contributePowerMods } from "./contributors.js";
import { getFeatureConfig } from "./feature-config.js";
import { getRuleElements } from "./rule-elements.js";
import { FEATURE_DOMAINS, STACKING_MODES, makeFeatureMod } from "./feature-mod.js";
import { createSeverityDebugLogger } from "../../../utils/debug.js";

const _featureCollectDebug = createSeverityDebugLogger("activationDebug", "", "debug");

const _warnedKeys = new Set();

function _warnOnce(key, msg) {
  if (_warnedKeys.has(key)) return;
  _warnedKeys.add(key);
  _featureCollectDebug(`uesrpg | collectFeatureMods: ${msg}`);
}

const PASSIVE_FLAT_TARGET_MAP = Object.freeze({
  "system.hpBonus": { domain: FEATURE_DOMAINS.HP, path: "system.hp.bonus" },
  "system.spBonus": { domain: FEATURE_DOMAINS.SP, path: "system.stamina.bonus" },
  "system.mpBonus": { domain: FEATURE_DOMAINS.MP, path: "system.magicka.bonus" },
  "system.lpBonus": { domain: FEATURE_DOMAINS.LP, path: "system.luck_points.bonus" },
  "system.wtBonus": { domain: FEATURE_DOMAINS.WOUND_THRESHOLD, path: "system.wound_threshold.bonus" },
  "system.iniBonus": { domain: FEATURE_DOMAINS.INITIATIVE, path: "system.initiative.bonus" },
  "system.speedBonus": { domain: FEATURE_DOMAINS.SPEED, path: "system.speed.bonus" },
  "system.swimBonus": { domain: FEATURE_DOMAINS.SPEED, path: "system.speed.swimBonus" },
  "system.flyBonus": { domain: FEATURE_DOMAINS.SPEED, path: "system.speed.flyBonus" },
  "system.diseaseR": { domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.diseaseR" },
  "system.fireR": { domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.fireR" },
  "system.frostR": { domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.frostR" },
  "system.shockR": { domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.shockR" },
  "system.poisonR": { domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.poisonR" },
  "system.magicR": { domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.magicR" },
  "system.natToughnessR": { domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.natToughness" },
  "system.silverR": { domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.silverR" },
  "system.sunlightR": { domain: FEATURE_DOMAINS.RESISTANCE, path: "system.resistance.sunlightR" },
  // (#4) Weakness targets — allows Rule Elements to target weakness paths.
  "system.weakness.diseaseR": { domain: FEATURE_DOMAINS.WEAKNESS, path: "system.weakness.diseaseR" },
  "system.weakness.fireR": { domain: FEATURE_DOMAINS.WEAKNESS, path: "system.weakness.fireR" },
  "system.weakness.frostR": { domain: FEATURE_DOMAINS.WEAKNESS, path: "system.weakness.frostR" },
  "system.weakness.shockR": { domain: FEATURE_DOMAINS.WEAKNESS, path: "system.weakness.shockR" },
  "system.weakness.poisonR": { domain: FEATURE_DOMAINS.WEAKNESS, path: "system.weakness.poisonR" },
  "system.weakness.magicR": { domain: FEATURE_DOMAINS.WEAKNESS, path: "system.weakness.magicR" },
  "system.weakness.silverR": { domain: FEATURE_DOMAINS.WEAKNESS, path: "system.weakness.silverR" },
  "system.weakness.sunlightR": { domain: FEATURE_DOMAINS.WEAKNESS, path: "system.weakness.sunlightR" },
  // Characteristic bonuses
  "system.characteristicBonus.strChaBonus": { domain: FEATURE_DOMAINS.CHARACTERISTIC, path: "system.characteristics.str.bonus" },
  "system.characteristicBonus.endChaBonus": { domain: FEATURE_DOMAINS.CHARACTERISTIC, path: "system.characteristics.end.bonus" },
  "system.characteristicBonus.agiChaBonus": { domain: FEATURE_DOMAINS.CHARACTERISTIC, path: "system.characteristics.agi.bonus" },
  "system.characteristicBonus.intChaBonus": { domain: FEATURE_DOMAINS.CHARACTERISTIC, path: "system.characteristics.int.bonus" },
  "system.characteristicBonus.wpChaBonus": { domain: FEATURE_DOMAINS.CHARACTERISTIC, path: "system.characteristics.wp.bonus" },
  "system.characteristicBonus.prcChaBonus": { domain: FEATURE_DOMAINS.CHARACTERISTIC, path: "system.characteristics.prc.bonus" },
  "system.characteristicBonus.prsChaBonus": { domain: FEATURE_DOMAINS.CHARACTERISTIC, path: "system.characteristics.prs.bonus" },
  "system.characteristicBonus.lckChaBonus": { domain: FEATURE_DOMAINS.CHARACTERISTIC, path: "system.characteristics.lck.bonus" }
});

function _safeSlug(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9:_-]/g, "-");
}

function _resolveStacking(mode) {
  const m = _safeSlug(mode);
  if (m === "highest") return STACKING_MODES.HIGHEST;
  if (m === "none") return STACKING_MODES.NONE;
  if (m === "any") return STACKING_MODES.ANY;
  return STACKING_MODES.ADD;
}

function _buildRuleElementSource(item, element) {
  return {
    type: String(item?.type ?? "trait"),
    key: `rule-element:${_safeSlug(element?.type ?? "unknown")}:${_safeSlug(element?.id ?? "")}`,
    itemName: item?.name ?? "",
    itemUuid: item?.uuid ?? "",
    itemId: item?.id ?? ""
  };
}

function _collectPassiveRuleElementMods(item) {
  const out = [];
  const elements = getRuleElements(item);

  for (const element of elements) {
    if (!element?.enabled) continue;
    const source = _buildRuleElementSource(item, element);
    const type = String(element?.type ?? "");

    if (type === "flatModifier") {
      const map = PASSIVE_FLAT_TARGET_MAP[String(element?.target ?? "")];
      const value = Number(element?.value ?? 0);
      if (!map || !Number.isFinite(value) || value === 0) continue;
      out.push(makeFeatureMod({
        domain: map.domain,
        path: map.path,
        mode: "add",
        value,
        source,
        rule: { chapter: 4, name: element?.label ?? "Rule Element", stacking: _resolveStacking(element?.stacking) }
      }));
      continue;
    }

    if (type === "booleanFlag") {
      const target = _safeSlug(String(element?.target ?? "").replace(/^system\./, "").replace(/\./g, "_"));
      if (!target) continue;
      out.push(makeFeatureMod({
        domain: FEATURE_DOMAINS.FLAG,
        path: `flag.${target}`,
        mode: "boolean",
        value: Boolean(element?.value),
        source,
        rule: { chapter: 4, name: element?.label ?? "Rule Element", stacking: STACKING_MODES.ANY }
      }));
      continue;
    }

    if (type === "overrideValue") {
      const target = String(element?.target ?? "");
      const characteristic = _safeSlug(element?.characteristic ?? "");
      if (!target || !characteristic) continue;
      const path = (target === "system.replace.ini.characteristic")
        ? "system.initiative.replaceCharacteristic"
        : (target === "system.replace.wt.characteristic")
          ? "system.wound_threshold.replaceCharacteristic"
          : "";
      if (!path) continue;
      out.push(makeFeatureMod({
        domain: (path.includes("initiative")) ? FEATURE_DOMAINS.INITIATIVE : FEATURE_DOMAINS.WOUND_THRESHOLD,
        path,
        mode: "set",
        value: characteristic,
        source,
        rule: { chapter: 4, name: element?.label ?? "Rule Element", stacking: STACKING_MODES.OVERRIDE }
      }));
      continue;
    }

    if (type === "senseLossReduction") {
      const mode = _safeSlug(element?.mode ?? "halve") || "halve";
      out.push(makeFeatureMod({
        domain: FEATURE_DOMAINS.MISC,
        path: "system.senses.lossReduction",
        mode: "set",
        value: mode,
        source,
        rule: { chapter: 4, name: element?.label ?? "Rule Element", stacking: STACKING_MODES.OVERRIDE }
      }));
    }
  }

  return out;
}


/**
 * Collect FeatureMods from all embedded trait/talent/power items on an actor.
 *
 * @param {{ actor: Actor }} params
 * @returns {FeatureMod[]}  Flat array of all feature contributions (pre-stacking).
 */
export function collectFeatureMods({ actor }) {
  if (!actor) return [];

  const mods = [];
  const items = actor.items ?? [];

  for (const item of items) {
    if (!item) continue;
    const itemType = String(item.type ?? "");
    const isFeatureItem = itemType === "trait" || itemType === "talent" || itemType === "power";
    const fcfg = isFeatureItem ? getFeatureConfig(item) : null;

    try {
      if (isFeatureItem && fcfg?.enabled === false) continue;
      if (isFeatureItem && fcfg?.combatOnly && !game?.combat?.started) continue;
      if (isFeatureItem && fcfg?.outOfCombatAllowed === false && !game?.combat?.started) continue;

      if (itemType === "trait") {
        const contributed = contributeTraitMods(actor, item);
        if (contributed?.length) mods.push(...contributed);
      } else if (itemType === "talent") {
        const contributed = contributeTalentMods(actor, item);
        if (contributed?.length) mods.push(...contributed);
      } else if (itemType === "power") {
        const contributed = contributePowerMods(actor, item);
        if (contributed?.length) mods.push(...contributed);
      }

      if (isFeatureItem) {
        const passive = _collectPassiveRuleElementMods(item);
        if (passive.length) mods.push(...passive);
      }

      // ── Feature Config: stacking override ────────────────────────
      // If the item has a per-instance stacking override, apply it to
      // all mods emitted by this item (mutating rule.stacking in place).
      if (isFeatureItem) {
        if (fcfg.stackingOverride && fcfg.stackingOverride !== "default") {
          const overrideMode = fcfg.stackingOverride;
          for (let idx = 0; idx < mods.length; idx += 1) {
            const mod = mods[idx];
            if (mod.source?.itemId === item.id && mod.rule) {
              if (_isDebug()) {
                _warnOnce(
                  `stackOverride:${item.id}:${mod.path}`,
                  `Overriding stacking for "${item.name}" path="${mod.path}": ${mod.rule.stacking} → ${overrideMode}`,
                );
              }
              mods[idx] = makeFeatureMod({
                ...mod,
                rule: { ...(mod.rule ?? {}), stacking: overrideMode }
              });
            }
          }
        }
      }
    } catch (err) {
      _warnOnce(
        `err:${item.id ?? item.name}`,
        `Error collecting mods from ${itemType} "${item.name}": ${err.message}`,
      );
    }
  }

  return mods;
}

// ── Well-known override paths ────────────────────────────────────────────
const _OVERRIDE_PATHS = new Set([
  "system.initiative.replaceCharacteristic",
  "system.wound_threshold.replaceCharacteristic",
  "system.senses.lossReduction"
]);

/**
 * Filter a FeatureMod array to only include mods that should be *applied*
 * by {@link applyFeatureModTotals}. Excludes legacy-mirror mods that duplicate
 * values already handled by the item-aggregation pipeline.
 *
 * The item-aggregation pipeline (aggregateItemStats) already sums all item
 * schema bonus/resistance fields and writes them to actor system data. The
 * Feature Mod contributors (`_emitItemBonusMods`, `contributeTraitMods`
 * category mods) re-emit those same values for Feature Inspector display.
 * Applying them again via `applyFeatureModTotals` would double-count.
 *
 * What passes through:
 *  - Rule Element-sourced mods (intentional additional contributions)
 *  - (#6) Racial talent-sourced mods (computed bonuses not in item schema)
 *  - Boolean flags (undead, incorporeal, etc.)
 *  - Set/override values (characteristic replacement, sense loss reduction)
 *
 * @param {FeatureMod[]} mods  Full array of collected feature mods.
 * @returns {FeatureMod[]}     Mods safe for additive application.
 */
export function filterModsForApplication(mods) {
  if (!Array.isArray(mods) || mods.length === 0) return [];
  return mods.filter(m =>
    m.source?.key?.startsWith("rule-element:") ||
    m.source?.key?.startsWith("racial-talent:") ||
    m.mode === "boolean" ||
    m.mode === "set"
  );
}

/**
 * Apply stacked feature-mod totals to an actor's system data.
 *
 * This bridges the gap between `collectFeatureMods → reduceAllByStacking` (read-only
 * collection) and the derived-data pipeline that downstream functions consume.
 *
 * **IMPORTANT**: The `totals` map passed here should be derived from mods filtered
 * by {@link filterModsForApplication} to exclude legacy-mirror values that are already
 * handled by item-aggregation. Only Rule Element contributions, boolean flags, and
 * set/override values should be present.
 *
 * Three classes of modification:
 *  1. **Numeric flat modifiers** (flatModifier) — additive to the existing value at the
 *     target path (e.g. `system.hp.bonus += 5`).
 *  2. **Boolean flags** (booleanFlag) — stored on `actorSystemData._reFlags` so consumer
 *     functions can check for RE-sourced boolean toggles (e.g. `halfFatiguePenalty`).
 *  3. **Override / set values** (overrideValue, senseLossReduction) — stored on
 *     `actorSystemData._reOverrides` for well-known paths consumed by `_iniCalc`,
 *     `_woundThresholdCalc`, and `adjustSensePenalty`.
 *
 * Design invariants:
 *  - Must be called AFTER legacy derived data has been written (agg bonuses, AE mods)
 *    but BEFORE the derived calculations that consume those values (WT, speed, HP, etc.).
 *  - Pure mutation of `actorSystemData` — no document updates, no async, no side effects.
 *
 * @param {object} actorSystemData  The mutable `actorData.system` object.
 * @param {Map<string, number|boolean|string>} totals  Output of `reduceAllByStacking().totals`.
 */
export function applyFeatureModTotals(actorSystemData, totals) {
  if (!actorSystemData || !totals || !(totals instanceof Map) || totals.size === 0) return;

  // Ensure RE storage objects exist.
  actorSystemData._reFlags = actorSystemData._reFlags ?? {};
  actorSystemData._reOverrides = actorSystemData._reOverrides ?? {};

  for (const [path, value] of totals) {
    // ── Boolean flags (flag.xxx) ──────────────────────────────
    if (path.startsWith("flag.")) {
      const flagKey = path.slice(5); // strip "flag."
      if (flagKey) actorSystemData._reFlags[flagKey] = Boolean(value);
      continue;
    }

    // ── Override / set values for well-known paths ────────────
    if (_OVERRIDE_PATHS.has(path)) {
      actorSystemData._reOverrides[path] = value;
      continue;
    }

    // ── Numeric flat modifiers → additive ─────────────────────
    if (typeof value === "number" && Number.isFinite(value) && value !== 0) {
      // Convert "system.xxx.yyy" path to nested access on actorSystemData.
      const parts = path.replace(/^system\./, "").split(".");
      let target = actorSystemData;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target || typeof target !== "object") { target = null; break; }
        target = target[parts[i]];
      }
      if (target && typeof target === "object") {
        const lastKey = parts[parts.length - 1];
        target[lastKey] = (Number(target[lastKey]) || 0) + value;
      }
    }
  }
}

// ── Weakness → Resistance subtraction ────────────────────────────────────

/**
 * Mapping from weakness key to the corresponding resistance key.
 * Keys that exist in `system.weakness` but have no resistance analogue
 * (e.g. physicalR, natToughness) are excluded — weakness values for those
 * types have no resistance counterpart to subtract from.
 */
const _WEAKNESS_TO_RESISTANCE = Object.freeze({
  diseaseR:   "diseaseR",
  fireR:      "fireR",
  frostR:     "frostR",
  shockR:     "shockR",
  poisonR:    "poisonR",
  magicR:     "magicR",
  silverR:    "silverR",
  sunlightR:  "sunlightR",
});

/**
 * Subtract accumulated weakness values from corresponding resistance values.
 *
 * This is the final step in the Feature Mod pipeline: after all resistance
 * bonuses have been applied (via aggregation, AE modifiers, and Rule Elements),
 * any accumulated weakness values reduce the final resistance.
 *
 * Design:
 *  - Weakness values are always positive numbers representing vulnerability.
 *  - The subtraction MAY reduce resistance below zero (net vulnerability).
 *  - Pure mutation of `actorSystemData` — no document updates, no async.
 *  - Must be called AFTER `applyFeatureModTotals` and all AE modifier passes.
 *
 * @param {object} actorSystemData  The mutable `actorData.system` object.
 */
export function applyWeaknessToResistance(actorSystemData) {
  if (!actorSystemData) return;

  const weakness   = actorSystemData.weakness;
  const resistance = actorSystemData.resistance;
  if (!weakness || !resistance) return;

  for (const [wKey, rKey] of Object.entries(_WEAKNESS_TO_RESISTANCE)) {
    const wVal = Number(weakness[wKey]) || 0;
    if (wVal === 0) continue;
    resistance[rKey] = (Number(resistance[rKey]) || 0) - wVal;
  }
}
