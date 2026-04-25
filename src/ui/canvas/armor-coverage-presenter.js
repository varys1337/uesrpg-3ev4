/**
 * src/ui/canvas/armor-coverage-presenter.js
 *
 * Presenter for compact armor coverage renderers.
 */

export const ARMOR_COVERAGE_ROW_KEYS = Object.freeze(["head", "body", "arms", "legs"]);

const GROUP_LABELS = Object.freeze({
  head: "Head",
  body: "Body",
  arms: "Arms",
  legs: "Legs"
});

const GROUP_LOCATIONS = Object.freeze({
  head: ["Head"],
  body: ["Body"],
  arms: ["LeftArm", "RightArm"],
  legs: ["LeftLeg", "RightLeg"]
});

const LOCATION_LABELS = Object.freeze({
  Head: "Head",
  Body: "Body",
  LeftArm: "Left Arm",
  RightArm: "Right Arm",
  LeftLeg: "Left Leg",
  RightLeg: "Right Leg"
});

const STATE_LABELS = Object.freeze({
  full: "Covered",
  partial: "Partial",
  none: "Uncovered"
});

function _uniqueSourceNames(payload, locationKeys) {
  const names = new Set();
  for (const key of locationKeys) {
    const sources = payload?.locations?.[key]?.sources ?? [];
    for (const source of sources) {
      const name = String(source?.name ?? "").trim();
      if (name) names.add(name);
    }
  }
  return Array.from(names);
}

function _coveredLocationLabels(payload, locationKeys) {
  return locationKeys
    .filter(key => payload?.locations?.[key]?.covered === true)
    .map(key => LOCATION_LABELS[key] ?? key);
}

function _getDetailedTextForPartial(payload, rowKey, coveredLocations) {
  // For partial coverage with only one side covered, return the side name
  if (coveredLocations.length !== 1) return null;
  
  const covered = coveredLocations[0];
  if (covered.includes("Left")) return "Left";
  if (covered.includes("Right")) return "Right";
  return null;
}

function _tooltipForRow(payload, rowKey, state, { includeSources = false } = {}) {
  const label = GROUP_LABELS[rowKey] ?? rowKey;
  const locationKeys = GROUP_LOCATIONS[rowKey] ?? [];
  if (state === "none") return `${label}: uncovered`;

  const covered = _coveredLocationLabels(payload, locationKeys);
  const parts = [`${label}: ${STATE_LABELS[state] ?? state}`];
  if (state === "partial" && covered.length) parts.push(`(${covered.join(", ")})`);

  if (includeSources) {
    const sources = _uniqueSourceNames(payload, locationKeys);
    if (sources.length) parts.push(`- ${sources.join(", ")}`);
  }
  return parts.join(" ");
}

/**
 * Build compact armor coverage view-model.
 *
 * @param {object|null} payload
 * @param {object} [options]
 * @param {boolean} [options.includeSourceNames=false]
 * @returns {{actorId:string|null, tokenId:string|null, rows:Array}}
 */
export function buildArmorCoverageViewModel(payload, options = {}) {
  const includeSourceNames = options.includeSourceNames === true;
  const grouped = payload?.grouped ?? {};
  const rows = ARMOR_COVERAGE_ROW_KEYS.map((key) => {
    const state = String(grouped[key] ?? "none");
    const locationKeys = GROUP_LOCATIONS[key] ?? [];
    const covered = _coveredLocationLabels(payload, locationKeys);
    
    // Determine detailed text for partial coverage with single side
    let detailedText = null;
    if (state === "partial") {
      detailedText = _getDetailedTextForPartial(payload, key, covered);
    }
    
    return {
      key,
      label: GROUP_LABELS[key] ?? key,
      state,
      stateClass: `armor-coverage--${state}`,
      detailedText, // "Left", "Right", or null
      tooltip: _tooltipForRow(payload, key, state, { includeSources: includeSourceNames })
    };
  });

  return {
    actorId: payload?.actorId ?? null,
    tokenId: payload?.tokenId ?? null,
    rows
  };
}

