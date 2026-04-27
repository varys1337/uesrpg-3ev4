import { MagicOpposedWorkflow } from "../../magic/opposed-workflow.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { getEnchantingSettings } from "../settings.js";

const _FLAG_NS = FLAG_SCOPE;

function _settingEnabled() {
  return getEnchantingSettings().enableCastEnchantmentRuntime === true;
}

function _asNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _warn(msg) {
  ui.notifications?.warn?.(msg);
}

function _resolveOwnedItem(actor, item) {
  if (!actor || !item) return null;
  if (item.actor?.id === actor.id) return item;
  if (!item.id) return null;
  return actor.items?.get(item.id) ?? null;
}

function _parseSpellSlotRef(spellSlotId) {
  const raw = String(spellSlotId ?? "").trim();
  if (!raw) return { lane: "", slotId: "" };
  const idx = raw.indexOf(":");
  if (idx <= 0) return { lane: "", slotId: raw };
  return {
    lane: String(raw.slice(0, idx)).trim().toLowerCase(),
    slotId: String(raw.slice(idx + 1)).trim()
  };
}

function _resolveSlot(castFlags, spellSlotId) {
  const slots = (Array.isArray(castFlags?.slots) ? castFlags.slots : (Array.isArray(castFlags?.spells) ? castFlags.spells : []))
    .filter((s) => s?.enabled !== false);
  if (!slots.length) return null;
  const ref = _parseSpellSlotRef(spellSlotId);
  if (spellSlotId) {
    return slots.find((s) => String(s?.id ?? "") === String(ref.slotId || spellSlotId)) ?? null;
  }
  return slots.length === 1 ? slots[0] : null;
}

function _normalizeCostMode(value) {
  const mode = String(value ?? "soul").trim().toLowerCase();
  if (mode === "magicka" || mode === "none") return mode;
  return "soul";
}

function _resolveWorkshopCastConfig(item) {
  const enchanting = item?.flags?.[_FLAG_NS]?.enchanting;
  const cast = enchanting?.cast;
  if (!enchanting || enchanting.version !== 2 || !cast || typeof cast !== "object") return null;
  if (String(enchanting?.enchantType ?? "").trim().toLowerCase() !== "cast") return null;
  return {
    sourceLane: "workshop",
    cast,
    upkeepPath: `flags.${_FLAG_NS}.enchanting.cast.activeUpkeepSpellId`,
    poolPath: `flags.${_FLAG_NS}.enchanting.cast.pool.value`,
    syncCharge: true
  };
}

function _resolveItemSpellcastingConfig(item) {
  const cfg = item?.flags?.[_FLAG_NS]?.itemSpellcasting;
  if (!cfg || typeof cfg !== "object" || cfg.enabled !== true) return null;
  return {
    sourceLane: "extension",
    cast: cfg,
    upkeepPath: `flags.${_FLAG_NS}.itemSpellcasting.activeUpkeepSlotId`,
    poolPath: `flags.${_FLAG_NS}.itemSpellcasting.pool.value`,
    syncCharge: true
  };
}

function _resolveSpellcastingConfig(item, spellSlotId = null) {
  const slotRef = _parseSpellSlotRef(spellSlotId);
  const workshop = _resolveWorkshopCastConfig(item);
  const extension = _resolveItemSpellcastingConfig(item);

  if (slotRef.lane === "workshop") return workshop;
  if (slotRef.lane === "extension") return extension;

  if (spellSlotId) {
    if (_resolveSlot(extension?.cast, spellSlotId)) return extension;
    if (_resolveSlot(workshop?.cast, spellSlotId)) return workshop;
  }

  const extCount = Array.isArray(extension?.cast?.slots) ? extension.cast.slots.filter((s) => s?.enabled !== false).length : 0;
  const workshopCount = Array.isArray(workshop?.cast?.spells) ? workshop.cast.spells.filter((s) => s?.enabled !== false).length : 0;

  if (extension && !workshop) return extension;
  if (workshop && !extension) return workshop;
  if (!extension && !workshop) return null;
  if (extCount && !workshopCount) return extension;
  if (workshopCount && !extCount) return workshop;
  return extension;
}

function _buildTemporarySpellFromSnapshot(snapshot, fallbackLabel = "Stored Spell", actor = null) {
  if (!snapshot || typeof snapshot !== "object") return null;
  try {
    const data = foundry.utils.deepClone(snapshot);
    data.type = "spell";
    if (!String(data.name ?? "").trim()) data.name = fallbackLabel;
    if (!data.system || typeof data.system !== "object") data.system = {};
    const ItemCls = CONFIG?.Item?.documentClass ?? Item;
    return new ItemCls(data, { temporary: true, parent: actor ?? undefined });
  } catch (_err) {
    return null;
  }
}

