import { requestUpdateDocument } from "../../utils/authority-proxy.js";
import { requestXpPurchase } from "./purchase-service.js";
import { _num, _num as asNumber } from "../../utils/coerce.js";
import { getMagicSkillLevel, isActorTrainedInMagicSchool, normalizeSpellLearningType } from "../magic/magicka-utils.js";
import { FLAG_SCOPE } from "../system/namespace.js";
import { asTrimmedString, getActorItemsArray, normalizeLowercaseString } from "./utils.js";

const CHARGEN_NS = FLAG_SCOPE;
const CHARGEN_PATH = "chargen";

const asString = asTrimmedString;
const normalizeSchool = normalizeLowercaseString;

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

function canLearnRitual(actor, requester = game.user) {
  if (requester?.isGM) return true;
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

export { normalizeSpellLearningType };

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
  const withinSpellcastingLevel = costs.type === "ritual" || costs.level <= spellcastingLevel;
  const duplicate = hasDuplicateKnownSpell(actor, spell, options?.knownSpellIndex ?? null);
  const ritualAllowed = costs.type !== "ritual" || canLearnRitual(actor, options.requester ?? game.user);
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
  if (costs.type !== "ritual" && !trained) return { ok: false, reason: `Need training in ${school || "this school"}.`, costs, gating };
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
  const itemData = typeof spellData?.toObject === "function" ? spellData.toObject() : foundry.utils.deepClone(spellData);
  if (itemData && spellData?.uuid) itemData.uuid = spellData.uuid;
  const validation = validateSpellLearningPurchase(actor, itemData, paymentMode, purchaseOptions);
  if (!validation.ok) return { ok: false, reason: validation.reason, validation };
  const result = await requestXpPurchase(actor, "spellPurchase", { itemData, paymentMode });
  return { ...result, validation, paymentMode, costs: { xp: result.xpCost, drakes: result.wealthCost },
    createdSpell: result.ok ? actor.items.get(result.createdItemIds?.[0]) ?? null : null };
}
