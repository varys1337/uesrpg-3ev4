/**
 * src/core/combat/opposed/render.js
 * Chat card rendering helpers extracted from opposed-workflow.js monolith
 */

import { fmtDegree as _fmtDegree } from "./outcome-resolution.js";
import { renderMultiDefenderCard, renderSingleDefenderCard } from "./cards/renderers.js";
import { _getDefenderEntries, _getDefenderOutcome, _getDefenderAdvantage, _getDefenderResolutionState, _allDefendersCommitted, _isMultiDefender } from "./schema.js";
import { _isBankChoicesEnabledForData, _getBankCommitState } from "./banking/state.js";
import { _anyActiveGMOnline, _safeGetSetting } from "./helpers/util.js";
import { circumstanceLabel } from "../../opposed/circumstance.js";

/**
 * Render an opposed card's HTML content.
 * Delegates to the appropriate renderer based on defender count.
 * @param {Object} data - Opposed workflow data
 * @param {string} messageId - Chat message ID
 * @returns {string} Rendered HTML
 */
export function _renderCard(data, messageId) {
  const isMulti = Array.isArray(data?.defenders) && data.defenders.length > 1;

  const helpers = {
    _getDefenderEntries,
    _isBankChoicesEnabledForData,
    _anyActiveGMOnline,
    _getBankCommitState,
    _getDefenderOutcome,
    _getDefenderAdvantage,
    _getDefenderResolutionState,
    _allDefendersCommitted,
    _isMultiDefender,
    _safeGetSetting
  };

  return isMulti
    ? renderMultiDefenderCard(data, messageId, helpers)
    : renderSingleDefenderCard(data, messageId, helpers);
}

/**
 * Format variant label for display
 * @param {string} variant - Variant key
 * @returns {string} Display label
 */
export function _variantLabel(variant) {
  switch (variant) {
    case "allOut": return "All Out";
    case "precision": return "Precision";
    case "coup": return "Coup";
    case "normal":
    default: return "Attack";
  }
}

/**
 * Format circumstance modifier label
 * @param {number} mod - Modifier value
 * @returns {string} Display label
 */
export function _circumstanceLabel(mod) {
  return circumstanceLabel(mod);
}

/**
 * Create HTML button with data attributes
 * @param {string} label - Button label
 * @param {string} action - Action name
 * @param {Object} extraDataset - Additional data attributes
 * @returns {string} HTML button string
 */
export function _btn(label, action, extraDataset = {}) {
  const ds = Object.entries(extraDataset)
    .map(([k, v]) => `data-${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ");
  return `<button type="button" data-ues-opposed-action="${action}" ${ds}>${label}</button>`;
}

/**
 * Render TN breakdown details
 * @param {Object} tnObj - TN object with breakdown array
 * @returns {string} HTML details element
 */
export function _renderBreakdown(tnObj) {
  const rows = (tnObj?.breakdown ?? []).map(b => {
    const v = Number(b.value ?? 0);
    const sign = v >= 0 ? "+" : "";
    return `<div style="display:flex; justify-content:space-between; gap:10px;"><span>${b.label}</span><span>${sign}${v}</span></div>`;
  }).join("");
  if (!rows) return "";
  return `
    <details style="margin-top:4px;">
      <summary style="cursor:pointer; user-select:none;">TN breakdown</summary>
      <div style="margin-top:4px; font-size:12px; opacity:0.9;">${rows}</div>
    </details>`;
}

/**
 * Extract roll total from result object
 * @param {Object} res - Result object
 * @returns {number|null} Roll total or null
 */
export function _extractRollTotal(res) {
  const n = Number(res?.rollTotal ?? res?.total ?? res?.roll?.total ?? res?.roll?._total ?? res?.roll?.result ?? NaN);
  return Number.isFinite(n) ? n : null;
}

/**
 * Render roll result line
 * @param {Object} opts - Options
 * @returns {string} HTML roll line
 */
export function _renderRollLine({ result = null, noDefense = false } = {}) {
  if (noDefense) {
    const stub = { rollTotal: 100, isSuccess: false, degree: 1 };
    return `<div><b>Roll:</b> 100 (${_fmtDegree(stub)})</div>`;
  }
  if (!result) return `<div><b>Roll:</b> -</div>`;
  if (result.noRoll) {
    const outcome = result.isSuccess ? "Automatic Success" : "Automatic Failure";
    return `<div><b>Roll:</b> ${outcome} (${_fmtDegree(result)})</div>`;
  }
  const total = _extractRollTotal(result);
  if (total == null) return `<div><b>Roll:</b> -</div>`;
  return `<div><b>Roll:</b> ${total} (${_fmtDegree(result)})</div>`;
}
