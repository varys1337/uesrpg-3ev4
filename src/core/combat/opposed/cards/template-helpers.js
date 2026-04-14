/**
 * src/core/combat/opposed/cards/template-helpers.js
 * Pure template helper functions for opposed combat card rendering.
 * Extracted from opposed-workflow.js for maintainability.
 */

import { formatResultSummary } from "../../../../utils/degree-roll-helper.js";
import { t, tf } from "../../../../utils/i18n.js";

/**
 * Format degree of success/failure for display.
 * 
 * @param {Object} res - Test result object with `isSuccess` and `degree` properties.
 * @returns {string} - Formatted string like "3 DoS" or "2 DoF".
 */
export function _fmtDegree(res) {
  if (!res) return "-";
  const cls = res.isSuccess ? "green" : "red";
  const text = formatResultSummary(res, { includeDegree: true, degreeStyle: "paren" });
  return `<span style="color: ${cls};">${text}</span>`;
}

/**
 * Generate an HTML button for opposed card actions.
 * 
 * @param {string} label - Button label text.
 * @param {string} action - Action identifier (e.g., "attacker-commit", "defender-roll").
 * @param {Object} extraDataset - Additional data attributes to add to the button.
 * @returns {string} - HTML button element string.
 */
export function _btn(label, action, extraDataset = {}, style = "") {
  const ds = Object.entries(extraDataset)
    .map(([k, v]) => `data-${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ");
  const styleAttr = style ? ` style="${style}"` : "";
  return `<button type="button" data-ues-opposed-action="${action}" ${ds}${styleAttr}>${label}</button>`;
}

/**
 * Extract roll total from various result object structures.
 * 
 * @param {Object} res - Roll result object.
 * @returns {number|null} - Roll total or null if not found.
 */
export function _extractRollTotal(res) {
  const n = Number(res?.rollTotal ?? res?.total ?? res?.roll?.total ?? res?.roll?._total ?? res?.roll?.result ?? NaN);
  return Number.isFinite(n) ? n : null;
}

function _buildBreakdownRows(tnObj) {
  return (tnObj?.breakdown ?? []).map((b) => {
    const v = Number(b.value ?? 0);
    const sign = v >= 0 ? "+" : "";
    const label = String(b.label ?? "Modifier");
    return `<div style="display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:start;"><span style="overflow-wrap:anywhere; word-break:normal; text-align:left;">${label}</span><span style="white-space:nowrap; text-align:right;">${sign}${v}</span></div>`;
  }).join("");
}

/**
 * Render TN breakdown details as collapsible HTML.
 * 
 * @param {Object} tnObj - TN object with `breakdown` array property.
 * @param {Object} options - Render options.
 * @param {boolean} options.inline - When true, render as inline triangle toggle.
 * @returns {string} - HTML details element with breakdown rows.
 */
export function _renderBreakdown(tnObj, { inline = false } = {}) {
  const rows = _buildBreakdownRows(tnObj);
  if (!rows) return "";
  if (inline) {
    return `
      <details style="display:inline-block; margin-left:6px; vertical-align:baseline;">
        <summary style="display:inline-block; cursor:pointer; user-select:none; white-space:nowrap;" title="${t("UESRPG.Chat.Common.TnBreakdown", "TN breakdown")}">&#9654;</summary>
        <div style="margin-top:4px; font-size:12px; opacity:0.9;">${rows}</div>
      </details>
    `;
  }
  return `
    <details style="margin-top:4px;">
      <summary style="cursor:pointer; user-select:none; white-space:nowrap; overflow-wrap:normal; word-break:keep-all;">${t("UESRPG.Chat.Common.TnBreakdown", "TN breakdown")}</summary>
      <div style="margin-top:4px; font-size:12px; opacity:0.9;">${rows}</div>
    </details>`;
}

/**
 * Render TN line with inline breakdown toggle.
 *
 * @param {Object} options
 * @param {string} options.value - TN display value.
 * @param {Object|null} options.tnObj - TN object with breakdown.
 * @returns {string}
 */
export function _renderTNLine({ value = "??", tnObj = null } = {}) {
  const rows = _buildBreakdownRows(tnObj);
  if (!rows) return `<div><b>${t("UESRPG.Chat.Common.TN", "TN")}:</b> ${value}</div>`;
  return `
    <details style="margin:0;">
      <summary style="display:inline-block; cursor:pointer; user-select:none; white-space:nowrap;">
        <b>${t("UESRPG.Chat.Common.TN", "TN")}:</b> ${value} &#9654;
      </summary>
      <div style="margin:4px 0 0 0; padding-left:8px; width:100%; box-sizing:border-box; font-size:12px; opacity:0.9;">${rows}</div>
    </details>
  `;
}

/**
 * Render roll result line (total + degree).
 * 
 * @param {Object} options - Options object.
 * @param {Object|null} options.result - Roll result object.
 * @param {boolean} options.noDefense - True if defender chose "No Defense".
 * @returns {string} - HTML string with roll total and degree.
 */
export function _renderRollLine({ result = null, noDefense = false } = {}) {
  if (noDefense) {
    // Keep output consistent with normal failures: represent No Defense as a deterministic 1 DoF failure.
    const stub = { rollTotal: 100, isSuccess: false, degree: 1 };
    return `<div><b>${t("UESRPG.Chat.Common.Roll", "Roll")}:</b> 100 - ${_fmtDegree(stub)}</div>`;
  }
  if (!result) return "";
  const total = _extractRollTotal(result);
  const totalText = (total == null) ? "??" : String(total);
  const notes = Array.isArray(result?.talentNotes) ? result.talentNotes.filter(Boolean) : [];
  const notesHtml = notes.length
    ? `<div class="uesrpg-opposed-notes" style="font-size:0.85em; opacity:0.85;">${notes.map(n => `<div>${n}</div>`).join("")}</div>`
    : "";
  return `<div><b>${t("UESRPG.Chat.Common.Roll", "Roll")}:</b> ${totalText} - ${_fmtDegree(result)}</div>${notesHtml}`;
}

/**
 * Build attacker status line for banking mode.
 * 
 * @param {Object} options - Options object.
 * @param {boolean} options.bankMode - True if banking mode enabled.
 * @param {boolean} options.anyOutcome - True if any outcome exists.
 * @param {boolean} options.rolled - True if attacker has rolled.
 * @param {boolean} options.aCommitted - True if attacker committed.
 * @returns {string} - HTML status line or empty string.
 */
export function _buildAttackerStatusLine({ bankMode, anyOutcome, rolled, aCommitted }) {
  const showStatus = Boolean(game?.settings?.get?.("uesrpg-3ev4", "opposedShowStatusLine"));
  if (!bankMode || !showStatus) return "";
  const resolved = anyOutcome;
  const statusText = resolved
    ? t("UESRPG.Chat.Status.Resolved", "Resolved")
    : rolled
      ? t("UESRPG.Chat.Status.Rolled", "Rolled")
      : (aCommitted ? t("UESRPG.Chat.Status.Committed", "Committed") : t("UESRPG.Chat.Status.AwaitingChoice", "Awaiting choice"));
  return `<div style="margin-top:4px; font-size:12px; opacity:0.85;"><b>${t("UESRPG.Chat.Common.Status", "Status")}:</b> ${statusText}</div>`;
}

/**
 * Build defender status line for banking mode.
 * 
 * @param {Object} options - Options object.
 * @param {boolean} options.bankMode - True if banking mode enabled.
 * @param {boolean} options.outcome - Outcome object (truthy if resolved).
 * @param {boolean} options.rolled - True if defender has rolled.
 * @param {boolean} options.dCommitted - True if defender committed.
 * @param {boolean} options.noDefense - True if defender chose "No Defense".
 * @returns {string} - HTML status line or empty string.
 */
export function _buildDefenderStatusLine({ bankMode, outcome, rolled, dCommitted, noDefense = false }) {
  const showStatus = Boolean(game?.settings?.get?.("uesrpg-3ev4", "opposedShowStatusLine"));
  if (!bankMode || !showStatus) return "";
  const resolved = Boolean(outcome);
  const actuallyRolled = rolled || noDefense;
  const statusText = resolved
    ? t("UESRPG.Chat.Status.Resolved", "Resolved")
    : actuallyRolled
      ? t("UESRPG.Chat.Status.Rolled", "Rolled")
      : (dCommitted ? t("UESRPG.Chat.Status.Committed", "Committed") : t("UESRPG.Chat.Status.AwaitingChoice", "Awaiting choice"));
  return `<div style="margin-top:4px; font-size:12px; opacity:0.85;"><b>${t("UESRPG.Chat.Common.Status", "Status")}:</b> ${statusText}</div>`;
}

/**
 * Build attacker action buttons (Commit / Roll / Follow-up Strike).
 * 
 * @param {Object} options - Options object.
 * @param {Object} options.attacker - Attacker data object.
 * @param {boolean} options.bankMode - True if banking mode enabled.
 * @param {boolean} options.aCommitted - True if attacker committed.
 * @param {Object} options.data - Full opposed workflow data.
 * @param {Function} options._safeGetSetting - Safe settings getter function.
 * @param {boolean} options.isAutoRolling - True while banked auto-roll is pending/running.
 * @returns {string} - HTML action buttons or empty string.
 */
export function _buildAttackerActions({ attacker, bankMode, aCommitted, data, _safeGetSetting, commitGate = null, isAutoRolling = false }) {
  if (attacker.result) {
    const fus = data?.context?.followUpStrike;
    const followUpEnabled = _safeGetSetting?.("uesrpg-3ev4", "enableFollowupStrike", false) ?? false;
    if (
      followUpEnabled &&
      fus?.eligible === true && fus?.used !== true &&
      attacker.result?.isSuccess === false
    ) {
      return `<div style="margin-top:6px;">${_btn("Follow-up Strike (1 SP)", "followup-strike", { "defender-index": 0 })}</div>`;
    }
    return "";
  }
  if (bankMode) {
    if (isAutoRolling) return "";
    if (!aCommitted) {
      if (commitGate?.allowed === false) {
        const reason = String(commitGate?.reason ?? "Unavailable");
      return `<div style="margin-top:6px; font-size:12px; opacity:0.85;"><i>${tf("UESRPG.Chat.Opposed.AttackUnavailable", { reason }, `Attack unavailable: ${reason}`)}</i></div>`;
      }
      return `<div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single">${_btn(t("UESRPG.Chat.Opposed.Attack", "Attack"), "attacker-commit")}</div>`;
    }
    return "";
  }
  return `<div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single">${_btn(t("UESRPG.Chat.Opposed.RollAttack", "Roll Attack"), "attacker-roll")}</div>`;
}

