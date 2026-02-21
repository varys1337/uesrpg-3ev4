/**
 * Items migration / normalization (v13-safe, no ApplicationV2 dependency).
 *
 * Scope:
 * - World Items (game.items)
 * - Embedded Items on Actors (game.actors[].items)
 *
 * Notes:
 * - Compendia are not auto-migrated here.
 * - This is a lightweight normalization pass intended to be safe to run on every startup.
 */

import { applyDefaults } from "./apply-defaults.js";
import { DEFAULTS } from "./item-defaults.generated.js";

const MODULE_ID = "uesrpg-3ev4";

/** @typedef {"melee"|"ranged"} AttackMode */

const _NON_NUMERIC_ALLOWLIST = {
  weapon: ["damage", "damage2", "damage3"],
  armor: [],
  ammunition: []
};

function _isNonNumericString(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !Number.isFinite(Number(trimmed));
}

function _extractFirstNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/[-+]?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function _inferTypedLaneFromText(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const map = [
    ["sunlight", "sunlight"],
    ["silver", "silver"],
    ["disease", "disease"],
    ["poison", "poison"],
    ["frost", "frost"],
    ["shock", "shock"],
    ["fire", "fire"],
    ["magic", "magic"],
  ];
  for (const [needle, out] of map) {
    if (raw.includes(needle)) return out;
  }
  return null;
}

function _parseLegacyTypedNumeric(value) {
  const number = _extractFirstNumber(value);
  const type = _inferTypedLaneFromText(value);
  return { number, type };
}

function _applyLegacyArmorTypedFields(system) {
  if (!system || typeof system !== "object") return false;
  let changed = false;
  const numericArmorFields = ["magic_ar", "special_ar", "armor", "blockRating"];

  for (const key of numericArmorFields) {
    const raw = system[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "number" && Number.isFinite(raw)) continue;

    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) {
        system[key] = 0;
        changed = true;
        continue;
      }

      const asNum = Number(trimmed);
      if (Number.isFinite(asNum)) {
        system[key] = asNum;
        changed = true;
        continue;
      }

      const parsed = _parseLegacyTypedNumeric(trimmed);
      if (parsed.number !== null) {
        system[key] = parsed.number;
        changed = true;
        if (parsed.type && !String(system.special_ar_type ?? "").trim()) {
          system.special_ar_type = parsed.type;
          changed = true;
        }
        continue;
      }
    }

    system[key] = 0;
    changed = true;
  }

  const sat = String(system.special_ar_type ?? "").trim().toLowerCase();
  const valid = new Set(["", "fire", "frost", "shock", "poison", "disease", "magic", "silver", "sunlight"]);
  if (!valid.has(sat)) {
    system.special_ar_type = _inferTypedLaneFromText(sat) ?? "";
    changed = true;
  }

  return changed;
}

function _supportedItemTypes() {
  return new Set(Object.keys(DEFAULTS?.itemSystem ?? {}));
}

function _debugEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, "opposedDebug");
  } catch (_e) {
    return false;
  }
}

function _itemHasTransferEffects(item) {
  try {
    const effects = item?.effects?.contents ?? item?.effects ?? [];
    return Array.isArray(effects) && effects.some((e) => {
      const obj = typeof e?.toObject === "function" ? e.toObject() : e;
      return !!(obj?.transfer);
    });
  } catch (_e) {
    return false;
  }
}

function _normalizeEnchantLevel(item, sys = {}) {
  const update = {};
  const raw = sys.enchant_level;
  const n = Number(raw);

  if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) {
    update["system.enchant_level"] = 0;
    return update;
  }

  // Legacy artifact: some imports/migrations defaulted enchant_level to 1.
  // If the item has no transfer Active Effects, treat it as unenchanted.
  if (n === 1 && !_itemHasTransferEffects(item)) {
    update["system.enchant_level"] = 0;
  }

  return update;
}