async function _resolveSpellFromSlot(item, slot) {
  const actor = item?.actor ?? null;
  const actorSpellItemId = String(slot?.actorSpellItemId ?? "").trim();
  if (actor && actorSpellItemId) {
    const embedded = actor.items?.get?.(actorSpellItemId) ?? null;
    if (embedded?.documentName === "Item" && embedded.type === "spell") {
      return { spell: embedded, spellUuid: String(slot?.spellUuid ?? embedded.uuid ?? "") || null, fromSnapshot: false };
    }
  }

  const uuid = String(slot?.spellUuid ?? "").trim();
  if (uuid) {
    try {
      const spell = await fromUuid(uuid);
      if (spell?.documentName === "Item" && spell.type === "spell") {
        return { spell, spellUuid: spell.uuid || uuid, fromSnapshot: false };
      }
    } catch (_err) {
      // Fallback to snapshot.
    }
  }
  const snap = _buildTemporarySpellFromSnapshot(slot?.snapshot, String(slot?.label ?? "Stored Spell"), actor);
  if (snap) {
    return { spell: snap, spellUuid: String(snap?.uuid ?? "") || null, fromSnapshot: true };
  }
  return { spell: null, spellUuid: uuid || null, fromSnapshot: false };
}

function _resolveActiveToken(actor, token) {
  return token
    ?? canvas.tokens?.controlled?.find((t) => t.actor?.id === actor?.id)
    ?? actor?.getActiveTokens?.()?.[0]
    ?? null;
}

function _getPoolSnapshot(item, spellcastingCfg) {
  const cast = spellcastingCfg?.cast ?? {};
  const pool = cast?.pool ?? {};
  if (spellcastingCfg?.sourceLane === "extension") {
    return {
      value: _asNum(item?.system?.charge?.value, _asNum(pool?.value, 0)),
      max: _asNum(item?.system?.charge?.max, _asNum(pool?.max, 0))
    };
  }
  return {
    value: _asNum(pool?.value, 0),
    max: _asNum(pool?.max, 0)
  };
}

function _buildCastSource({ item, slot, sourceLane, pool }) {
  return {
    type: "enchantment",
    sourceLane: String(sourceLane ?? "workshop"),
    itemUuid: item.uuid,
    enchantedItemUuid: item.uuid,
    itemName: item.name,
    spellSlotId: String(slot?.id ?? ""),
    enchantSpellSlotId: String(slot?.id ?? ""),
    costMode: _normalizeCostMode(slot?.costMode),
    cost: _asNum(slot?.cost, 0),
    level: Math.max(1, _asNum(slot?.level, 1)),
    bindingStrength: _asNum(slot?.bindingStrength, 0),
    skipCastingTest: slot?.skipCastingTest !== false,
    pool: { value: _asNum(pool?.value, 0), max: _asNum(pool?.max, 0) }
  };
}

function _buildItemCastContext(item, slot, sourceLane) {
  return {
    itemUuid: item.uuid,
    slotId: String(slot?.id ?? ""),
    sourceLane: String(sourceLane ?? "workshop")
  };
}

export async function castFromEnchantedItem({
  actor,
  token,
  item,
  spellSlotId,
  castActionType = "primary",
  options = { targetTokenUuids: [], aoe: null, spellOptions: null }
} = {}) {
  if (!_settingEnabled()) {
    _warn("Cast Enchantment runtime is disabled in world settings.");
    return null;
  }

  const ownedItem = _resolveOwnedItem(actor, item);
  if (!actor || !ownedItem) {
    _warn("You can only cast enchantments from an item owned by the actor.");
    return null;
  }

  const spellcastingCfg = _resolveSpellcastingConfig(ownedItem, spellSlotId);
  if (!spellcastingCfg) {
    _warn("Selected item is not configured for spellcasting.");
    return null;
  }
  const slot = _resolveSlot(spellcastingCfg.cast, spellSlotId);
  if (!slot) {
    _warn("Select a stored spell slot to cast.");
    return null;
  }

  const { spell, spellUuid } = await _resolveSpellFromSlot(ownedItem, slot);
  if (!spell || !spellUuid) {
    _warn("Stored spell reference could not be resolved to a castable spell UUID.");
    return null;
  }

  const activeToken = _resolveActiveToken(actor, token);
  const spellOptions = {
    ...(options?.spellOptions && typeof options.spellOptions === "object" ? options.spellOptions : {}),
    enchantmentCast: true,
    ignoreTraining: true
  };
  const pool = _getPoolSnapshot(ownedItem, spellcastingCfg);
  const castSource = _buildCastSource({
    item: ownedItem,
    slot,
    sourceLane: spellcastingCfg.sourceLane,
    pool
  });
  const itemCastContext = _buildItemCastContext(ownedItem, slot, spellcastingCfg.sourceLane);
  const targetRefs = Array.isArray(options?.targetTokenUuids) ? options.targetTokenUuids.filter(Boolean) : [];

  if (targetRefs.length) {
    return MagicOpposedWorkflow.createPending({
      attackerActorUuid: actor.uuid,
      attackerTokenUuid: activeToken?.document?.uuid ?? activeToken?.uuid ?? null,
      defenders: targetRefs,
      spellUuid,
      spellOptions,
      castActionType,
      ignoreTraining: true,
      aoe: options?.aoe ? foundry.utils.deepClone(options.aoe) : undefined,
      castSource,
      itemCastContext
    });
  }

  return MagicOpposedWorkflow.castUnopposed({
    attackerActorUuid: actor.uuid,
    attackerTokenUuid: activeToken?.document?.uuid ?? activeToken?.uuid ?? null,
    spellUuid,
    spellOptions,
    castActionType,
    ignoreTraining: true,
    castSource,
    itemCastContext
  });
}
