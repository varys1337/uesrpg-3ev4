import { SYSTEM_ID } from "../constants.js";

const DSN_SYSTEM_ID = `${SYSTEM_ID}-imperial-legion`;
const DSN_COLORSET_ID = `${SYSTEM_ID}-imperial-legion-oxblood-bronze`;
const DSN_TEXTURE_ID = `${SYSTEM_ID}-imperial-legion-subtle-enamel`;
const DSN_BASE_PATH = `systems/${SYSTEM_ID}/images/dsn/imperial-legion`;

let diceSoNiceIntegrationRegistered = false;

function labelPath(die, face) {
  return `${DSN_BASE_PATH}/labels/${die}/${die}-${face}.png`;
}

function bumpPath(die, face) {
  return `${DSN_BASE_PATH}/bump/${die}/${die}-${face}.png`;
}

function sequentialFaces(max) {
  return Array.from({ length: max }, (_entry, index) => String(index + 1));
}

const DICE_PRESETS = [
  {
    type: "d4",
    shape: "d4",
    faces: sequentialFaces(4),
  },
  {
    type: "d6",
    shape: "d6",
    faces: sequentialFaces(6),
  },
  {
    type: "d8",
    shape: "d8",
    faces: sequentialFaces(8),
  },
  {
    type: "d10",
    shape: "d10",
    faces: sequentialFaces(10),
  },
  {
    type: "d12",
    shape: "d12",
    faces: sequentialFaces(12),
  },
  {
    type: "d100",
    shape: "d10",
    faces: ["00", "10", "20", "30", "40", "50", "60", "70", "80", "90"],
    values: { min: 0, max: 90 },
  },
];

function registerImperialLegionDice(dice3d) {
  dice3d.addSystem(
    {
      id: DSN_SYSTEM_ID,
      name: "UESRPG 3e v4 — Imperial Legion",
      group: "UESRPG 3e v4",
    },
    "default",
  );

  return dice3d
    .addTexture(DSN_TEXTURE_ID, {
      name: "Imperial Legion Subtle Oxblood Enamel",
      source: `${DSN_BASE_PATH}/imperial-legion-red-enamel-material.png`,
      composite: "multiply",
    })
    .then(() => {
      dice3d.addColorset(
        {
          name: DSN_COLORSET_ID,
          description: "Imperial Legion — Oxblood Bronze",
          category: "UESRPG 3e v4",
          foreground: "#d7a85c",
          background: "#5a120d",
          outline: "#1d0905",
          edge: "#8a5a25",
          texture: DSN_TEXTURE_ID,
          material: "plastic",
          font: "Arial Black",
          fontScale: {
            d4: 1,
            d6: 1.08,
            d8: 1,
            d10: 0.95,
            d12: 0.95,
            d100: 0.8,
          },
          visibility: "visible",
        },
        "default",
      );

      for (const preset of DICE_PRESETS) {
        dice3d.addDicePreset(
          {
            type: preset.type,
            labels: preset.faces.map((face) => labelPath(preset.type, face)),
            bumpMaps: preset.faces.map((face) => bumpPath(preset.type, face)),
            values: preset.values,
            colorset: DSN_COLORSET_ID,
            system: DSN_SYSTEM_ID,
          },
          preset.shape,
        );
      }
    });
}

/**
 * Register UESRPG 3e v4 Dice So Nice assets.
 *
 * This intentionally uses Dice So Nice's standard customization surface only:
 * system, colorset, texture, and dice presets. It does not mutate player Dice So
 * Nice settings. Players still need to select this preset/theme in Dice So Nice.
 */
export function registerDiceSoNiceIntegration() {
  if (diceSoNiceIntegrationRegistered) return;
  diceSoNiceIntegrationRegistered = true;

  Hooks.once("diceSoNiceReady", (dice3d) => {
    if (!dice3d) return;

    registerImperialLegionDice(dice3d).catch((error) => {
      console.error(`${SYSTEM_ID} | Failed to register Imperial Legion Dice So Nice assets`, error);
    });
  });
}
