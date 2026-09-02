/**
 * Extend the base Item entity with system-specific functionality.
 * @extends {Item}
 */
import { prepareArmorItem } from "./item-prepare/armor.js";
import { prepareNormalItem } from "./item-prepare/normal.js";
import { prepareWeaponItem } from "./item-prepare/weapon.js";
import { prepareAmmunitionItem } from "./item-prepare/ammunition.js";
import { prepareModSkillItems } from "./item-prepare/mod-skill-items.js";
import { prepareCombatStyleData } from "./item-prepare/combat-style.js";
import { prepareContainerItem } from "./item-prepare/container.js";
import { prepareShieldItem } from "./item-prepare/shield.js";
import { buildInjectedStructuredQualities } from "./item-prepare/shared.js";
import { isLegacyShieldSystemData } from "../items/shield-utils.js";
import { duplicateContainedItemsOnActor } from "./item/container-lifecycle.js";
import {
  ARMOR_HIT_LOCATION_KEYS,
  getArmorCategoryCoverage,
  hasAnyArmorCoverage,
} from "../items/armor-coverage.js";
import { FLAG_SCOPE } from "../constants.js";

const ARMOR_COVERAGE_MODE_PATH = `flags.${FLAG_SCOPE}.coverageMode`;

function readChangedValue(changed, path) {
  if (Object.prototype.hasOwnProperty.call(changed ?? {}, path)) return changed[path];
  return foundry.utils.getProperty(changed, path);
}

function hasChangedPath(changed, path) {
  if (Object.prototype.hasOwnProperty.call(changed ?? {}, path)) return true;
  return foundry.utils.hasProperty(changed, path);
}

export class SimpleItem extends Item {
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    const owningActor = this.actor ?? (this.parent?.documentName === "Actor" ? this.parent : null);
    if (this.type === "armor" && owningActor?.type === "NPC") {
      const coverageMode = String(this.getFlag?.(FLAG_SCOPE, "coverageMode") ?? "").trim().toLowerCase();
      const categoryCoverage = getArmorCategoryCoverage(this.system);
      if (coverageMode !== "manual" && categoryCoverage && !hasAnyArmorCoverage(this.system?.hitLocations)) {
        this.updateSource({
          "system.hitLocations": categoryCoverage,
          [ARMOR_COVERAGE_MODE_PATH]: "category",
        });
      }
    }

    switch (data.type) {
      case 'combatStyle':
      case 'skill':
      case 'magicSkill':
        this.updateSource({ 'system.rank': 'untrained' });
        break;
    }
    return allowed;
  }

  async _preUpdate(changed, options, user) {
    const allowed = await super._preUpdate(changed, options, user);
    if (allowed === false) return false;
    if (this.type !== "armor") return allowed;

    const hitLocationsChanged = ARMOR_HIT_LOCATION_KEYS.some((key) =>
      hasChangedPath(changed, `system.hitLocations.${key}`)
    ) || hasChangedPath(changed, "system.hitLocations");
    const explicitMode = String(readChangedValue(changed, ARMOR_COVERAGE_MODE_PATH) ?? "").trim().toLowerCase();

    if (hitLocationsChanged) {
      if (explicitMode !== "category") changed[ARMOR_COVERAGE_MODE_PATH] = "manual";
      return allowed;
    }

    const categoryChanged = hasChangedPath(changed, "system.category") || hasChangedPath(changed, "system.item_cat");
    const currentMode = String(this.getFlag?.(FLAG_SCOPE, "coverageMode") ?? "").trim().toLowerCase();
    if (categoryChanged && currentMode !== "manual") {
      const nextSystem = {
        ...(this.system?.toObject?.() ?? this.system ?? {}),
        category: readChangedValue(changed, "system.category") ?? this.system?.category,
        item_cat: readChangedValue(changed, "system.item_cat") ?? this.system?.item_cat,
      };
      const categoryCoverage = getArmorCategoryCoverage(nextSystem);
      if (categoryCoverage) {
        changed["system.hitLocations"] = categoryCoverage;
        changed[ARMOR_COVERAGE_MODE_PATH] = "category";
      }
    }

    return allowed;
  }

  async _onCreate(data, options, user) {
    await super._onCreate(data, options, user);
    switch (data.type) {
      case 'container':
        await duplicateContainedItemsOnActor(this, this.actor, data);
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
    if (['weapon','armor','shield','ammunition'].includes(this.type)) {
      itemData.gmOverride = itemData.gmOverride ?? {};
      this._injectAutoQualities(itemData);
    }

    // STEP 2: Prepare data based on item type - defensive guards for hasOwnProperty
    // These methods can now use qualitiesStructuredInjected (with manual qualities).
    // They also create autoQualitiesStructured for material/quality-derived qualities.
    const hasActor = this.isEmbedded && this.actor?.system != null;
    if (this.type === 'armor') { this._prepareArmorItem(actorData, itemData) }
    if (this.type === 'shield') { this._prepareShieldItem(actorData, itemData) }
    if (this.type === 'equipment') { this._prepareNormalItem(actorData, itemData) }
    if (this.type === 'weapon') { this._prepareWeaponItem(actorData, itemData) }
    if (this.type === 'ammunition') { this._prepareAmmunitionItem(actorData, itemData) }
    if (hasActor && this.system && Object.prototype.hasOwnProperty.call(this.system, 'skillArray') && actorData.type === 'Player Character') { this._prepareModSkillItems(actorData, itemData) }
    if (hasActor && this.system && Object.prototype.hasOwnProperty.call(this.system, 'baseCha')) { this._prepareCombatStyleData(actorData, itemData) }
    if (hasActor && this.type === 'container') { this._prepareContainerItem(actorData, itemData) }

    // STEP 3: Final injection of auto-granted qualities into the computed structured list.
    // This re-runs after prepare methods to include autoQualitiesStructured (material/quality-derived).
    // This must run for world items as well as embedded items so automation helpers can rely on it.
    if (['weapon','armor','shield','ammunition'].includes(this.type)) {
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
    itemData.qualitiesStructuredInjected = buildInjectedStructuredQualities(this.type, itemData);
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
    if (isLegacyShieldSystemData(itemData)) return prepareShieldItem(actorData, itemData);
    return prepareArmorItem(actorData, itemData);
  }

  _prepareShieldItem(actorData, itemData) {
    return prepareShieldItem(actorData, itemData);
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
  return prepareContainerItem(this, actorData, itemData);
}

async _duplicateContainedItemsOnActor(actorData, itemData) {
  await duplicateContainedItemsOnActor(this, actorData, itemData);
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