/**
 * Best-effort, deterministic inference of weapon attack mode from existing weapon data.
 *
 * We only infer "ranged" when we have explicit signals. Otherwise we return null
 * so the caller can apply the legacy default (currently melee).
 *
 * @param {Item} item
 * @param {object} sys
 * @returns {"melee"|"ranged"|null}
 */
function _inferAttackMode(item, sys = {}) {
  // 1) Structured qualities: explicit ranged signals
  const structured = Array.isArray(sys.qualitiesStructured) ? sys.qualitiesStructured : [];
  const sKeys = new Set(structured.map((q) => String(q?.key ?? "").toLowerCase()).filter(Boolean));
  if (sKeys.has("reload") || sKeys.has("thrown")) return "ranged";

  // 2) Explicit thrown range fields (newer schema)
  const ts = Number(sys.thrownShort ?? 0);
  const tm = Number(sys.thrownMed ?? 0);
  const tl = Number(sys.thrownLong ?? 0);
  if ([ts, tm, tl].some((n) => Number.isFinite(n) && n > 0)) return "ranged";

  // 3) Trait pills: explicit ranged identifiers (sling, etc.)
  const traits = Array.isArray(sys.qualitiesTraits) ? sys.qualitiesTraits : [];
  const tSet = new Set(traits.map((t) => String(t).toLowerCase()));
  if (tSet.has("sling")) return "ranged";

  // 4) Category-ish fields: deterministic keyword mapping (only promotes to ranged)
  const cat = String(sys.item_cat ?? sys.category ?? "").trim().toLowerCase();
  const style = String(sys.combatStyle ?? sys.skill ?? "").trim().toLowerCase();
  const name = String(item?.name ?? "").trim().toLowerCase();

  const hay = `${cat} ${style} ${name}`;
  // NOTE: These are only used to promote to ranged. If none match, we do not guess.
  const rangedKeywords = ["bow", "crossbow", "arbalest", "sling", "marksman", "archery", "ranged"];
  if (rangedKeywords.some((k) => hay.includes(k))) return "ranged";

  return null;
}

function _normalizeWeaponSystem(item, sys = {}) {
  const update = {};

  // Fix legacy typo: equippped -> equipped
  if (Object.prototype.hasOwnProperty.call(sys, "equippped") && !Object.prototype.hasOwnProperty.call(sys, "equipped")) {
    update["system.equipped"] = !!sys.equippped;
  }
  if (Object.prototype.hasOwnProperty.call(sys, "equippped")) {
    update["system.-=equippped"] = null;
  }

  // Ensure attackMode exists (melee|ranged).
  // Legacy assumption in this system has been melee unless explicitly ranged.
  const hasValidAttackMode = sys.attackMode === "melee" || sys.attackMode === "ranged";
  if (!hasValidAttackMode) {
    const inferred = _inferAttackMode(item, sys);
    if (inferred) update["system.attackMode"] = inferred;
    else update["system.attackMode"] = "melee";

    // Debug-only diagnostics when we had to fall back.
    if (!inferred && _debugEnabled()) {
      const ident = `${item?.type ?? "item"}:${item?.name ?? item?.id ?? "<unknown>"}`;
      console.warn(`${MODULE_ID} | attackMode inference fallback (defaulted to melee) for ${ident}`);
    }
  }

  // Ensure quality/material defaults
  if (!sys.qualityLevel) update["system.qualityLevel"] = "common";
  if (!sys.material) update["system.material"] = "standard";

  // Ensure structured qualities array
  if (!Array.isArray(sys.qualitiesStructured)) update["system.qualitiesStructured"] = [];

  // ------------------------------------------------------------
  // Reach migration
  // ------------------------------------------------------------
  // Reach used to exist as a structured quality (reach (X)) that was mirrored into system.reach.
  // Reach is now a dedicated Basic Property (system.reach) and is removed from qualitiesStructured.
  // We migrate any legacy structured reach into system.reach (non-destructive) and strip it.
  try {
    const structured = Array.isArray(sys.qualitiesStructured) ? sys.qualitiesStructured : [];
    const reachEntry = structured.find((q) => String(q?.key ?? "").toLowerCase() === "reach") ?? null;
    const reachFromStructured = Number(reachEntry?.value ?? 0);

    const reachFromSystemRaw = sys.reach;
    const reachFromSystem = Number(reachFromSystemRaw ?? 0);
    const systemHasReach = Number.isFinite(reachFromSystem) && reachFromSystem !== 0;

    if (!systemHasReach && Number.isFinite(reachFromStructured) && reachFromStructured !== 0) {
      update["system.reach"] = reachFromStructured;
    }

    if (reachEntry) {
      const filtered = structured.filter((q) => String(q?.key ?? "").toLowerCase() !== "reach");
      if (filtered.length !== structured.length) {
        update["system.qualitiesStructured"] = filtered;
      }
    }
  } catch (_e) {
    // Ignore and continue; migration must be best-effort and non-blocking.
  }

  // Reach bounds: Reach is a numeric field (max reach). Minimum reach is optional (0 for none).
  if (sys.reachMin === undefined || sys.reachMin === null || sys.reachMin === "") update["system.reachMin"] = 0;
  else {
    const n = Number(sys.reachMin);
    if (!Number.isFinite(n) || n < 0) update["system.reachMin"] = 0;
  }

  Object.assign(update, _normalizeEnchantLevel(item, sys));

  return update;
}

