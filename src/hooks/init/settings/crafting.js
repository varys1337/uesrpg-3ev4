import { SYSTEM_ID } from "../../../core/system/namespace.js";

function _reg(key, config) {
  if (game.settings.settings?.has(`${SYSTEM_ID}.${key}`)) {
    console.warn(`UESRPG | Settings: duplicate key "${key}" — skipping.`);
    return;
  }
  game.settings.register(SYSTEM_ID, key, config);
}

export function registerCraftingSettings() {
  // ── Enchanting Workshop ─────────────────────────────────────────────────────

  // NOTE: The Workshop is a core system element.
  // This setting remains for backward-compatibility with existing worlds, but
  // the runtime no longer gates the Workshop UI on this value.
  _reg("enchanting.enableWorkshop", {
    name: "Enchanting: Enable Workshop",
    hint: "Legacy toggle (no longer used as a gate). The Enchanting Workshop is a core system element and is enabled by default.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  // Strike-on-hit runtime (optional, default off — applies strike effects automatically after a confirmed hit).
  _reg("enchanting.enableStrikeRuntime", {
    name: "Enchanting: Enable Strike Runtime",
    hint: "When enabled, strike enchantment effects (elemental damage, conditions, drains, etc.) fire automatically on a confirmed hit. Requires enableWorkshop.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Cast enchantment runtime (default on).
  _reg("enchanting.enableCastEnchantmentRuntime", {
    name: "Enchanting: Enable Cast Enchantment Runtime",
    hint: "When enabled, cast enchantments can cast stored spells using Soul Energy from the enchanted item pool.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  // Wear-limit enforcement (optional, default off — can conflict with manual equip decisions).
  _reg("enchanting.enforceWearLimits", {
    name: "Enchanting: Enforce Wear Limits",
    hint: "When enabled, RAW enchanted-item wear limits are enforced (1 enchanted item per hit location, jewelry limits, 1 enchanted wielded per hand).",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Charged Strike variant (optional, default off).
  _reg("enchanting.enableChargedStrikeVariant", {
    name: "Enchanting: Charged Strike Variant",
    hint: "When enabled, strike enchantments can use a charge pool (cost / 10 charges). Optional rule.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Conjure instability (optional, default off).
  _reg("enchanting.enableConjureInstability", {
    name: "Enchanting: Conjure Instability",
    hint: "When enabled, bound-item enchantments that overlap an equipped slot cause instability wounds each turn per RAW. Optional rule.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // Cursed constant enchantments (optional, default off).
  _reg("enchanting.enableCursedConstant", {
    name: "Enchanting: Cursed Constant Enchantments",
    hint: "When enabled, constant enchantments can be marked Cursed (cannot be disabled; special failure cadence per RAW). Optional rule.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // ── Alchemy Workshop (always enabled — default: true) ───────────────────────

  // The Workshop is a core system element (same tier as the Enchanting Workshop).
  // Setting retained for backward-compatibility; the runtime no longer hard-gates on it.
  _reg("alchemy.enableWorkshop", {
    name: "Alchemy: Enable Workshop",
    hint: "Core system element — always available. Toggle retained for backward-compatibility.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  // Runtime gate: enables drink/apply/on-hit/round-tick hooks.
  _reg("alchemy.enableRuntime", {
    name: "Alchemy: Enable Runtime Automation",
    hint: "When enabled, drinking potions, applying poisons/toxins, on-hit resolution, and round tick-down are automated. Requires enableWorkshop.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });

  // RAW: require an Alchemy Lab item in inventory to brew.
  _reg("alchemy.requireLab", {
    name: "Alchemy: Require Alchemy Lab",
    hint: "When enabled (RAW), the actor must have an Alchemy Lab item in their inventory to brew potions, poisons, or toxins.",
    scope: "world",
    config: false,
    default: true,
    type: Boolean,
  });

  // Optional: gathering ingredient helper UI.
  _reg("alchemy.enableGatheringHelper", {
    name: "Alchemy: Enable Gathering Helper",
    hint: "When enabled, the Workshop includes a Gather Ingredients mode to roll for and record gathered alchemical ingredients.",
    scope: "world",
    config: false,
    default: false,
    type: Boolean,
  });
}
