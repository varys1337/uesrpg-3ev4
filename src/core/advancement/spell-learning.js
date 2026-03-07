import {
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
  requestUpdateDocument,
} from "../../utils/authority-proxy.js";
import { _num, _num as asNumber } from "../../utils/coerce.js";
import { getMagicSkillLevel, isActorTrainedInMagicSchool } from "../magic/magicka-utils.js";
import { FLAG_SCOPE } from "../system/namespace.js";

const CHARGEN_NS = FLAG_SCOPE;
const CHARGEN_PATH = "chargen";

function asString(value) {
  return String(value ?? "").trim();
}

function normalizeSchool(value) {
  return asString(value).toLowerCase();
}

function getSpellLevel(spell) {
  return Math.max(1, Math.min(7, _num(spell?.system?.level, 1)));
}

function getConfiguredPurchaseMode() {
  try {
    const mode = String(game.settings.get(CHARGEN_NS, "chargenMagicPurchaseMode") ?? "both").trim();
    if (mode === "xpOnly" || mode === "drakesOnly" || mode === "both") return mode;
  } catch (_err) {
    /* no-op */
  }
  return "both";
}

function getSpellDrakesCost(spellLike) {
  const sys = spellLike?.system ?? {};
  const candidates = [
    sys.drakesCost,
    sys.drakes,
    sys.price,
    sys.costDrakes,
    sys.value,
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

function extractSourceUuid(spellLike) {
  const explicit = asString(spellLike?.uuid);
  if (explicit) return explicit;
  const coreSource = asString(spellLike?.flags?.core?.sourceId);
  if (coreSource) return coreSource;
  return "";
}

export function spellSignature(spellLike) {
  const school = normalizeSchool(spellLike?.system?.school);
  const level = getSpellLevel(spellLike);
  const type = normalizeSpellLearningType(spellLike);
  const name = asString(spellLike?.name).toLowerCase();
  return `${name}|${school}|${level}|${type}`;
}

function getActorItemsArray(actorLike) {
  const items = actorLike?.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (typeof items?.[Symbol.iterator] === "function") return Array.from(items);
  if (Array.isArray(items?.contents)) return items.contents;
  return [];
}

function getOwnedSpellSourceUuid(itemLike) {
  return (
    asString(itemLike?.getFlag?.(CHARGEN_NS, "spellSourceUuid")) ||
    asString(itemLike?.flags?.[CHARGEN_NS]?.spellSourceUuid) ||
    asString(itemLike?.flags?.core?.sourceId)
  );
}

export function buildKnownSpellIndex(actorLike, _options = {}) {
  const bySourceUuid = new Set();
  const bySignature = new Set();
  const items = getActorItemsArray(actorLike);
  for (const it of items) {
    if (it?.type !== "spell") continue;
    const sourceUuid = getOwnedSpellSourceUuid(it);
    if (sourceUuid) bySourceUuid.add(sourceUuid);
    bySignature.add(spellSignature(it));
  }
  return { bySourceUuid, bySignature };
}

function hasDuplicateKnownSpell(actor, spellLike, knownSpellIndex = null) {
  if (!actor) return false;
  const sourceUuid = extractSourceUuid(spellLike);
  const signature = spellSignature(spellLike);

  if (knownSpellIndex) {
    if (sourceUuid && knownSpellIndex.bySourceUuid?.has?.(sourceUuid)) return true;
    return Boolean(knownSpellIndex.bySignature?.has?.(signature));
  }

  const index = buildKnownSpellIndex(actor);
  if (sourceUuid && index.bySourceUuid.has(sourceUuid)) return true;
  return index.bySignature.has(signature);
}

function canLearnRitual(actor) {
  if (game.user?.isGM) return true;
  return Boolean(actor?.getFlag?.(CHARGEN_NS, "chargen")?.allowRitualLearning);
}

export function computeSpellLearningSummary(logEntries) {
  const rows = Array.isArray(logEntries) ? logEntries : [];
  const learned = rows.filter((r) => r?.outcome === "learned");
  const blocked = rows.filter((r) => r?.outcome === "blocked");

  const bySchool = {};
  const byType = {};
  let spentXp = 0;
  let spentDrakes = 0;
  for (const row of learned) {
    const school = asString(row?.spell?.school || "unknown").toLowerCase() || "unknown";
    bySchool[school] = (bySchool[school] ?? 0) + 1;
    const type = asString(row?.spell?.type || "conventional").toLowerCase() || "conventional";
    byType[type] = (byType[type] ?? 0) + 1;
    spentXp += asNumber(row?.costs?.xp, 0);
    spentDrakes += asNumber(row?.costs?.drakes, 0);
  }

  return {
    learnedCount: learned.length,
    blockedCount: blocked.length,
    spentXp,
    spentDrakes,
    bySchool,
    byType,
    updatedAt: new Date().toISOString(),
  };
}

function getSpellLearningLogCap() {
  try {
    const n = Number(game.settings.get(CHARGEN_NS, "chargenSpellLearningLogCap") ?? 0);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  } catch (_err) {
    return 0;
  }
}

export async function appendSpellLearningLog(actor, row, options = {}) {
  const chargen = actor.getFlag(CHARGEN_NS, CHARGEN_PATH) ?? {};
  const container = chargen.spellLearning ?? {};
  const log = Array.isArray(container.log) ? [...container.log] : [];
  log.push(row);
  const cap = Number.isFinite(Number(options?.logCap))
    ? Math.max(0, Math.trunc(Number(options.logCap)))
    : getSpellLearningLogCap();
  const nextLog = (cap > 0 && log.length > cap) ? log.slice(-cap) : log;

  await requestUpdateDocument(actor, {
    [`flags.${CHARGEN_NS}.chargen.spellLearning.log`]: nextLog,
    [`flags.${CHARGEN_NS}.chargen.spellLearning.lastSummary`]: computeSpellLearningSummary(nextLog),
  });
  return nextLog;
}

export function normalizeSpellLearningType(spell) {
  const raw = asString(spell?.system?.spellType || spell?.spellType).toLowerCase();
  if (raw === "ritual") return "ritual";
  if (raw === "unconventional") return "unconventional";
  if (Boolean(spell?.system?.isRitual) || Boolean(spell?.flags?.[CHARGEN_NS]?.isRitual)) return "ritual";
  return "conventional";
}

export function getSpellcastingLevelForSpell(actor, spell) {
  const school = normalizeSchool(spell?.system?.school);
  return Math.max(0, getMagicSkillLevel(actor, school));
}

export function computeSpellLearningCosts(spell, _actor, options = {}) {
  const type = normalizeSpellLearningType(spell);
  const level = getSpellLevel(spell);
  const mode = options.purchaseMode ?? getConfiguredPurchaseMode();

  let xpCost = 0;
  if (type === "conventional") xpCost = 20 * level;
  else if (type === "unconventional") xpCost = 30 * level;
  else xpCost = 25;

  const drakesCost = type === "ritual" ? 0 : getSpellDrakesCost(spell);
  const allowedPayments = [];
  if (mode !== "drakesOnly") allowedPayments.push("xp");
  if (mode !== "xpOnly" && drakesCost > 0 && type !== "ritual") allowedPayments.push("drakes");

  return {
    type,
    level,
    xpCost,
    drakesCost,
    allowedPayments,
    purchaseMode: mode,
  };
}

export function validateSpellLearningPurchase(actor, spell, paymentMode = "xp", options = {}) {
  if (!actor || actor.documentName !== "Actor") {
    return { ok: false, reason: "No valid actor selected.", costs: null, gating: {} };
  }
  if (!spell) {
    return { ok: false, reason: "No spell selected.", costs: null, gating: {} };
  }

  const costs = computeSpellLearningCosts(spell, actor, options);
  const school = normalizeSchool(spell?.system?.school);
  const spellcastingLevel = getSpellcastingLevelForSpell(actor, spell);
  const trained = isActorTrainedInMagicSchool(actor, school);
  const withinSpellcastingLevel = costs.level <= spellcastingLevel;
  const duplicate = hasDuplicateKnownSpell(actor, spell, options?.knownSpellIndex ?? null);
  const ritualAllowed = costs.type !== "ritual" || canLearnRitual(actor);
  const paymentAllowed = costs.allowedPayments.includes(paymentMode);
  const xp = asNumber(actor.system?.xp, 0);
  const wealth = asNumber(actor.system?.wealth, 0);
  const hasFunds = paymentMode === "xp" ? xp >= costs.xpCost : wealth >= costs.drakesCost;

  const gating = {
    school,
    trained,
    spellcastingLevel,
    requiredSpellLevel: costs.level,
    withinSpellcastingLevel,
    duplicate,
    ritualAllowed,
    paymentAllowed,
    hasFunds,
  };

  if (!paymentAllowed) return { ok: false, reason: "Selected payment mode is disabled by settings.", costs, gating };
  if (duplicate) return { ok: false, reason: "Spell is already known.", costs, gating };
  if (!trained) return { ok: false, reason: `Need training in ${school || "this school"}.`, costs, gating };
  if (!withinSpellcastingLevel) return {
    ok: false,
    reason: `Spell level ${costs.level} exceeds Spellcasting Level ${spellcastingLevel}.`,
    costs,
    gating,
  };
  if (!ritualAllowed) return { ok: false, reason: "Ritual learning requires GM permission.", costs, gating };
  if (!hasFunds) {
    const req = paymentMode === "xp" ? costs.xpCost : costs.drakesCost;
    const have = paymentMode === "xp" ? xp : wealth;
    return { ok: false, reason: `Insufficient ${paymentMode === "xp" ? "XP" : "Drakes"} (${have}/${req}).`, costs, gating };
  }

  return { ok: true, reason: "", costs, gating };
}

export async function applySpellLearningPurchase(actor, spellData, purchaseOptions = {}) {
  const paymentMode = purchaseOptions.paymentMode === "drakes" ? "drakes" : "xp";
  const validation = validateSpellLearningPurchase(actor, spellData, paymentMode, purchaseOptions);
  if (!validation.ok) {
    await appendSpellLearningLog(actor, {
      outcome: "blocked",
      reason: validation.reason,
      paymentMode,
      spell: {
        name: asString(spellData?.name) || "Unknown",
        school: normalizeSchool(spellData?.system?.school),
        level: getSpellLevel(spellData),
        type: normalizeSpellLearningType(spellData),
      },
      costs: {
        xp: asNumber(validation.costs?.xpCost, 0),
        drakes: asNumber(validation.costs?.drakesCost, 0),
      },
      timestamp: new Date().toISOString(),
    });
    return { ok: false, reason: validation.reason, validation };
  }

  const sourceUuid = extractSourceUuid(spellData);
  const rawData = typeof spellData?.toObject === "function" ? spellData.toObject() : foundry.utils.deepClone(spellData);
  rawData.type = "spell";
  rawData.flags = rawData.flags ?? {};
  rawData.flags[CHARGEN_NS] = rawData.flags[CHARGEN_NS] ?? {};
  if (sourceUuid) rawData.flags[CHARGEN_NS].spellSourceUuid = sourceUuid;

  const created = await requestCreateEmbeddedDocuments(actor, "Item", [rawData]);
  const createdSpell = created?.[0] ?? null;
  if (!createdSpell) {
    return { ok: false, reason: "Failed to create spell item.", validation };
  }

  const costXp = paymentMode === "xp" ? validation.costs.xpCost : 0;
  const costDrakes = paymentMode === "drakes" ? validation.costs.drakesCost : 0;
  const actorXp = asNumber(actor.system?.xp, 0);
  const actorWealth = asNumber(actor.system?.wealth, 0);
  const updates = {};
  if (costXp > 0) updates["system.xp"] = actorXp - costXp;
  if (costDrakes > 0) updates["system.wealth"] = actorWealth - costDrakes;

  try {
    if (Object.keys(updates).length) await requestUpdateDocument(actor, updates);
  } catch (err) {
    await requestDeleteEmbeddedDocuments(actor, "Item", [createdSpell.id]);
    await appendSpellLearningLog(actor, {
      outcome: "blocked",
      reason: "Resource deduction failed; rolled back created spell.",
      paymentMode,
      spell: {
        name: createdSpell.name,
        school: normalizeSchool(createdSpell.system?.school),
        level: getSpellLevel(createdSpell),
        type: normalizeSpellLearningType(createdSpell),
      },
      costs: { xp: costXp, drakes: costDrakes },
      timestamp: new Date().toISOString(),
    });
    return { ok: false, reason: String(err?.message ?? err), validation };
  }

  await appendSpellLearningLog(actor, {
    outcome: "learned",
    reason: "",
    paymentMode,
    spell: {
      id: createdSpell.id,
      name: createdSpell.name,
      school: normalizeSchool(createdSpell.system?.school),
      level: getSpellLevel(createdSpell),
      type: normalizeSpellLearningType(createdSpell),
    },
    costs: { xp: costXp, drakes: costDrakes },
    sourceUuid,
    timestamp: new Date().toISOString(),
  });

  return {
    ok: true,
    reason: "",
    createdSpell,
    paymentMode,
    costs: { xp: costXp, drakes: costDrakes },
    validation,
  };
}