function _normalizeArmorSystem(item, sys = {}) {
  const update = {};

  if (!sys.qualityLevel) update["system.qualityLevel"] = "common";
  if (!sys.material) update["system.material"] = "standard";
  if (!sys.weightClass) update["system.weightClass"] = "none";

  if (!Array.isArray(sys.qualitiesStructured)) update["system.qualitiesStructured"] = [];

  Object.assign(update, _normalizeEnchantLevel(item, sys));

  return update;
}

function _normalizeAmmoSystem(item, sys = {}) {
  const update = {};

  // Per-10 pricing: if missing, backfill from legacy per-item price
  if (sys.pricePer10 === undefined || sys.pricePer10 === null) {
    const legacy = Number(sys.price ?? 0);
    update["system.pricePer10"] = Number.isFinite(legacy) ? legacy : 0;
  }

  if (!sys.arrowType) update["system.arrowType"] = "none";
  if (!sys.ammoMaterial) update["system.ammoMaterial"] = "standard";

  if (!Array.isArray(sys.qualitiesStructured)) update["system.qualitiesStructured"] = [];

  Object.assign(update, _normalizeEnchantLevel(item, sys));

  return update;
}

async function _migrateWorldItems() {
  const supportedTypes = _supportedItemTypes();
  const updates = [];
  for (const item of game.items.contents) {
    if (!supportedTypes.has(item.type)) continue;
    const update = _normalizeItemSystem(item);
    if (update) {
      update._id = item.id;
      updates.push(update);
    }
  }

  if (updates.length) {
    console.log(`${MODULE_ID} | Migrating ${updates.length} world item(s)`);
    await Item.updateDocuments(updates, { diff: false });
  }
}

async function _migrateActorItems() {
  const supportedTypes = _supportedItemTypes();
  for (const actor of game.actors.contents) {
    const updates = [];
    for (const item of actor.items.contents) {
      if (!supportedTypes.has(item.type)) continue;
      const update = _normalizeItemSystem(item);
      if (update) {
        update._id = item.id;
        updates.push(update);
      }
    }

    if (updates.length) {
      console.log(`${MODULE_ID} | Migrating ${updates.length} item(s) on actor ${actor.name}`);
      await actor.updateEmbeddedDocuments("Item", updates, { diff: false });
    }
  }
}

