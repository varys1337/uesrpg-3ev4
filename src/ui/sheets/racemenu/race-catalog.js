import coreRaces from "./data/core-races.js";
import coreVariants from "./data/core-variants.js";
import khajiitFurstocks from "./data/khajiit-furstocks.js";
import expandedRaces from "./data/expanded-races.js";

export const RACE_CATALOG = Object.freeze({
  ...coreRaces,
  ...coreVariants,
  ...khajiitFurstocks,
  ...expandedRaces,
});

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function findRaceDefinition(raceKeyOrName) {
  const wanted = normalize(raceKeyOrName);
  if (!wanted) return null;
  for (const [raceKey, definition] of Object.entries(RACE_CATALOG)) {
    if (normalize(raceKey) === wanted || normalize(definition?.name) === wanted) {
      return { raceKey, definition };
    }
  }
  return null;
}

export function getRaceGrantDefinitions(raceKeyOrName) {
  const match = findRaceDefinition(raceKeyOrName);
  return Array.isArray(match?.definition?.chargen?.grants)
    ? match.definition.chargen.grants
    : [];
}
