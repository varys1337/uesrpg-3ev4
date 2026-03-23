/**
 * src/core/mass-warfare/clash/fray.js
 *
 * Fray chart for UESRPG Mass Warfare.
 *
 * Each Clash phase ends with one roll on this d100 table. The result is
 * narrative — additional mechanical effects (Condition restoration / extra
 * damage) are displayed on the chat card for the GM to apply manually,
 * except for the automated Condition loss from the main Clash procedure.
 */

/** @typedef {{ min: number, max: number, label: string, effect: string, description: string }} FrayEntry */

/** @type {FrayEntry[]} */
const FRAY_TABLE = [
  {
    min: 1, max: 1,
    label: "Allied Commander Wounded",
    effect: "allied-commander-wound",
    description: "The allied commander suffers a wound — roll on the hit location table.",
  },
  {
    min: 2, max: 50,
    label: "Nothing Happens",
    effect: "none",
    description: "The clash proceeds without remarkable incident.",
  },
  {
    min: 51, max: 60,
    label: "Heroic Rally",
    effect: "restore-1d6-condition",
    description: "Your unit rallies around a heroic soldier. Restore 1d6 Condition.",
  },
  {
    min: 61, max: 75,
    label: "Lose a Flank",
    effect: "lose-1d4-condition",
    description: "Your unit loses a flank and begins to rout. Lose 1d4 Condition.",
  },
  {
    min: 76, max: 89,
    label: "Press the Advantage",
    effect: "deal-1d4-extra",
    description: "Your unit presses an advantage and takes the enemy's flank. Deal an extra 1d4 damage.",
  },
  {
    min: 90, max: 99,
    label: "Enemy Champion Rallies",
    effect: "enemy-restore-1d6",
    description: "An enemy champion rallies their comrades. The enemy unit restores 1d6 Condition.",
  },
  {
    min: 100, max: 100,
    label: "Enemy Commander Wounded",
    effect: "enemy-commander-wound",
    description: "The enemy commander suffers a wound — roll on the hit location table.",
  },
];

/**
 * @typedef {object} FrayResult
 * @property {Roll}       roll
 * @property {number}     total
 * @property {string}     label
 * @property {string}     effect
 * @property {string}     description
 */

/**
 * Roll on the Fray chart.
 *
 * @returns {Promise<FrayResult>}
 */
export async function rollFray() {
  const roll = await new Roll("1d100").evaluate();
  const total = Number(roll.total);
  const entry = FRAY_TABLE.find(e => total >= e.min && total <= e.max)
    ?? FRAY_TABLE[1]; // fallback to "Nothing Happens"

  return {
    roll,
    total,
    label:       entry.label,
    effect:      entry.effect,
    description: entry.description,
  };
}