export async function migrateItemsIfNeeded() {
  // Lightweight normalization pass; safe to run on every startup.
  if (!game.user.isGM) return;
  const currentVersion = String(game.system?.version ?? "").trim() || "0";
  let state = {};
  try {
    state = JSON.parse(String(game.settings.get(MODULE_ID, "migrationState") ?? "{}")) ?? {};
  } catch (_e) {
    state = {};
  }
  if (state?.items === currentVersion) return;
  try {
    await _migrateWorldItems();
    await _migrateActorItems();

    // Record migration version after a successful pass.
    state.items = currentVersion;
    await game.settings.set(MODULE_ID, "migrationState", JSON.stringify(state));
  } catch (err) {
    console.error(`${MODULE_ID} | Item migration failed`, err);
    ui.notifications?.error?.("UESRPG item migration failed; check console for details.");
  }
}

// ---------------------------------------------------------------------------
// Always-safe normalization (not version-gated)
// ---------------------------------------------------------------------------

function _deepCloneSystem(sys) {
  try {
    return foundry?.utils?.deepClone ? foundry.utils.deepClone(sys ?? {}) : structuredClone(sys ?? {});
  } catch (_e) {
    return JSON.parse(JSON.stringify(sys ?? {}));
  }
}

function _ensureArmorItemCatNonBreaking(system) {
  // Non-breaking guardrail: template.json defines armor.item_cat as a mapping object,
  // but runtime code expects a string category in some places.
  // Normalization must NOT convert types.
  if (!Object.prototype.hasOwnProperty.call(system, "item_cat")) {
    system.item_cat = "";
    return true;
  }
  return false;
}

function _applyLegacyGuardrails(item, system) {
  const update = { changed: false, deleteEquippped: false };

  // Fix legacy typo: equippped -> equipped
  if (Object.prototype.hasOwnProperty.call(system, "equippped")) {
    if (!Object.prototype.hasOwnProperty.call(system, "equipped")) {
      system.equipped = !!system.equippped;
      update.changed = true;
    }
    try {
      delete system.equippped;
    } catch (_e) {
      // ignore
    }
    update.deleteEquippped = true;
    update.changed = true;
  }

  // Reach migration: lift structured reach into system.reach and strip it.
  try {
    const structured = Array.isArray(system.qualitiesStructured) ? system.qualitiesStructured : [];
    const reachEntry = structured.find((q) => String(q?.key ?? "").toLowerCase() === "reach") ?? null;
    const reachFromStructured = Number(reachEntry?.value ?? 0);

    const reachFromSystem = Number(system.reach ?? 0);
    const systemHasReach = Number.isFinite(reachFromSystem) && reachFromSystem !== 0;

    if (!systemHasReach && Number.isFinite(reachFromStructured) && reachFromStructured !== 0) {
      system.reach = reachFromStructured;
      update.changed = true;
    }

    if (reachEntry) {
      const filtered = structured.filter((q) => String(q?.key ?? "").toLowerCase() !== "reach");
      if (filtered.length !== structured.length) {
        system.qualitiesStructured = filtered;
        update.changed = true;
      }
    }
  } catch (_e) {
    // best-effort only
  }

  // reachMin sanitize (numeric, >= 0)
  if (system.reachMin === undefined || system.reachMin === null || system.reachMin === "") {
    system.reachMin = 0;
    update.changed = true;
  } else {
    const n = Number(system.reachMin);
    if (!Number.isFinite(n) || n < 0) {
      system.reachMin = 0;
      update.changed = true;
    }
  }

  // enchant_level sanitize: invalid => 0, and strip legacy "1" without transfer effects
  try {
    const raw = system.enchant_level;
    const n = Number(raw);
    if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) {
      system.enchant_level = 0;
      update.changed = true;
    } else if (n === 1 && !_itemHasTransferEffects(item)) {
      system.enchant_level = 0;
      update.changed = true;
    }
  } catch (_e) {
    // ignore
  }

  return update;
}

