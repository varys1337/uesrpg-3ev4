/**
 * Extend the base Item entity with system-specific functionality.
 * @extends {Item}
 */
import { requestCreateEmbeddedDocuments, requestUpdateDocument } from "../../utils/authority-proxy.js";
import { hasLegacyQualityToken, sumLegacyQualityParam } from "./item-utils.js";
import { prepareArmorItem } from "./item-prepare/armor.js";
import { prepareNormalItem } from "./item-prepare/normal.js";
import { prepareWeaponItem } from "./item-prepare/weapon.js";
import { prepareAmmunitionItem } from "./item-prepare/ammunition.js";
import { prepareModSkillItems } from "./item-prepare/mod-skill-items.js";
import { prepareCombatStyleData } from "./item-prepare/combat-style.js";
import { prepareContainerItem } from "./item-prepare/container.js";

export class SimpleItem extends Item {
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);
    switch (data.type) {
      case 'combatStyle':
      case 'skill':
      case 'magicSkill':
        this.updateSource({ 'system.rank': 'untrained' });
        break;
    }
  }

  async _onCreate(data, options, user) {
    await super._onCreate(data, options, user);
    switch (data.type) {
      case 'container':
        await this._duplicateContainedItemsOnActor(this.actor, data);
        break;
    }
  }

  prepareBaseData() {
    super.prepareBaseData();
    this.system = this.system ?? {};
  }

  prepareData() {
    super.prepareData();

    // Get the Item's data & Actor's Data
    const itemData = this.system
    const actorData = this.actor ? this.actor : {}

    // STEP 1: Pre-inject manual qualities so they're available during prepare methods.
    // This preliminary injection allows type-specific prepare methods (like _prepareWeaponItem) 
    // to access qualitiesStructuredInjected for features that depend on manual qualities (like Reload).
    if (['weapon','armor','ammunition'].includes(this.type)) {
      itemData.gmOverride = itemData.gmOverride ?? {};
      this._injectAutoQualities(itemData);
    }

    // STEP 2: Prepare data based on item type - defensive guards for hasOwnProperty
    // These methods can now use qualitiesStructuredInjected (with manual qualities).
    // They also create autoQualitiesStructured for material/quality-derived qualities.
    const hasActor = this.isEmbedded && this.actor?.system != null;
    if (this.type === 'armor') { this._prepareArmorItem(actorData, itemData) }
    if (this.type === 'equipment') { this._prepareNormalItem(actorData, itemData) }
    if (this.type === 'weapon') { this._prepareWeaponItem(actorData, itemData) }
    if (this.type === 'ammunition') { this._prepareAmmunitionItem(actorData, itemData) }
    if (hasActor && this.system && Object.prototype.hasOwnProperty.call(this.system, 'skillArray') && actorData.type === 'Player Character') { this._prepareModSkillItems(actorData, itemData) }
    if (hasActor && this.system && Object.prototype.hasOwnProperty.call(this.system, 'baseCha')) { this._prepareCombatStyleData(actorData, itemData) }
    if (hasActor && this.type === 'container') { this._prepareContainerItem(actorData, itemData) }

    // STEP 3: Final injection of auto-granted qualities into the computed structured list.
    // This re-runs after prepare methods to include autoQualitiesStructured (material/quality-derived).
    // This must run for world items as well as embedded items so automation helpers can rely on it.
    if (['weapon','armor','ammunition'].includes(this.type)) {
      this._injectAutoQualities(itemData);
    }

  }

  /**
   * Build a computed structured qualities array that includes both manual qualitiesStructured
   * and autoQualitiesStructured (material/quality-derived). This is NOT persisted.
   *
   * Contract:
   * - Manual qualities take precedence over auto qualities for the same key.
   * - Output is stable and de-duplicated by key.
   * - Stored on `system.qualitiesStructuredInjected` for automation consumers.
   */
  _injectAutoQualities(itemData) {
    const manual = Array.isArray(itemData.qualitiesStructured) ? itemData.qualitiesStructured : [];
    const autoQ = Array.isArray(itemData.autoQualitiesStructured)
      ? itemData.autoQualitiesStructured
      : [];

    const byKey = new Map();

    // Manual first (authoritative for values)
    for (const q of manual) {
      if (!q) continue;
      const rawKey = String(q.key ?? "").trim();
      const key = rawKey.toLowerCase();
      if (!key) continue;
      const entry = { key };
      if (q.value !== undefined && q.value !== null && q.value !== "") {
        const n = Number(q.value);
        if (Number.isFinite(n)) entry.value = n;
      }
      byKey.set(key, entry);
    }

    // Auto second (only if not already present).
    for (const q of autoQ) {
      if (!q) continue;
      const rawKey = String(q.key ?? q ?? "").trim();
      const key = rawKey.toLowerCase();
      if (!key) continue;
      if (byKey.has(key)) continue;
      const entry = { key };
      if (q.value !== undefined && q.value !== null && q.value !== "") {
        const n = Number(q.value);
        if (Number.isFinite(n)) entry.value = n;
      }
      byKey.set(key, entry);
    }

    // Legacy qualities parsing (weapons only): make sure common RAW qualities are available
    // to automation even if the item was not updated via the Structured Qualities UI.
    if (this.type === "weapon") {
      const legacyText = String(itemData.qualities ?? "");

      // Primitive / Proven (weapon quality level also auto-grants these, but legacy items may store it only as text)
      if (!byKey.has("primitive") && hasLegacyQualityToken(legacyText, "primitive")) {
        byKey.set("primitive", { key: "primitive" });
      }
      if (!byKey.has("proven") && hasLegacyQualityToken(legacyText, "proven")) {
        byKey.set("proven", { key: "proven" });
      }

      // Damaged (X) stacks; store the summed value if no structured entry exists.
      if (!byKey.has("damaged")) {
        const dv = sumLegacyQualityParam(legacyText, "Damaged");
        if (dv > 0) byKey.set("damaged", { key: "damaged", value: dv });
      }
    }
    itemData.qualitiesStructuredInjected = Array.from(byKey.values());
  }


  /**
   * Prepare Character type specific data
   */

  /**
   * Prepare data specific to armor items
   * @param {*} itemData
   * @param {*} actorData
   */

  _prepareCombatStyleData(actorData, itemData) {
    return prepareCombatStyleData(this, actorData, itemData);
  }

  _prepareArmorItem(actorData, itemData) {
    return prepareArmorItem(actorData, itemData);
  }

  _prepareNormalItem(actorData, itemData) {
    return prepareNormalItem(actorData, itemData);
  }

  _prepareWeaponItem(actorData, itemData) {
    return prepareWeaponItem(this, actorData, itemData);
  }

  _prepareAmmunitionItem(actorData, itemData) {
    return prepareAmmunitionItem(actorData, itemData);
  }

  /**
   * PrepareModSkillItems - Safer, non-mutating approach
   * Previously this updated other embedded documents (updateSource) during item prepare,
   * which can cause expensive document updates during large prepares/draws. Instead:
   * - If the item is equipped, apply the modifier in-memory to actorData.system.professions
   * - Do not perform document writes here (no updateSource / updateEmbeddedDocuments)
   */
  _prepareModSkillItems(actorData, itemData) {
    return prepareModSkillItems(actorData, itemData);
  }