/**
 * Build defender action buttons (Commit / Roll / No Defense).
 * 
 * @param {Object} options - Options object.
 * @param {Object} options.defender - Defender data object.
 * @param {boolean} options.bankMode - True if banking mode enabled.
 * @param {boolean} options.dCommitted - True if defender committed.
 * @param {number} options.idx - Defender index (for multi-defender).
 * @param {Object} options.data - Full opposed workflow data.
 * @param {Function} options._allDefendersCommitted - Helper to check if all committed.
 * @param {boolean} options.isAutoRolling - True while banked auto-roll is pending/running.
 * @returns {string} - HTML action buttons or empty string.
 */
export function _buildDefenderActions({ defender, bankMode, dCommitted, idx, data, _allDefendersCommitted, commitDefenseGate = null, isAutoRolling = false }) {
  if (defender.result || defender.noDefense) return "";

  if (bankMode) {
    if (isAutoRolling) return "";
    if (!dCommitted) {
      if (commitDefenseGate?.allowed === false) {
        const reason = String(commitDefenseGate?.reason ?? "Unavailable");
        return `
        <div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single">
          ${_btn(t("UESRPG.Chat.Opposed.NoDefense", "No Defense"), "defender-commit-nodefense", { "defender-index": idx })}
          <div style="font-size:12px; opacity:0.85;"><i>${tf("UESRPG.Chat.Opposed.DefenseUnavailable", { reason }, `Defense unavailable: ${reason}`)}</i></div>
        </div>`;
      }
      return `
        <div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--pair">
          ${_btn(t("UESRPG.Chat.Opposed.Defense", "Defense"), "defender-commit", { "defender-index": idx })}
          ${_btn(t("UESRPG.Chat.Opposed.NoDefense", "No Defense"), "defender-commit-nodefense", { "defender-index": idx })}
        </div>`;
    }

    // For banking: only show roll button when ALL defenders have committed
    // This ensures proper banking workflow where all choices are locked before rolls
    if (dCommitted && _allDefendersCommitted(data) && !defender.result) {
      const dt = String(defender?.defenseType ?? "").toLowerCase();
      if (dt && dt !== "none") {
        return `<div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single">${_btn(t("UESRPG.Chat.Opposed.RollDefense", "Roll Defense"), "defender-roll-committed", { "defender-index": idx })}</div>`;
      }
    }

    return "";
  }

  return `
    <div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--pair">
      ${_btn(t("UESRPG.Chat.Opposed.Defend", "Defend"), "defender-roll", { "defender-index": idx })}
      ${_btn(t("UESRPG.Chat.Opposed.NoDefense", "No Defense"), "defender-nodefense", { "defender-index": idx })}
    </div>`;
}

