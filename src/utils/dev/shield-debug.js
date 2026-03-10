import { createDebugLogger, isDebugEnabled } from "../debug.js";

const _debug = createDebugLogger("shieldDebug", "[UESRPG][ShieldDebug]");

function _norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

function _isShieldLikeType(type) {
  const t = _norm(type);
  return t === "shield" || t === "armor";
}

function _isLegacyShieldSystem(system = {}) {
  return system?.isShield === true
    || system?.isShieldEffective === true
    || _norm(system?.item_cat) === "shield"
    || _norm(system?.category) === "shield";
}

function _isShieldLikeItem(itemLike) {
  const type = _norm(itemLike?.type);
  if (type === "shield") return true;
  if (type === "armor") return _isLegacyShieldSystem(itemLike?.system ?? {});
  return false;
}

function _extractShieldSummary(item) {
  const sys = item?.system ?? {};
  const cs = sys?.containerStats ?? {};
  return {
    id: item?.id ?? item?._id ?? null,
    name: item?.name ?? null,
    type: item?.type ?? null,
    actorId: item?.actor?.id ?? item?.parent?.id ?? null,
    actorName: item?.actor?.name ?? item?.parent?.name ?? null,
    equipped: sys?.equipped === true,
    quantity: Number(sys?.quantity ?? 0),
    enc: Number(sys?.enc ?? 0),
    blockRating: Number(sys?.blockRating ?? 0),
    magicBR: Number(sys?.magic_br ?? 0),
    shieldType: _norm(sys?.shieldType || "normal"),
    legacyShieldFlags: {
      isShield: sys?.isShield === true,
      itemCat: _norm(sys?.item_cat),
      category: _norm(sys?.category),
    },
    container: {
      contained: cs?.contained === true,
      containerId: String(cs?.container_id ?? ""),
      containerName: String(cs?.container_name ?? ""),
    },
  };
}

function _changedTouchesShieldLane(changed = {}) {
  if (!changed || typeof changed !== "object") return false;
  if (_isShieldLikeType(changed?.type)) return true;
  return foundry.utils.hasProperty(changed, "type")
    || foundry.utils.hasProperty(changed, "system.isShield")
    || foundry.utils.hasProperty(changed, "system.isShieldEffective")
    || foundry.utils.hasProperty(changed, "system.item_cat")
    || foundry.utils.hasProperty(changed, "system.category")
    || foundry.utils.hasProperty(changed, "system.shieldType")
    || foundry.utils.hasProperty(changed, "system.blockRating")
    || foundry.utils.hasProperty(changed, "system.magic_br")
    || foundry.utils.hasProperty(changed, "system.enc")
    || foundry.utils.hasProperty(changed, "system.quantity")
    || foundry.utils.hasProperty(changed, "system.containerStats")
    || foundry.utils.hasProperty(changed, "system.containerStats.contained")
    || foundry.utils.hasProperty(changed, "system.containerStats.container_id")
    || foundry.utils.hasProperty(changed, "system.containerStats.container_name");
}

function _shouldTrace(item, changed = null) {
  return _isShieldLikeItem(item) || _changedTouchesShieldLane(changed);
}

export function registerShieldDebugObservers() {
  const already = globalThis.__UESRPG_SHIELD_DEBUG_HOOKS_REGISTERED__ === true;
  if (already) return;
  globalThis.__UESRPG_SHIELD_DEBUG_HOOKS_REGISTERED__ = true;

  Hooks.on("createItem", (item, _options, userId) => {
    if (!_shouldTrace(item)) return;
    _debug("createItem", { userId, item: _extractShieldSummary(item) });
  });

  Hooks.on("preUpdateItem", (item, changed, _options, userId) => {
    if (!_shouldTrace(item, changed)) return;
    _debug("preUpdateItem", {
      userId,
      item: _extractShieldSummary(item),
      changed,
    });
  });

  Hooks.on("updateItem", (item, changed, _options, userId) => {
    if (!_shouldTrace(item, changed)) return;
    const cs = item?.system?.containerStats ?? {};
    const actor = item?.actor ?? item?.parent ?? null;
    const container = actor?.items?.get?.(String(cs?.container_id ?? "")) ?? null;
    _debug("updateItem", {
      userId,
      changed,
      item: _extractShieldSummary(item),
      hideDecisionProbe: {
        isContainableType: ["item", "equipment", "scroll", "weapon", "armor", "shield", "ammunition"].includes(String(item?.type ?? "")),
        containedFlag: cs?.contained === true,
        containerIdPresent: Boolean(String(cs?.container_id ?? "").trim()),
        containerExists: Boolean(container),
        containerIsContainerType: String(container?.type ?? "") === "container",
      },
    });
  });

  Hooks.on("deleteItem", (item, _options, userId) => {
    if (!_shouldTrace(item)) return;
    _debug("deleteItem", { userId, item: _extractShieldSummary(item) });
  });

  Hooks.on("ready", () => {
    if (!isDebugEnabled("shieldDebug")) return;
    _debug("ready", {
      world: game?.world?.id ?? null,
      user: game?.user?.id ?? null,
      userName: game?.user?.name ?? null,
      isGM: game?.user?.isGM === true,
      note: "Shield debug lane is active.",
    });
  });
}
