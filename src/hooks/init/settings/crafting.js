import { SYSTEM_ID } from "../../../core/system/namespace.js";
import { localizeSettingConfig } from "../../../utils/i18n.js";

function _reg(key, config) {
  if (game.settings.settings?.has(`${SYSTEM_ID}.${key}`)) {
    console.warn(`UESRPG | Settings: duplicate key "${key}" вЂ” skipping.`);
    return;
  }
  game.settings.register(SYSTEM_ID, key, localizeSettingConfig("Crafting", key, config));
}

export function registerCraftingSettings() {
  // Hidden GM rules/policy: long-term crafting toggles that still branch live runtime behavior.
  _reg("enchanting.enableCastEnchantmentRuntime", {
    name: "Enchanting: Enable Cast Enchantment Runtime",
    hint: "When enabled, cast enchantments can cast stored spells using Soul Energy from the enchanted item pool.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  _reg("enchanting.enableChargedStrikeVariant", {
    name: "Enchanting: Charged Strike Variant",
    hint: "When enabled, strike enchantments can use a charge pool (cost / 10 charges). Optional rule.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  _reg("enchanting.enableCursedConstant", {
    name: "Enchanting: Cursed Constant Enchantments",
    hint: "When enabled, constant enchantments can be marked Cursed (cannot be disabled; special failure cadence per RAW). Optional rule.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Hidden GM rules/policy: long-term alchemy toggles with live workshop/runtime consumers.
  _reg("alchemy.requireLab", {
    name: "Alchemy: Require Alchemy Lab",
    hint: "When enabled (RAW), the actor must have an Alchemy Lab item in their inventory to brew potions, poisons, or toxins.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  _reg("alchemy.enableGatheringHelper", {
    name: "Alchemy: Enable Gathering Helper",
    hint: "When enabled, the Workshop includes a Gather Ingredients mode to roll for and record gathered alchemical ingredients.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });
}
