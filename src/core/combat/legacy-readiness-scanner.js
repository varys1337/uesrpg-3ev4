/**
 * src/core/combat/legacy-readiness-scanner.js
 *
 * Non-mutating diagnostics for Release N legacy retirement readiness.
 */

import { getEffectChanges } from "../../utils/compat.js";

const LEGACY_RESISTANCE_KEYS = new Set([
  "physicalR",
  "fireR",
  "frostR",
  "shockR",
  "poisonR",
  "magicR",
  "silverR",
  "sunlightR",
]);

const LEGACY_OPPOSED_STAGES = new Set([
  "attacker-roll",
  "defender-roll",
  "defender-nodefense",
]);

function _asString(v) {
  return String(v ?? "").trim();
}

function _pushSample(list, value, limit) {
  if (!value) return;
  if (list.length >= limit) return;
  list.push(value);
}

function _countLegacyResistanceOnActor(actor) {
  let count = 0;
  const samples = [];
  const entries = foundry.utils.flattenObject(actor?.system ?? {});
  for (const key of Object.keys(entries)) {
    if (!key.includes("modifiers.resistance.")) continue;
    const short = key.split(".").pop();
    if (!LEGACY_RESISTANCE_KEYS.has(short)) continue;
    count += 1;
    _pushSample(samples, `${actor?.name ?? "Unknown"} :: system.${key}`, 25);
  }
  return { count, samples };
}

function _countLegacyResistanceOnEffects(effects = [], ownerLabel = "") {
  let count = 0;
  const samples = [];
  for (const effect of effects) {
    for (const ch of getEffectChanges(effect)) {
      const key = _asString(ch?.key);
      if (!key.includes(".resistance.")) continue;
      const short = key.split(".").pop();
      if (!LEGACY_RESISTANCE_KEYS.has(short)) continue;
      count += 1;
      _pushSample(samples, `${ownerLabel} :: effect ${effect?.name ?? effect?.id ?? "unknown"} -> ${key}`, 25);
    }
  }
  return { count, samples };
}

function _scanWeaponLegacyShape(item, actorName, limit) {
  const samples = [];
  let qualitiesFallback = 0;
  let rangeFallback = 0;

  if (item?.type !== "weapon") return { qualitiesFallback, rangeFallback, samples };

  const qualities = _asString(item?.system?.qualities);
  const range = _asString(item?.system?.range);
  const structured = Array.isArray(item?.system?.qualitiesStructuredInjected)
    ? item.system.qualitiesStructuredInjected
    : (Array.isArray(item?.system?.qualitiesStructured) ? item.system.qualitiesStructured : []);
  const traits = Array.isArray(item?.system?.qualitiesTraitsInjected)
    ? item.system.qualitiesTraitsInjected
    : (Array.isArray(item?.system?.qualitiesTraits) ? item.system.qualitiesTraits : []);
  const hasCanonicalQualityData = structured.length > 0 || traits.length > 0;

  // Count only when legacy free-text is still a likely dependency.
  if (qualities && !hasCanonicalQualityData) {
    qualitiesFallback += 1;
    _pushSample(samples, `${actorName} :: ${item?.name ?? "weapon"} depends on free-text system.qualities`, limit);
  }

  const derived = item?.system?.rangeBandsDerivedEffective ?? item?.system?.rangeBandsDerived ?? null;
  const hasDerivedRange = Boolean(derived && Number.isFinite(Number(derived.long)));
  const hasThrownBands = [item?.system?.thrownShort, item?.system?.thrownMed, item?.system?.thrownLong]
    .some((n) => Number.isFinite(Number(n)) && Number(n) > 0);

  // Count range dependency only when no canonical/derived range context is available.
  if (range && (range.includes("/") || /\d/.test(range)) && !hasDerivedRange && !hasThrownBands) {
    rangeFallback += 1;
    _pushSample(samples, `${actorName} :: ${item?.name ?? "weapon"} depends on legacy system.range="${range}"`, limit);
  }

  return { qualitiesFallback, rangeFallback, samples };
}

export async function runCombatLegacyReadinessScan({
  notify = true,
  sampleLimit = 50
} = {}) {
  const actors = Array.from(game?.actors?.contents ?? []);
  const messages = Array.from(game?.messages?.contents ?? []);

  const report = {
    phase: "N",
    timestamp: Date.now(),
    counts: {
      actorsScanned: actors.length,
      messagesScanned: messages.length,
      weaponFreeTextQualities: 0,
      weaponLegacyRange: 0,
      actorLegacyResistanceKeys: 0,
      effectLegacyResistanceKeys: 0,
      legacyOpposedMessageStages: 0,
    },
    samples: {
      weaponFreeTextQualities: [],
      weaponLegacyRange: [],
      actorLegacyResistanceKeys: [],
      effectLegacyResistanceKeys: [],
      legacyOpposedMessageStages: [],
    },
  };

  for (const actor of actors) {
    const actorName = _asString(actor?.name) || actor?.id || "Unknown Actor";
    for (const item of actor?.items ?? []) {
      const w = _scanWeaponLegacyShape(item, actorName, sampleLimit);
      report.counts.weaponFreeTextQualities += w.qualitiesFallback;
      report.counts.weaponLegacyRange += w.rangeFallback;
      for (const s of w.samples) {
        if (s.includes("system.qualities")) _pushSample(report.samples.weaponFreeTextQualities, s, sampleLimit);
        if (s.includes("system.range")) _pushSample(report.samples.weaponLegacyRange, s, sampleLimit);
      }
    }

    const actorRes = _countLegacyResistanceOnActor(actor);
    report.counts.actorLegacyResistanceKeys += actorRes.count;
    for (const s of actorRes.samples) _pushSample(report.samples.actorLegacyResistanceKeys, s, sampleLimit);

    const actorEff = _countLegacyResistanceOnEffects(actor?.effects ?? [], actorName);
    report.counts.effectLegacyResistanceKeys += actorEff.count;
    for (const s of actorEff.samples) _pushSample(report.samples.effectLegacyResistanceKeys, s, sampleLimit);

    for (const item of actor?.items ?? []) {
      const itemLabel = `${actorName} :: ${item?.name ?? "Item"}`;
      const itemEff = _countLegacyResistanceOnEffects(item?.effects ?? [], itemLabel);
      report.counts.effectLegacyResistanceKeys += itemEff.count;
      for (const s of itemEff.samples) _pushSample(report.samples.effectLegacyResistanceKeys, s, sampleLimit);
    }
  }

  for (const msg of messages) {
    const stage = _asString(msg?.flags?.["uesrpg-3ev4"]?.opposed?.stage);
    if (!stage || !LEGACY_OPPOSED_STAGES.has(stage)) continue;
    report.counts.legacyOpposedMessageStages += 1;
    _pushSample(
      report.samples.legacyOpposedMessageStages,
      `message:${msg?.id ?? "unknown"} stage:${stage}`,
      sampleLimit
    );
  }

  try {
    console.groupCollapsed("UESRPG | Combat legacy readiness scan");
    console.log(report);
    console.groupEnd();
  } catch (_err) {
    // no-op
  }

  if (notify) {
    const summary = [
      `qualities=${report.counts.weaponFreeTextQualities}`,
      `range=${report.counts.weaponLegacyRange}`,
      `resistanceKeys=${report.counts.actorLegacyResistanceKeys + report.counts.effectLegacyResistanceKeys}`,
      `legacyStages=${report.counts.legacyOpposedMessageStages}`
    ].join(", ");
    ui.notifications?.info?.(`Combat legacy scan complete: ${summary}`);
  }

  return report;
}