_prepareContainerItem(actorData, itemData) {
  return prepareContainerItem(actorData, itemData);
}

async _duplicateContainedItemsOnActor(actorData, itemData) {
  if (!actorData || !Array.isArray(itemData?.system?.contained_items)) return;

  const itemsToDuplicate = [];
  for (const containedItem of itemData.system.contained_items) {
    const clone = containedItem?.item ? (containedItem.item.toObject ? containedItem.item.toObject() : containedItem.item) : containedItem;
    if (!clone) continue;
    clone.system = clone.system || {};
    clone.system.containerStats = clone.system.containerStats || {};
    clone.system.containerStats.container_id = itemData._id;
    itemsToDuplicate.push(clone);
  }

  if (itemsToDuplicate.length === 0) return;

  try {
    const createdContainedItems = await requestCreateEmbeddedDocuments(actorData, "Item", itemsToDuplicate);

    // Persist the newly created item references back to the container document.
    const newContainedItems = (createdContainedItems ?? []).map(item => ({ _id: item._id, item }));
    await requestUpdateDocument(this, { 'system.contained_items': newContainedItems });
  } catch (err) {
    console.error("UESRPG | Failed to duplicate contained items onto actor", { container: this.name, err });
    ui.notifications?.error?.("Failed to create contained items for container.");
  }
}
  _untrainedException(actorData) {
    // Defensive guard: safe property access and array filtering
    const items = actorData.items ?? [];
    const attribute = items?.filter(item => item?.system?.untrainedException === true) || [];

    // Chapter 4 (Arms Master): ignore the usual -20 untrained penalty for Combat Styles.
    // We treat possession of the Arms Master talent as an implicit untrained-exception.
    const hasArmsMaster = Array.isArray(items) && items.some((i) => {
      if (String(i?.type ?? "") !== "talent") return false;
      const slug = String(i?.system?.slug ?? i?.system?.key ?? i?.system?.id ?? "").toLowerCase();
      const name = String(i?.name ?? "").toLowerCase();
      return slug === "armsmaster" || name === "arms master";
    });

    if (this.type !== "combatStyle") return 0;
    return (attribute.length >= 1 || hasArmsMaster) ? 20 : 0;
  }

}
