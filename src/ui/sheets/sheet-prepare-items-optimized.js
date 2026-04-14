/**
 * Optimized sheet item preparation with incremental processing for large datasets.
 * 
 * This module provides size-optimized versions of item preparation functions
 * that use incremental processing for large item counts to prevent UI blocking.
 * 
 * @module sheet-prepare-items-optimized
 */

import { getSizeCategory } from "../../utils/size-based-optimization.js";
import { IncrementalProcessor, ProgressIndicator } from "../../utils/incremental-processor.js";
import { isReligionWorshipEnabled } from "../../core/homebrew/settings.js";
import { isShieldItem } from "../../core/items/shield-utils.js";
import {
  isDomainSpellItem,
  isRitualDomainItem,
  isInvocationItem
} from "../../core/religion/ritual-domains.js";
import { shouldHideFromMainInventory } from "./sheet-inventory.js";

/**
 * Default thresholds for incremental processing.
 */
const DEFAULT_THRESHOLDS = {
  small: 20,      // Use synchronous processing
  medium: 100,    // Use batched synchronous processing  
  large: 500,     // Use incremental processing with requestIdleCallback
};

/**
 * Process a single item for categorization (optimized version).
 * 
 * @param {Object} i - Item data
 * @param {Object} categories - Category containers
 * @param {Object} options - Processing options
 * @returns {Object} - Updated categories
 */
function processItemForCategories(i, categories, options = {}) {
  const { includeSkills = false, includeMagicSkills = false, religionEnabled = false } = options;
  
  // Ensure rendering has an image fallback (safe: sheet-only object)
  i.img = i.img || CONST.DEFAULT_TOKEN;
  i.system = i.system ?? {};
  const enchanting = i.flags?.["uesrpg-3ev4"]?.enchanting;
  const extension = i.flags?.["uesrpg-3ev4"]?.itemSpellcasting ?? {};
  const extensionEnabled = extension?.enabled === true;
  const extensionSlots = Array.isArray(extension?.slots) ? extension.slots : [];
  const extensionCanCast = extensionEnabled && extensionSlots.some((s) => s?.enabled !== false);

  const workshopCast = enchanting?.cast ?? {};
  const workshopCanCast = enchanting?.version === 2
    && enchanting?.enchantType === "cast"
    && Array.isArray(workshopCast?.spells)
    && workshopCast.spells.some((s) => s?.enabled !== false);

  i.system.uiHasCastEnchantment = extensionCanCast || workshopCanCast;

  // If an item is inside a container, hide it from the main inventory lists.
  // Contained items remain owned by the Actor and are surfaced through the container sheet UI.
  if (shouldHideFromMainInventory(i)) {
    return categories;
  }

  // Categorize item
  if (i.type === "equipment" || i.type === "item" || i.type === "scroll") {
    i.system?.equipped ? categories.gear.equipped.push(i) : categories.gear.unequipped.push(i);
  } else if (i.type === "weapon") {
    i.system.resolvedDistanceDisplay = _resolveWeaponDistanceDisplay(i.system);
    i.system?.equipped ? categories.weapon.equipped.push(i) : categories.weapon.unequipped.push(i);
  } else if (i.type === "armor") {
    if (isShieldItem(i, { allowLegacy: true })) {
      i.system?.equipped ? categories.shield.equipped.push(i) : categories.shield.unequipped.push(i);
    } else {
      i.system?.equipped ? categories.armor.equipped.push(i) : categories.armor.unequipped.push(i);
    }
  } else if (i.type === "shield") {
    i.system?.equipped ? categories.shield.equipped.push(i) : categories.shield.unequipped.push(i);
  } else if (i.type === "power") {
    categories.power.push(i);
  } else if (i.type === "trait") {
    categories.trait.push(i);
  } else if (i.type === "talent") {
    categories.talent.push(i);
  } else if (i.type === "combatStyle") {
    categories.combatStyle.push(i);
  } else if (i.type === "spell") {
    if (religionEnabled && isDomainSpellItem(i)) {
      i.system.domainSpell = true;
      i.system.domainKey = i.flags?.["uesrpg-3ev4"]?.religion?.domainKey ?? "";
    }
    categories.spell.push(i);
  } else if (includeSkills && i.type === "skill") {
    // Annotate profession metadata (non-persistent, sheet-only).
    // Only the explicit system.isProfession flag governs profession classification;
    // bracket notation in the name must not affect skill visibility.
    i._isProfession = Boolean(i.system?.isProfession);
    i._professionField = i.system?.field ?? "";
    categories.skill.push(i);
  } else if (i.type === "magicSkill") {
    if (religionEnabled && isRitualDomainItem(i)) {
      categories.ritualDomain?.push(i);
    } else if (includeMagicSkills) {
      categories.magicSkill.push(i);
    }
  } else if (religionEnabled && isInvocationItem(i)) {
    categories.invocation?.push(i);
  } else if (i.type === "ammunition") {
    i.system?.equipped ? categories.ammunition.equipped.push(i) : categories.ammunition.unequipped.push(i);
  } else if (i.type === "container") {
    categories.container.push(i);
  }

  return categories;
}

