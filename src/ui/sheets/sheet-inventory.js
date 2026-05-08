/**
 * Shared inventory helpers for Actor sheets.
 *
 * Shared across actor sheet modules. No schema changes.
 */
import { createDebugLogger } from "../../utils/debug.js";

const _debug = createDebugLogger("shieldDebug", "[UESRPG][ShieldDebug][Inventory]");

/**
 * Item types which represent physical inventory and are eligible for containment.
 * @type {Set<string>}
 */
const CONTAINABLE_ITEM_TYPES = new Set(["item", "equipment", "scroll", "weapon", "armor", "shield", "ammunition", "container"]);

function _resolveOwnedContainer(item, { actor = null, items = null } = {}) {
  const cs = item?.system?.containerStats;
  const containerId = String(cs?.container_id ?? "").trim();
  if (!containerId) return null;

  const owner = actor ?? item?.actor ?? item?.parent ?? null;
  const container = owner?.items?.get?.(containerId)
    ?? (Array.isArray(items)
      ? items.find((candidate) => String(candidate?.id ?? candidate?._id ?? "").trim() === containerId)
      : null);
  if (!container) return null;
  if (container.type !== "container") return null;
  if (container.id === item?.id || container._id === item?._id) return null;

  return container;
}

/**
 * Determine whether an item is marked as contained in a valid owned container.
 * @param {Item|object} item
 * @param {object} [options]
 * @param {Actor|null} [options.actor]
 * @param {Array<object>|null} [options.items]
 * @returns {boolean}
 */
function isContainedItem(item, options = {}) {
  const cs = item?.system?.containerStats;
  if (!String(cs?.container_id ?? "").trim()) return false;
  return Boolean(_resolveOwnedContainer(item, options));
}

/**
 * Determine whether an item is a containable physical inventory type.
 * @param {Item|object} item
 * @returns {boolean}
 */
function isContainableType(item) {
  return CONTAINABLE_ITEM_TYPES.has(item?.type);
}

/**
 * Whether an item should be hidden from the main inventory lists because it is inside a container.
 * Contained items remain owned by the Actor and are surfaced via the container sheet UI.
 *
 * @param {Item|object} item
 * @param {object} [options]
 * @param {Actor|null} [options.actor]
 * @param {Array<object>|null} [options.items]
 * @returns {boolean}
 */
export function shouldHideFromMainInventory(item, options = {}) {
  const containable = isContainableType(item);
  const contained = isContainedItem(item, options);
  const shouldHide = containable && contained;

  const type = String(item?.type ?? "").trim().toLowerCase();
  if (type === "shield" || type === "armor") {
    const cs = item?.system?.containerStats ?? {};
    const hasContainerRef = Boolean(String(cs?.container_id ?? "").trim());
    _debug("shouldHideFromMainInventory", {
      id: item?.id ?? item?._id ?? null,
      name: item?.name ?? null,
      type,
      containable,
      containerStats: {
        contained: cs?.contained === true,
        container_id: String(cs?.container_id ?? ""),
      },
      hasContainerRef,
      hasValidContainer: contained,
      shouldHide,
    });
  }

  return shouldHide;
}