function _normalizeItemSystem(item) {
  const type = item?.type;
  if (!type || !Object.prototype.hasOwnProperty.call(DEFAULTS?.itemSystem ?? {}, type)) return null;

  const currentSystem = _deepCloneSystem(item.system);
  let preChanged = false;
  if (type === "armor") {
    preChanged = _applyLegacyArmorTypedFields(currentSystem) || preChanged;
  }
  const ignorePaths = (DEFAULTS.__meta?.ignorePathsByType?.[type] ?? []).slice();
  const allowNonNumeric = _NON_NUMERIC_ALLOWLIST[type] ?? [];
  for (const key of allowNonNumeric) {
    if (_isNonNumericString(currentSystem[key])) ignorePaths.push(key);
  }
  const { result: system, changed: defaultsChanged } = applyDefaults(currentSystem, DEFAULTS.itemSystem[type], { coerce: true, ignorePaths });

  let changed = Boolean(defaultsChanged || preChanged);
  let deleteEquippped = false;

  // Attack mode canonicalization (weapon only): melee|ranged
  if (type === "weapon") {
    const hasValid = system.attackMode === "melee" || system.attackMode === "ranged";
    if (!hasValid) {
      const inferred = _inferAttackMode(item, system);
      system.attackMode = inferred ?? "melee";
      changed = true;
      if (!inferred && _debugEnabled()) {
        const ident = `${item?.type ?? "item"}:${item?.name ?? item?.id ?? "<unknown>"}`;
        console.warn(`${MODULE_ID} | attackMode inference fallback (defaulted to melee) for ${ident}`);
      }
    }
  }

  // Non-breaking armor.item_cat behavior
  if (type === "armor") {
    if (_ensureArmorItemCatNonBreaking(system)) changed = true;
  }

  // Ammunition per-10 pricing backfill (legacy)
  if (type === "ammunition") {
    if (system.pricePer10 === undefined || system.pricePer10 === null) {
      const legacy = Number(system.price ?? 0);
      system.pricePer10 = Number.isFinite(legacy) ? legacy : 0;
      changed = true;
    }
  }

  // Legacy guardrails (shared)
  const legacy = _applyLegacyGuardrails(item, system);
  if (legacy.changed) changed = true;
  if (legacy.deleteEquippped) deleteEquippped = true;

  if (!changed && !deleteEquippped) return null;

  const update = { system };
  if (deleteEquippped) update["system.-=equippped"] = null;
  return update;
}

async function _normalizeWorldItems() {
  const supportedTypes = _supportedItemTypes();
  const updates = [];
  for (const item of game.items.contents) {
    if (!supportedTypes.has(item.type)) continue;
    const update = _normalizeItemSystem(item);
    if (update) {
      update._id = item.id;
      updates.push(update);
    }
  }

  if (updates.length) {
    console.log(`${MODULE_ID} | Normalizing ${updates.length} world item(s)`);
    await Item.updateDocuments(updates, { diff: false });
  }
}

async function _normalizeActorItems() {
  const supportedTypes = _supportedItemTypes();
  for (const actor of game.actors.contents) {
    const updates = [];
    for (const item of actor.items.contents) {
      if (!supportedTypes.has(item.type)) continue;
      const update = _normalizeItemSystem(item);
      if (update) {
        update._id = item.id;
        updates.push(update);
      }
    }
    if (updates.length) {
      console.log(`${MODULE_ID} | Normalizing ${updates.length} item(s) on actor ${actor.name}`);
      await actor.updateEmbeddedDocuments("Item", updates, { diff: false });
    }
  }
}

export async function normalizeItems() {
  if (!game.user.isGM) return;
  try {
    await _normalizeWorldItems();
    await _normalizeActorItems();
  } catch (err) {
    console.error(`${MODULE_ID} | Item normalization failed`, err);
    ui.notifications?.error?.("UESRPG item normalization failed; check console for details.");
  }
}