/**
 * Build outcome status line (Resolved / Waiting / Pending).
 * 
 * @param {Object} options - Options object.
 * @param {Object|null} options.outcome - Outcome object.
 * @param {boolean} options.bankMode - True if banking mode enabled.
 * @param {boolean} options.bothCommitted - True if both sides committed (single-defender).
 * @param {boolean} options.allDefendersCommitted - True if all defenders committed (multi-defender).
 * @param {boolean} options.aCommitted - True if attacker committed.
 * @param {boolean} options.anyGMOnline - True if any GM online.
 * @param {Object} options.data - Full opposed workflow data (for legacy phase tracking).
 * @param {boolean} options.isMulti - True if multi-defender.
 * @returns {string} - HTML outcome line.
 */
export function _buildOutcomeLine({ outcome, bankMode, bothCommitted, allDefendersCommitted, aCommitted, anyGMOnline, data, isMulti }) {
  if (outcome) {
    return `<div style="margin-top:10px; max-width:100%; overflow-wrap:break-word;"><b>${t("UESRPG.Chat.Common.Outcome", "Outcome")}:</b> ${outcome.text ?? ""}</div>`;
  }

  if (bankMode) {
    if (isMulti) {
      if (!allDefendersCommitted) {
        if (!aCommitted) {
          return `<div style="margin-top:10px; font-size:13px;"><i>${t("UESRPG.Chat.Opposed.WaitingAttackerCommit", "Waiting for attacker to commit choice.")}</i></div>`;
        }
        return `<div style="margin-top:10px; font-size:13px;"><i>${t("UESRPG.Chat.Opposed.WaitingDefendersCommit", "Waiting for all defenders to commit choices.")}</i></div>`;
      }
      return `<div style="margin-top:10px; font-size:13px;"><i>${t("UESRPG.Chat.Opposed.Rolling", "Rolling.")}</i></div>`;
    }

    if (!bothCommitted) {
      return `<div style="margin-top:10px; font-size:13px;"><i>${t("UESRPG.Chat.Opposed.WaitingBothCommit", "Waiting for both sides to commit choices...")}</i></div>`;
    }

    return `<div style="margin-top:10px; font-size:13px;"><i>${t("UESRPG.Chat.Opposed.RollingEllipsis", "Rolling...")}</i></div>`;
  }

  // Legacy/non-banked pending hint
  const phase = String(data?.context?.phase ?? "pending");
  const waitingSince = Number(data?.context?.waitingSince ?? 0);
  const ageMs = waitingSince ? (Date.now() - waitingSince) : 0;
  const isWaiting = (phase === "waitingdefender" || phase === "waitingDefender");
  const isStale = isWaiting && ageMs > 60000;
  const note = isStale
    ? `<div style="margin-top:6px; font-size:12px; opacity:0.85;">
         ${t("UESRPG.Chat.Opposed.StillWaitingDefenderResult", "Still waiting on the defender result. If this persists, ensure the defender roll message was posted, and have the attacker refresh the page to re-render the card.")}
       </div>`
    : "";
  return `<div style="margin-top:10px;"><i>${t("UESRPG.Chat.Status.Pending", "Pending")}</i></div>${note}`;
}

