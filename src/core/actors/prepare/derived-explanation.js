/** Read-only projection of current prepared fields. Never calculates derived values. */
import { recordedDamageNumber } from "../../combat/damage/explanation.js";

const STATS = ["hp", "magicka", "stamina", "luck_points", "speed", "initiative", "wound_threshold"];
const FIELDS = ["base", "bonus", "max", "value"];
const MODES = ["add", "set", "multiply", "boolean"];
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function text(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function numericField(value) {
  const number = recordedDamageNumber(value);
  return { value: number, available: number !== null };
}

export function projectPreparedDerivedExplanation(system, { includeContributions = false } = {}) {
  const source = record(system), grouped = record(source.ui).featureModsByPath;
  return STATS.map(key => {
    const stat = record(source[key]);
    const fields = FIELDS.map(field => ({ key: field, labelKey: "UESRPG.Sheets.PreparedValues.Fields." + field, ...numericField(stat[field]) }));
    const contributions = includeContributions === true ? FIELDS.flatMap(field => {
      return [key + "." + field, "system." + key + "." + field].flatMap(path => {
        const entries = grouped instanceof Map ? grouped.get(path) : record(grouped)[path];
        return (Array.isArray(entries) ? entries : []).filter(entry => entry && typeof entry === "object" && !Array.isArray(entry))
          .map(entry => ({
            fieldLabelKey: "UESRPG.Sheets.PreparedValues.Fields." + field,
            label: text(record(entry.source).itemName) ?? text(record(entry.rule).name),
            modeLabelKey: MODES.includes(entry.mode) ? "UESRPG.Sheets.PreparedValues.Modes." + entry.mode : null,
            ...numericField(entry.value),
          }));
      });
    }) : [];
    return { key, labelKey: "UESRPG.Sheets.PreparedValues.Stats." + key, fields, contributions };
  });
}