/**
 * Sort a category of items alphabetically.
 * 
 * @param {Array} category - Category array to sort
 * @param {string} categoryType - Type of category for special sorting rules
 */
function sortCategory(category, categoryType = 'default') {
  if (!Array.isArray(category) || category.length <= 1) return;
  
  if (categoryType === 'spell') {
    // Spells sort by school; everything else by name.
    category.sort((a, b) => {
      const schoolA = a.system?.school ?? "";
      const schoolB = b.system?.school ?? "";
      if (schoolA !== schoolB) return schoolA.localeCompare(schoolB);
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
  } else {
    category.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }
}

/**
 * Sort all item categories alphabetically if the setting is enabled.
 * 
 * @param {Object} categories - All categorized items
 * @param {boolean} sortAlpha - Whether to sort alphabetically
 */
function sortAllCategories(categories, sortAlpha) {
  if (!sortAlpha) return;
  
  // Sort each category
  sortCategory(categories.gear.equipped);
  sortCategory(categories.gear.unequipped);
  sortCategory(categories.weapon.equipped);
  sortCategory(categories.weapon.unequipped);
  sortCategory(categories.armor.equipped);
  sortCategory(categories.armor.unequipped);
  sortCategory(categories.shield.equipped);
  sortCategory(categories.shield.unequipped);
  sortCategory(categories.power);
  sortCategory(categories.trait);
  sortCategory(categories.talent);
  sortCategory(categories.combatStyle);
  sortCategory(categories.spell, 'spell');
  sortCategory(categories.ammunition.equipped);
  sortCategory(categories.ammunition.unequipped);
  sortCategory(categories.container);
  
  if (categories.skill) sortCategory(categories.skill);
  if (categories.magicSkill) sortCategory(categories.magicSkill);
  if (categories.ritualDomain) sortCategory(categories.ritualDomain);
  if (categories.invocation) sortCategory(categories.invocation);
}

/**
 * Optimized version of prepareCharacterItems that uses incremental processing for large datasets.
 * 
 * @param {Object} sheetData - Sheet data object
 * @param {Object} options - Options
 * @param {boolean} options.includeSkills - Include skill items
 * @param {boolean} options.includeMagicSkills - Include magic skill items
 * @param {Object} options.thresholds - Size thresholds for optimization
 * @returns {Object} - Updated sheetData with categorized items
 */
export async function prepareCharacterItemsOptimized(sheetData, options = {}) {
  const { includeSkills = false, includeMagicSkills = false, thresholds = DEFAULT_THRESHOLDS } = options;
  const actorData = sheetData.actor;
  const actorDoc = sheetData?.document ?? null;
  const religionEnabled = isReligionWorshipEnabled();
  const sortAlpha = game.settings.get("uesrpg-3ev4", "sortAlpha");

  // Initialize categories
  const categories = {
    gear: { equipped: [], unequipped: [] },
    weapon: { equipped: [], unequipped: [] },
    armor: { equipped: [], unequipped: [] },
    shield: { equipped: [], unequipped: [] },
    power: [],
    trait: [],
    talent: [],
    combatStyle: [],
    spell: [],
    ammunition: { equipped: [], unequipped: [] },
    container: [],
    ritualDomain: religionEnabled ? [] : null,
    invocation: religionEnabled ? [] : null,
    skill: includeSkills ? [] : null,
    magicSkill: includeMagicSkills ? [] : null,
  };

  const items = sheetData.items ?? [];
  const itemCount = items.length;
  const sizeCategory = getSizeCategory(itemCount, thresholds);

  // Process items based on size category
  if (sizeCategory === 'tiny' || sizeCategory === 'small') {
    // Small dataset: process synchronously
    for (const i of items) {
      processItemForCategories(i, categories, { includeSkills, includeMagicSkills, religionEnabled });
    }
  } else if (sizeCategory === 'medium') {
    // Medium dataset: process in batches synchronously
    const batchSize = 25;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      for (const item of batch) {
        processItemForCategories(item, categories, { includeSkills, includeMagicSkills, religionEnabled });
      }
    }
  } else {
    // Large or huge dataset: use incremental processing
    let progressIndicator = null;
    
    // Only show progress indicator for huge datasets (500+ items)
    if (itemCount >= thresholds.large) {
      progressIndicator = new ProgressIndicator({
        showPercentage: true,
        showTimeRemaining: true,
        showItemsPerSecond: false,
        autoRemove: true,
        removeDelay: 1000,
      });
      progressIndicator.show(`Processing ${itemCount} items...`);
    }
    
    try {
      const processor = new IncrementalProcessor(
        items,
        (item) => {
          processItemForCategories(item, categories, { includeSkills, includeMagicSkills, religionEnabled });
          return true;
        },
        {
          batchSize: sizeCategory === 'huge' ? 10 : 25,
          useIdleCallback: true,
          onProgress: (progress) => {
            if (progressIndicator) {
              progressIndicator.update(progress);
            }
          },
          onComplete: () => {
            if (progressIndicator) {
              progressIndicator.complete('Items processed');
            }
          },
          onError: (error) => {
            if (progressIndicator) {
              progressIndicator.complete('Error processing items');
            }
            console.error('Error in incremental item processing:', error);
          }
        }
      );
      
      await processor.process();
    } catch (error) {
      console.error('Error in incremental processing:', error);
      // Fallback to synchronous processing
      for (const i of items) {
        processItemForCategories(i, categories, { includeSkills, includeMagicSkills, religionEnabled });
      }
    } finally {
      // Ensure progress indicator is removed if still showing
      if (progressIndicator && progressIndicator.element) {
        setTimeout(() => progressIndicator.remove(), 500);
      }
    }
  }

  // Sort categories if needed
  sortAllCategories(categories, sortAlpha);

  // Attach categorized items to actorData for template use
  actorData.gear = categories.gear;
  actorData.weapon = categories.weapon;
  actorData.armor = categories.armor;
  actorData.shield = categories.shield;
  actorData.power = categories.power;
  actorData.trait = categories.trait;
  actorData.talent = categories.talent;
  actorData.combatStyle = categories.combatStyle;
  actorData.spell = categories.spell;
  actorData.ammunition = categories.ammunition;
  actorData.container = categories.container;
  
  if (includeSkills) actorData.skill = categories.skill;
  if (includeMagicSkills) actorData.magicSkill = categories.magicSkill;
  if (religionEnabled) {
    if (categories.ritualDomain) actorData.ritualDomain = categories.ritualDomain;
    if (categories.invocation) actorData.invocation = categories.invocation;
  }

  // Build spells by school for the spellbook tab
  const spellsBySchool = Object.create(null);
  for (const s of categories.spell) {
    const school = s.system?.school ?? "unknown";
    if (!spellsBySchool[school]) spellsBySchool[school] = [];
    spellsBySchool[school].push(s);
  }
  actorData.spellsBySchool = spellsBySchool;

  return sheetData;
}

/**
 * Hybrid wrapper that chooses between optimized and original implementation
 * based on dataset size and performance settings.
 * 
 * @param {Object} sheetData - Sheet data object
 * @param {Object} options - Options
 * @returns {Object} - Updated sheetData
 */
export async function prepareCharacterItemsHybrid(sheetData, options = {}) {
  const { includeSkills = false, includeMagicSkills = false } = options;
  const items = sheetData.items ?? [];
  const itemCount = items.length;
  
  // Use size-based selection: optimized for large datasets, original for small
  if (itemCount < DEFAULT_THRESHOLDS.medium) {
    // Use original implementation for small datasets
    const { prepareCharacterItems } = await import("./sheet-prepare-items.js");
    return prepareCharacterItems(sheetData, { includeSkills, includeMagicSkills });
  } else {
    // Use optimized implementation for large datasets
    return prepareCharacterItemsOptimized(sheetData, { includeSkills, includeMagicSkills });
  }
}

// Re-export the original function for compatibility
export { prepareCharacterItems } from "./sheet-prepare-items.js";