/**
 * Build resolution details collapsible section.
 * 
 * @param {Object} options - Options object.
 * @param {boolean} options.showResolutionDetails - Setting to show details.
 * @param {Object|null} options.outcome - Outcome object.
 * @param {Object} options.attacker - Attacker data object.
 * @param {Object} options.defender - Defender data object.
 * @param {Object} options.advantage - Advantage object { attacker, defender }.
 * @returns {string} - HTML details element or empty string.
 */
export function _buildResolutionDetails({ showResolutionDetails, outcome, attacker, defender, advantage }) {
  if (!showResolutionDetails) return "";
  if (!outcome) return "";

  const aVariant = attacker.variantLabel ?? attacker.variant ?? "??";
  const dDefense = defender.defenseLabel ?? defender.defenseType ?? "??";
  const advA = Number(advantage?.attacker ?? 0);
  const advD = Number(advantage?.defender ?? 0);
  const aManual = Number(attacker.manualMod ?? 0);
  const aHL = (attacker.precisionLocation ?? attacker.hitLocation ?? "").toString();
  const dHL = (defender.precisionLocation ?? defender.hitLocation ?? "").toString();

  const lines = [];
  lines.push(`<div><b>${t("UESRPG.Chat.Opposed.AttackVariation", "Attack variation")}:</b> ${aVariant}</div>`);
  lines.push(`<div><b>${t("UESRPG.Chat.Common.ManualModifier", "Manual modifier")}:</b> ${aManual >= 0 ? "+" : ""}${aManual}</div>`);
  if (aHL) lines.push(`<div><b>${t("UESRPG.Chat.Opposed.AttackerHitLocation", "Attacker hit location")}:</b> ${aHL}</div>`);
  if (dHL) lines.push(`<div><b>${t("UESRPG.Chat.Opposed.DefenderHitLocation", "Defender hit location")}:</b> ${dHL}</div>`);
  lines.push(`<div><b>${t("UESRPG.Chat.Common.Advantage", "Advantage")}:</b> ${tf("UESRPG.Chat.Opposed.AdvantageSplit", { attacker: advA, defender: advD }, `Attacker ${advA} / Defender ${advD}`)}</div>`);
  lines.push(`<div><b>${t("UESRPG.Chat.Opposed.Defense", "Defense")}:</b> ${dDefense}</div>`);
  if (Number(defender?.result?.duelingBonus ?? 0) > 0) {
    lines.push(`<div><b>Dueling Weapon:</b> +${Number(defender.result.duelingBonus)} DoS</div>`);
  }

  return `
    <details style="margin-top:8px;">
      <summary style="cursor:pointer;">${t("UESRPG.Chat.Opposed.ResolutionDetails", "Resolution details")}</summary>
      <div style="margin-top:6px; font-size:12px; opacity:0.9;">
        ${lines.join("")}
      </div>
    </details>`;
}

