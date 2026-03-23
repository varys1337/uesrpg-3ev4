/**
 * External item-drop create helpers for actor-like sheets.
 */

import { requestCreateEmbeddedDocuments } from "./authority-proxy.js";
import { dndDebug } from "./dnd-debugger.js";

const STACKABLE_DEFAULT = new Set(["ammunition"]);
const PHYSICAL_TYPES = new Set(["equipment", "scroll", "weapon", "armor", "shield", "ammunition", "container"]);

function _str(value) {
  return String(value ?? "").trim().toLowerCase();
}

function _hasAny(haystack, needles) {
  return needles.some((needle) => haystack.includes(needle));
}

function _isMeaningfulNumeric(value) {
  return Number.isFinite(Number(value)) && Number(value) !== 0;
}

export function inferDroppedItemType(item) {
  const rawType = String(item?.type ?? "").trim();
  const sourceType = rawType.toLowerCase();
  if (sourceType === "item") return "equipment";
  if (sourceType && sourceType !== "equipment") return rawType;

  const sys = item?.system ?? {};
  const itemCat = _str(sys.item_cat);
  const category = _str(sys.category);
  const qualities = _str(sys.qualities);
  const traits = Array.isArray(sys.qualitiesTraits)
    ? sys.qualitiesTraits.map((t) => _str(t)).join(" ")
    : "";
  const name = _str(item?.name);
  const attackMode = _str(sys.attackMode);
  const combined = `${itemCat} ${category} ${qualities} ${traits} ${attackMode} ${name}`;

  const armorKeys = [
    "armor", "armour", "helmet", "gauntlet", "greave", "shield", "chest", "chestplate",
    "head", "body", "arm", "leg", "cuirass", "pauldron",
  ];
  const shieldKeys = ["shield", "buckler", "targe", "tower shield"];
  const ammoKeys = ["ammunition", "ammo", "arrow", "bolt", "dart", "sling", "stone", "quiver"];
  const weaponKeys = [
    "weapon", "sword", "axe", "mace", "dagger", "spear", "staff",
    "bow", "crossbow", "arbalest", "marksman", "archery", "ranged", "melee",
  ];

  const isArmorByFields =
    sys.armorClass != null ||
    sys.hitLocations != null ||
    _isMeaningfulNumeric(sys.blockRating) ||
    _isMeaningfulNumeric(sys.magic_ar);

  const isAmmoByFields =
    sys.arrowType != null;

  const isShieldByFields =
    sourceType === "shield" ||
    _str(sys.item_cat) === "shield" ||
    _str(sys.category) === "shield" ||
    sys.shieldType != null ||
    sys.magic_br != null ||
    (sys.isShield === true);

  const isWeaponByFields =
    sys.attackMode != null ||
    sys.weapon2H != null ||
    sys.damage2 != null ||
    sys.reachMin != null ||
    sys.consumeAmmo != null ||
    sys.reloadState != null;

  if (_hasAny(combined, shieldKeys) || isShieldByFields) return "shield";
  if (_hasAny(combined, armorKeys) || isArmorByFields) return "armor";
  if (_hasAny(combined, ammoKeys) || isAmmoByFields) return "ammunition";
  if (_hasAny(combined, weaponKeys) || isWeaponByFields) return "weapon";
  return "equipment";
}

export function buildDroppedItemCreateData(item, options = {}) {
  const stackableTypes = options.stackableTypes instanceof Set
    ? options.stackableTypes
    : new Set(options.stackableTypes ?? STACKABLE_DEFAULT);

  const data = item.toObject();
  const sourceType = _str(item?.type) || "equipment";
  const inferredType = inferDroppedItemType(item);

  delete data._id;
  data.type = inferredType;
  data.name = data.name || item.name || inferredType;
  data.system = data.system ?? {};

  if (data.system?.quantity !== undefined && !stackableTypes.has(data.type)) {
    data.system.quantity = 1;
  }

  if (PHYSICAL_TYPES.has(_str(data.type))) {
    const prev = data.system.containerStats;
    data.system.containerStats = {
      ...(prev && typeof prev === "object" ? prev : {}),
      contained: false,
      container_id: "",
      container_name: "",
    };
  }

  if (sourceType !== inferredType) {
    dndDebug("type.remap", {
      item: item?.name ?? null,
      sourceType,
      inferredType,
      uuid: item?.uuid ?? null,
      sourceId: item?.flags?.core?.sourceId ?? null,
    }, { traceId: options.traceId ?? null });
  }

  return data;
}

export async function createExternalDroppedItem(targetActor, droppedItem, options = {}) {
  if (!targetActor || !droppedItem) return null;

  const normalizeType = options.normalizeType !== false;
  const traceId = options.traceId ?? null;
  const createData = normalizeType
    ? buildDroppedItemCreateData(droppedItem, options)
    : (() => {
      const data = droppedItem.toObject();
      delete data._id;
      return data;
    })();

  dndDebug("create.attempt", {
    targetActor: targetActor?.uuid ?? null,
    sourceItem: droppedItem?.uuid ?? null,
    sourceType: droppedItem?.type ?? null,
    createType: createData?.type ?? null,
    createName: createData?.name ?? null,
  }, { traceId });

  const created = await requestCreateEmbeddedDocuments(targetActor, "Item", [createData]);
  const first = Array.isArray(created) ? (created[0] ?? null) : null;

  const sourceType = _str(droppedItem?.type);
  if (first && sourceType === "item" && _str(first.type) !== "equipment") {
    try {
      await first.update({ type: "equipment" });
    } catch (err) {
      console.warn("UESRPG | Failed to normalize legacy dropped item to equipment", {
        sourceItem: droppedItem?.uuid ?? null,
        createdId: first?.id ?? null,
        err,
      });
    }
  }

  dndDebug("create.result", {
    targetActor: targetActor?.uuid ?? null,
    sourceItem: droppedItem?.uuid ?? null,
    createdId: first?.id ?? null,
    createdType: first?.type ?? createData?.type ?? null,
  }, { traceId });

  return first;
}
