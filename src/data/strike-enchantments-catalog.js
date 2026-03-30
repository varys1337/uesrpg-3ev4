/**
 * src/data/strike-enchantments-catalog.js
 *
 * Canonical strike enchantments catalog for the Enchanting Workshop runtime.
 * Sourced from the UESRPG Rules Compendium Strike Enchantments table.
 *
 * `strike-enchantments.json` is a generated compatibility artifact. Do not hand-edit it.
 *
 * Each entry:
 *  - key:         Unique identifier
 *  - label:       Display name
 *  - description: RAW description of the on-hit effect
 *  - paramKeys:   Array of param names required (["sl", "y", "type", ...])
 *  - paramLabels: Display labels for params
 *  - costFormula: Human-readable cost formula string
 *  - effectType:  Internal effect type for runtime automation
 *  - fixedCost:   Set if cost is fixed (overrides SL formula)
 *  - notes:       Additional notes for the GM
 */

export const STRIKE_ENCHANTMENTS_CATALOG = [
  {
    key: "fireDamage",
    label: "Fire Damage",
    description: "On hit: deal additional Fire damage equal to SL.",
    paramKeys: ["sl"],
    paramLabels: { sl: "Spell Level (1-7)" },
    costFormula: "SL * 10",
    effectType: "damage",
    damageType: "fire",
    notes: null,
  },
  {
    key: "frostDamage",
    label: "Frost Damage",
    description: "On hit: deal additional Frost damage equal to SL.",
    paramKeys: ["sl"],
    paramLabels: { sl: "Spell Level (1-7)" },
    costFormula: "SL * 10",
    effectType: "damage",
    damageType: "frost",
    notes: null,
  },
  {
    key: "shockDamage",
    label: "Shock Damage",
    description: "On hit: deal additional Shock damage equal to SL.",
    paramKeys: ["sl"],
    paramLabels: { sl: "Spell Level (1-7)" },
    costFormula: "SL * 10",
    effectType: "damage",
    damageType: "shock",
    notes: null,
  },
  {
    key: "drainMagicka",
    label: "Drain Magicka",
    description: "On hit: drain Y Magicka from the target.",
    paramKeys: ["sl", "y"],
    paramLabels: { sl: "Spell Level (1-7)", y: "Drain Amount" },
    costFormula: "SL * 10",
    effectType: "drain",
    drainPool: "magicka",
    notes: null,
  },
  {
    key: "drainHealth",
    label: "Drain Health",
    description: "On hit: drain Y Health from the target.",
    paramKeys: ["sl", "y"],
    paramLabels: { sl: "Spell Level (1-7)", y: "Drain Amount" },
    costFormula: "SL * 10",
    effectType: "drain",
    drainPool: "health",
    notes: null,
  },
  {
    key: "drainStamina",
    label: "Drain Stamina",
    description: "On hit: drain Y Stamina from the target.",
    paramKeys: ["sl", "y"],
    paramLabels: { sl: "Spell Level (1-7)", y: "Drain Amount" },
    costFormula: "SL * 10",
    effectType: "drain",
    drainPool: "stamina",
    notes: null,
  },
  {
    key: "paralyze",
    label: "Paralyze",
    description: "On hit: inflict the Paralyzed condition on the target for SL rounds.",
    paramKeys: ["sl"],
    paramLabels: { sl: "Spell Level (1-5)" },
    costFormula: "SL * 20",
    effectType: "condition",
    condition: "paralyzed",
    notes: null,
  },
  {
    key: "silence",
    label: "Silence",
    description: "On hit: inflict the Silenced condition on the target for SL rounds.",
    paramKeys: ["sl"],
    paramLabels: { sl: "Spell Level (1-5)" },
    costFormula: "SL * 15",
    effectType: "condition",
    condition: "silenced",
    notes: null,
  },
  {
    key: "dispel",
    label: "Dispel",
    description: "On hit: attempt to dispel magical effects on the target with Dispel Strength = SL.",
    paramKeys: ["sl"],
    paramLabels: { sl: "Spell Level = Dispel Strength" },
    costFormula: "SL * 10",
    effectType: "dispel",
    notes: null,
  },
  {
    key: "disintegrate",
    label: "Disintegrate",
    description: "On hit: apply the Damaged(SL) quality to the target's equipped weapon or armor.",
    paramKeys: ["sl", "type"],
    paramLabels: { sl: "Spell Level (1-7)", type: "Target: weapon or armor" },
    costFormula: "SL * 10",
    effectType: "disintegrate",
    notes: "type must be 'weapon' or 'armor'.",
  },
  {
    key: "soulTrap",
    label: "Soul Trap",
    description: "On hit: marks the target's soul. If the target dies within 1 minute, their soul is trapped in the wielder's soul gem.",
    paramKeys: [],
    paramLabels: {},
    costFormula: "50",
    effectType: "soulTrap",
    fixedCost: 50,
    notes: "Fixed cost 50. Integrates with the Soul Trap pipeline.",
  },
  {
    key: "absorpHealth",
    label: "Absorb Health",
    description: "On hit: drain Y Health from the target and restore it to the wielder.",
    paramKeys: ["sl", "y"],
    paramLabels: { sl: "Spell Level (1-7)", y: "Transfer Amount" },
    costFormula: "SL * 15",
    effectType: "absorb",
    absorbPool: "health",
    notes: null,
  },
  {
    key: "turnUndead",
    label: "Turn Undead",
    description: "On hit: forces undead targets to flee for SL rounds.",
    paramKeys: ["sl"],
    paramLabels: { sl: "Spell Level (1-5)" },
    costFormula: "SL * 15",
    effectType: "condition",
    condition: "fleeing",
    targetRestriction: "undead",
    notes: "Only affects undead targets.",
  },
];