/**
 * Build resolved action buttons (Damage / Counter / Block / Advantage).
 * 
 * @param {Object} options - Options object.
 * @param {Object|null} options.outcome - Outcome object.
 * @param {Object} options.defender - Defender data object.
 * @param {Object} options.advantage - Advantage object { attacker, defender }.
 * @param {Object} options.resolutionState - Resolution state object.
 * @param {number} options.idx - Defender index (for multi-defender).
 * @param {boolean} options.isAoE - True if AoE attack.
 * @param {string} options.status - Workflow status (e.g., "resolved").
 * @param {Object|null} options.damageData - Inline damage data (if rolled).
 * @returns {string} - HTML action buttons or empty string.
 */
export function _buildResolvedActions({ outcome, defender, advantage, resolutionState, idx, isAoE, status, damageData, allowDefenderAdvantage = true }) {
  if (!outcome) return "";
  if (status && status !== "resolved") return ""; // Single-defender specific check

  // If inline damage has already been rolled, suppress the action buttons.
  // The damage panel will be rendered separately.
  if (damageData?.rolled === true) return "";

  const advA = Number(advantage?.attacker ?? 0);
  const advD = Number(advantage?.defender ?? 0);

  if (outcome.winner === "attacker") {
    return `
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        ${_btn(t("UESRPG.Chat.Opposed.RollDamage", "Roll Damage"), "damage-roll", { "defender-index": idx })}
        ${advA > 0 ? `<span style="opacity:0.85; font-size:12px;">${t("UESRPG.Chat.Common.Advantage", "Advantage")}: ${advA}</span>` : ``}
      </div>
    `;
  }

  if (outcome.winner === "defender" && (defender.defenseType ?? "none") === "counter") {
    return `
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        ${_btn(t("UESRPG.Chat.Opposed.RollDamage", "Roll Damage"), "counter-damage-roll", { "defender-index": idx })}
        ${advD > 0 ? `<span style="opacity:0.85; font-size:12px;">${t("UESRPG.Chat.Common.Advantage", "Advantage")}: ${advD}</span>` : ``}
      </div>
    `;
  }

  const defenseType = String(defender?.defenseType ?? "none").toLowerCase();
  const blockSource = String(defender?.blockSource ?? "").toLowerCase();
  const isWardDefense = defenseType === "ward" || (defenseType === "block" && blockSource === "ward");
  const isShieldBlockDefense = defenseType === "block" && !isWardDefense;

  if (outcome.winner === "defender" && isShieldBlockDefense) {
    const blockLabel = isAoE ? t("UESRPG.Chat.Opposed.ResolveBlockHalfDamage", "Resolve Block (Half Damage)") : t("UESRPG.Chat.Opposed.ResolveBlock", "Resolve Block");
    return `
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        ${_btn(blockLabel, "block-resolve", { "defender-index": idx, "ues-gm-only": "true" })}
        ${advD > 0 ? `<span style="opacity:0.85; font-size:12px;">${t("UESRPG.Chat.Common.Advantage", "Advantage")}: ${advD}</span>` : ``}
      </div>
    `;
  }

  if (outcome.winner === "defender" && isWardDefense) {
    const wardLabel = isAoE ? t("UESRPG.Chat.Opposed.ResolveWardHalfDamage", "Resolve Ward (Half Damage)") : t("UESRPG.Chat.Opposed.ResolveWard", "Resolve Ward");
    return `
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        ${_btn(wardLabel, "ward-resolve", { "defender-index": idx })}
        ${advD > 0 ? `<span style="opacity:0.85; font-size:12px;">${t("UESRPG.Chat.Common.Advantage", "Advantage")}: ${advD}</span>` : ``}
      </div>
    `;
  }

  const defenderCanUseAdvantage = (outcome.winner === "defender")
    && (defender.noDefense !== true)
    && !["counter", "none"].includes(defenseType)
    && !isWardDefense
    && !isShieldBlockDefense
    && allowDefenderAdvantage
    && (advD > 0)
    && (resolutionState.defenderAdvantage?.resolved !== true);

  if (defenderCanUseAdvantage) {
    return `
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        ${_btn(t("UESRPG.Chat.Opposed.ResolveAdvantage", "Resolve Advantage"), "defender-advantage", { "defender-index": idx })}
        <span style="opacity:0.85; font-size:12px;">${t("UESRPG.Chat.Common.Advantage", "Advantage")}: ${advD}</span>
      </div>
    `;
  }

  return "";
}

