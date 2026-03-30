import { STAMINA_EFFECT_KEYS } from "./stamina-effects.js";

export const STAMINA_OPTIONS = [
  {
    id: "physical-exertion",
    name: "Physical Exertion",
    cost: 1,
    description: "+20 bonus on next STR/END based skill or characteristic test (not Combat Style)",
    effectKey: STAMINA_EFFECT_KEYS.PHYSICAL_EXERTION,
    consumeOn: "str-end-test"
  },
  {
    id: "sprint",
    name: "Sprint",
    cost: 1,
    description: "Next Dash action allows movement up to 2× speed",
    effectKey: STAMINA_EFFECT_KEYS.SPRINT,
    consumeOn: "dash"
  },
  {
    id: "power-draw",
    name: "Power Draw",
    cost: 1,
    description: "Reduce reload time by 1 for next ranged weapon shot",
    effectKey: STAMINA_EFFECT_KEYS.POWER_DRAW,
    consumeOn: "ranged-shot"
  },
  {
    id: "power-attack",
    name: "Power Attack",
    cost: "1-3",
    description: "+2 damage per SP spent (max +6), spend before damage roll",
    effectKey: STAMINA_EFFECT_KEYS.POWER_ATTACK,
    consumeOn: "damage-roll",
    allowAmount: true
  },
  {
    id: "power-block",
    name: "Power Block",
    cost: 1,
    description: "Double shield BR vs physical damage, spend after damage roll",
    effectKey: STAMINA_EFFECT_KEYS.POWER_BLOCK,
    consumeOn: "block"
  },
  {
    id: "heroic-action",
    name: "Heroic Action",
    cost: 1,
    description: "Immediately regain 1 AP (once per round)",
    effectKey: STAMINA_EFFECT_KEYS.HEROIC_ACTION,
    consumeOn: "immediate",
    immediate: true
  }
];

export function getStaminaIcon(optionId) {
  const icons = {
    "physical-exertion": "icons/magic/control/buff-strength-muscle-damage-orange.webp",
    "sprint": "icons/magic/movement/trail-streak-zigzag-yellow.webp",
    "power-draw": "icons/weapons/ammunition/arrow-head-war-grey.webp",
    "power-attack": "icons/skills/melee/strike-sword-steel-yellow.webp",
    "power-block": "icons/equipment/shield/heater-steel-Boss-red.webp",
    "heroic-action": "icons/magic/control/buff-flight-wings-runes-purple.webp"
  };
  return icons[optionId] || "icons/svg/aura.svg";
}

export function getStaminaOptionById(optionId) {
  return STAMINA_OPTIONS.find((option) => option.id === optionId) ?? null;
}