/**
 * Build inline damage panel for the opposed card.
 * Renders damage results, hit location, quality pills, and Apply button
 * inline within the opposed card instead of a separate chat message.
 *
 * @param {Object|null} damageData - Damage state from flags.
 * @returns {string} - HTML string for the damage panel, or empty string.
 */
export function _buildDamagePanel(damageData, { markers = [] } = {}) {
  if (!damageData || damageData.rolled !== true) return "";

  const mode = String(damageData.mode ?? "weapon");
  const isHealing = mode === "healing";
  const p = damageData.applyPayload ?? {};
  const gmReportKey = String(damageData?.gmDamageReport?.panelKey ?? "").trim();

  // ── Compact header: small icon + name ──
  const headerImg = damageData.weaponImg
    ? `<img class="dmg-icon" src="${damageData.weaponImg}">`
    : "";
  const headerLabel = damageData.weaponName || damageData.effectLabel || (isHealing ? t("UESRPG.Chat.Common.Healing", "Healing") : t("UESRPG.Chat.Common.Damage", "Damage"));

  // ── Block/Ward status badge (single compact line) ──
  let statusBadge = "";
  if (mode === "block" && damageData.blockResult) {
    const br = damageData.blockResult;
    if (br.blocked) {
      statusBadge = `<span class="dmg-status dmg-status--blocked">\u{1F6E1} Blocked (BR ${br.blockRating}${br.shieldSplitter ? ", SS" : ""})</span>`;
    } else if (br.isAoE) {
      statusBadge = `<span class="dmg-status dmg-status--aoe">\u{1F6E1} AoE Blocked \u2192 ${br.reducedDamage ?? damageData.finalDamage} dmg</span>`;
    } else {
      statusBadge = `<span class="dmg-status dmg-status--penetrated">\u26A0 Block Penetrated (${damageData.finalDamage} &gt; BR ${br.blockRating})</span>`;
    }
  }
  if (mode === "ward" && damageData.wardResult) {
    const wr = damageData.wardResult;
    if (wr.blocked) {
      statusBadge = `<span class="dmg-status dmg-status--blocked">\u{1F6E1} Warded (BR ${wr.wardBR})</span>`;
    } else if (wr.isAoE) {
      statusBadge = `<span class="dmg-status dmg-status--aoe">\u{1F6E1} AoE Warded \u2192 ${wr.reducedDamage ?? damageData.finalDamage} dmg</span>`;
    } else {
      statusBadge = `<span class="dmg-status dmg-status--penetrated">\u26A0 Ward Penetrated (${damageData.finalDamage} &gt; BR ${wr.wardBR})</span>`;
    }
  }

  const fullyBlocked = (mode === "block" && damageData.blockResult?.blocked && !damageData.blockResult?.isAoE)
    || (mode === "ward" && damageData.wardResult?.blocked && !damageData.wardResult?.isAoE);

  // ── Roll detail (collapsible for A/B rolls) ──
  const damageLabel = isHealing ? t("UESRPG.Chat.Common.Healing", "Healing") : t("UESRPG.Chat.Common.Damage", "Damage");
  const pills = damageData.qualityPillsHtml ?? "";
  const metadataRows = Array.isArray(damageData.panelMetadata)
    ? damageData.panelMetadata.filter((row) => row && typeof row === "object" && row.value != null && String(row.value).trim() !== "")
    : [];
  const damageComponents = Array.isArray(damageData.damageComponents) ? damageData.damageComponents : [];
  const componentsHtml = damageComponents.length
    ? `<div class="dmg-components">${damageComponents.map((c) => {
      const label = String(c?.sourceLabel ?? c?.source ?? "Source");
      const amount = Number(c?.amount ?? 0) || 0;
      const dtype = String(c?.damageType ?? "").trim();
      return `<div class="dmg-component-line"><span class="dmg-component-source">${label}</span><span class="dmg-component-value"><b>${amount}</b>${dtype ? ` <span class="type-tag">${dtype}</span>` : ""}</span></div>`;
    }).join("")}</div>`
    : "";

  // ── Combined header row: icon + name + hit location on one line ──
  const hdrRowHtml = fullyBlocked
    ? `<div class="dmg-hdr">${headerImg}</div>`
    : `<div class="dmg-hdr" style="display:grid; grid-template-columns:${headerImg ? "auto " : ""}minmax(0,1fr) auto; gap:6px 16px; align-items:center;">${headerImg}<div class="dmg-title" style="font-weight:700;">${headerLabel}</div><div class="dmg-hitloc"><b>Hit Loc.</b> ${damageData.hitLocation ?? "Body"}</div></div>`;
  const pillsHtml = pills ? `<div class="val-pills">${pills}</div>` : "";
  const metadataHtml = metadataRows.length
    ? `<div class="dmg-meta" style="display:grid; gap:2px; margin:6px 0 2px 0;">${metadataRows.map((row) => `<div><b>${foundry.utils.escapeHTML(String(row.label ?? "Info"))}:</b> ${foundry.utils.escapeHTML(String(row.value ?? ""))}</div>`).join("")}</div>`
    : "";
  const damageDisplayHtml = fullyBlocked ? "" : `
    <div class="dmg-kv">
      ${metadataHtml}
      ${pillsHtml}
      ${componentsHtml}
    </div>`;

  const gmDetailsAnchor = (gmReportKey || p.targetUuid)
    ? `<div class="dmg-gm-breakdown-anchor" data-ues-gm-damage-report-key="${gmReportKey}" data-ues-gm-damage-target="${String(p.targetUuid ?? "").trim()}"></div>`
    : "";

  const damageDetailsHtml = (!fullyBlocked && gmDetailsAnchor) ? `
    <details class="dmg-details">
      <summary class="dmg-details-summary">${t("UESRPG.UI.Details", "Details")}</summary>
      <div class="dmg-details-content">
        ${gmDetailsAnchor}
      </div>
    </details>` : "";
  const kvGrid = damageDisplayHtml + damageDetailsHtml;


  // ── Extra note ──
  const extraNoteHtml = damageData.extraNoteHtml
    ? `<div class="dmg-note">${damageData.extraNoteHtml}</div>`
    : "";

  // ── Action: apply button or applied state ──
  const visibleMarkers = Array.isArray(markers)
    ? markers.filter((marker) => marker && typeof marker === "object")
    : [];
  const markerHtml = visibleMarkers.length
    ? visibleMarkers.map((marker) => `<span class="damage-applied-label">${String.raw`\u2713`} ${foundry.utils.escapeHTML(String(marker.label ?? "Advantage Resolved"))}</span>`).join("")
    : "";

  let actionSection = "";
  if (fullyBlocked) {
    actionSection = markerHtml
      ? `<div class="dmg-action" style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">${markerHtml}</div>`
      : "";
  } else if (damageData.applied) {
    actionSection = `<div class="dmg-action" style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;"><span class="damage-applied-label">\u2713 ${tf("UESRPG.Chat.Common.Applied", { label: damageLabel }, `${damageLabel} Applied`)}</span>${markerHtml}</div>`;
  } else {
    const btnClass = isHealing ? "apply-healing-btn" : "apply-damage-btn";
    const btnLabel = tf("UESRPG.Chat.Common.ApplyToTarget", { target: p.targetName ?? t("UESRPG.Chat.Common.Target", "Target") }, `Apply \u2192 ${p.targetName ?? "Target"}`);
    const dataAttrs = Object.entries(p)
      .filter(([k]) => k !== "buttonLabel" && k !== "targetName")
      .map(([k, v]) => `data-${_camelToKebab(k)}="${String(v ?? "").replace(/"/g, "&quot;")}"`) 
      .join(" ");
    actionSection = `<div class="dmg-action" style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;"><button type="button" class="${btnClass}" ${dataAttrs}>${btnLabel}</button>${markerHtml}</div>`;
  }

  return `
    <div class="uesrpg-damage-panel">
      ${hdrRowHtml}
      ${statusBadge}
      ${kvGrid}
      ${extraNoteHtml}
      ${actionSection}
    </div>
  `;
}

/**
 * Convert camelCase to kebab-case for data attribute names.
 * @param {string} str 
 * @returns {string}
 */
function _camelToKebab(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
