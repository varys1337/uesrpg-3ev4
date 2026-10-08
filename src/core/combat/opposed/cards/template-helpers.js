import { escapeHtml as _escapeHtml } from '../../../../utils/html.js';
/**
 * src/core/combat/opposed/cards/template-helpers.js
 * Pure template helper functions for opposed combat card rendering.
 * Extracted from opposed-workflow.js for maintainability.
 */

import { renderOpposedOutcome, renderResultSummary, renderRollSummary, renderTargetNumberLine, renderCommitWaitingStatus } from "../../../opposed/shared/card-rendering.js";
import { maybeT, t, tf } from "../../../../utils/i18n.js";
import { localizeHitLocation } from "../../combat-utils.js";
import { systemTooltipAttributes } from "../../../../ui/shared/system-tooltips.js";

/**
 * Format degree of success/failure for display.
 * 
 * @param {Object} res - Test result object with `isSuccess` and `degree` properties.
 * @returns {string} - Formatted string like "3 DoS" or "2 DoF".
 */
export function _fmtDegree(res) {
  if (!res) return "-";
  return renderResultSummary(res);
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

function _actionButtonLabel(label, meta = "") {
  if (!meta) return label;
  return `<span class="uesrpg-chat-action-label"><span>${label}</span><small>${meta}</small></span>`;
}

/**
 * Extract roll total from various result object structures.
 * 
 * @param {Object} res - Roll result object.
 * @returns {number|null} - Roll total or null if not found.
 */
export function _extractRollTotal(res) {
  const n = Number(res?.rollTotal ?? res?.total ?? res?.roll?.total ?? res?.roll?.result ?? NaN);
  return Number.isFinite(n) ? n : null;
}

function _buildBreakdownRows(tnObj) {
  return (tnObj?.breakdown ?? []).map((b) => {
    const v = Number(b.value ?? 0);
    const sign = v >= 0 ? "+" : "";
    const label = String(b.label ?? "Modifier");
    return `<div class="uesrpg-chat-kv-row"><span>${label}</span><span>${sign}${v}</span></div>`;
  }).join("");
}



function _localizeDamageType(value) {
  const key = String(value ?? "").trim();
  if (!key) return "";
  const normalized = key.toLowerCase();
  return t(`UESRPG.Labels.DAMAGE_TYPE.${normalized}`, maybeT(key, key));
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
      <details class="uesrpg-chat-details uesrpg-chat-details--inline">
        <summary ${systemTooltipAttributes({ text: t("UESRPG.Chat.Common.TnBreakdown", "TN breakdown"), ariaLabel: t("UESRPG.Chat.Common.TnBreakdown", "TN breakdown") })}></summary>
        <div class="uesrpg-chat-details__body">${rows}</div>
      </details>
    `;
  }
  return `
    <details class="uesrpg-chat-details">
      <summary>${t("UESRPG.Chat.Common.TnBreakdown", "TN breakdown")}</summary>
      <div class="uesrpg-chat-details__body">${rows}</div>
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
  return renderTargetNumberLine(value, _buildBreakdownRows(tnObj));
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
    return renderRollSummary(100, stub);
  }
  if (!result) return "";
  const total = _extractRollTotal(result);
  const totalText = (total == null) ? "??" : String(total);
  const notes = Array.isArray(result?.talentNotes) ? result.talentNotes.filter(Boolean) : [];
  const notesHtml = notes.length
    ? `<div class="uesrpg-opposed-notes">${notes.map(n => `<div>${n}</div>`).join("")}</div>`
    : "";
  return renderRollSummary(totalText, result) + notesHtml;
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
  return `<div class="uesrpg-chat-status-line"><b>${t("UESRPG.Chat.Common.Status", "Status")}:</b> ${statusText}</div>`;
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
  return `<div class="uesrpg-chat-status-line"><b>${t("UESRPG.Chat.Common.Status", "Status")}:</b> ${statusText}</div>`;
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
      return `<div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single">${_btn(t("UESRPG.Chat.Opposed.FollowUpStrike1SP", "Follow-up Strike (1 SP)"), "followup-strike", { "defender-index": 0 })}</div>`;
    }
    return "";
  }
  if (bankMode) {
    if (isAutoRolling) return "";
    if (!aCommitted) {
      if (commitGate?.allowed === false) {
        return "";
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
      if (commitDefenseGate?.insufficientAP) return "";
      if (commitDefenseGate?.allowed === false) {
        return `
        <div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single">
          ${_btn(t("UESRPG.Chat.Opposed.NoDefense", "No Defense"), "defender-commit-nodefense", { "defender-index": idx })}
        </div>`;
      }
      return `
        <div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--pair uesrpg-opposed-action-row--compact-choice">
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
    <div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--pair uesrpg-opposed-action-row--compact-choice">
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
    return renderOpposedOutcome(outcome.text);
  }

  if (bankMode) {
    if (!bothCommitted || (isMulti && (!aCommitted || !allDefendersCommitted))) {
      return renderCommitWaitingStatus({
        attackerCommitted: aCommitted,
        defendersCommitted: isMulti ? allDefendersCommitted : Boolean(data?.defender?.banked?.committed || data?.defender?.noDefense || data?.defender?.result)
      });
    }

    return `<div class="uesrpg-chat-status-note"><i>${t("UESRPG.Chat.Opposed.RollingEllipsis", "Rolling...")}</i></div>`;
  }

  // Legacy/non-banked pending hint
  const phase = String(data?.context?.phase ?? "pending");
  const waitingSince = Number(data?.context?.waitingSince ?? 0);
  const ageMs = waitingSince ? (Date.now() - waitingSince) : 0;
  const isWaiting = (phase === "waitingdefender" || phase === "waitingDefender");
  const isStale = isWaiting && ageMs > 60000;
  const note = isStale
    ? `<div class="uesrpg-chat-status-note">
         ${t("UESRPG.Chat.Opposed.StillWaitingDefenderResult", "Still waiting on the defender result. If this persists, ensure the defender roll message was posted, and have the attacker refresh the page to re-render the card.")}
       </div>`
    : "";
  return `<div class="uesrpg-chat-status-note"><i>${t("UESRPG.Chat.Status.Pending", "Pending")}</i></div>${note}`;
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
    lines.push(`<div><b>${t("UESRPG.Chat.Opposed.DuelingWeapon", "Dueling Weapon")}:</b> +${Number(defender.result.duelingBonus)} DoS</div>`);
  }

  return `
    <details class="uesrpg-chat-details uesrpg-chat-resolution-details">
      <summary>${t("UESRPG.Chat.Opposed.ResolutionDetails", "Resolution details")}</summary>
      <div class="uesrpg-chat-details__body">
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
    const label = _actionButtonLabel(
      t("UESRPG.Chat.Opposed.RollDamage", "Roll Damage"),
      advA > 0 ? `${t("UESRPG.Chat.Common.Advantage", "Advantage")}: ${advA}` : "",
    );
    return `
      <div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single">
        ${_btn(label, "damage-roll", { "defender-index": idx })}
      </div>
    `;
  }

  if (outcome.winner === "defender" && (defender.defenseType ?? "none") === "counter") {
    const label = _actionButtonLabel(
      t("UESRPG.Chat.Opposed.RollDamage", "Roll Damage"),
      advD > 0 ? `${t("UESRPG.Chat.Common.Advantage", "Advantage")}: ${advD}` : "",
    );
    return `
      <div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single">
        ${_btn(label, "counter-damage-roll", { "defender-index": idx })}
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
      <div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single uesrpg-opposed-action-row--with-meta">
        ${_btn(blockLabel, "block-resolve", { "defender-index": idx, "ues-gm-only": "true" })}
        ${advD > 0 ? `<span class="uesrpg-chat-action-meta">${t("UESRPG.Chat.Common.Advantage", "Advantage")}: ${advD}</span>` : ``}
      </div>
    `;
  }

  if (outcome.winner === "defender" && isWardDefense) {
    const wardLabel = isAoE ? t("UESRPG.Chat.Opposed.ResolveWardHalfDamage", "Resolve Ward (Half Damage)") : t("UESRPG.Chat.Opposed.ResolveWard", "Resolve Ward");
    return `
      <div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single uesrpg-opposed-action-row--with-meta">
        ${_btn(wardLabel, "ward-resolve", { "defender-index": idx })}
        ${advD > 0 ? `<span class="uesrpg-chat-action-meta">${t("UESRPG.Chat.Common.Advantage", "Advantage")}: ${advD}</span>` : ``}
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
      <div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single uesrpg-opposed-action-row--with-meta">
        ${_btn(t("UESRPG.Chat.Opposed.ResolveAdvantage", "Resolve Advantage"), "defender-advantage", { "defender-index": idx })}
        <span class="uesrpg-chat-action-meta">${t("UESRPG.Chat.Common.Advantage", "Advantage")}: ${advD}</span>
      </div>
    `;
  }

  return "";
}

/** Render public spell calculations from saved outcome data, never from an Item. */
function _buildSpellPanelDetails(damageData, metadataHtml, componentsHtml, total, damageLabel) {
  const payload = damageData._magicPayload ?? {};
  const context = payload.castContext ?? {};
  const rows = [];
  const addRow = (label, value) => {
    if (value == null || String(value).trim() === "") return;
    rows.push(`<div class="uesrpg-chat-kv-row"><span>${_escapeHtml(label)}</span><span>${_escapeHtml(String(value))}</span></div>`);
  };
  const rollTotals = (rolls) => (Array.isArray(rolls) ? rolls : [])
    .map((roll) => roll?.total)
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .join(" / ");
  addRow(t("UESRPG.Chat.DamagePanel.StrengthFormula", "Spell Strength formula"), context.spellStrengthFormula);
  addRow(t("UESRPG.Chat.DamagePanel.StrengthRolls", "Spell Strength rolls"), rollTotals(context.spellStrengthRolls));
  if (payload.isOvercharged) {
    const totals = (Array.isArray(payload.overchargeTotals) ? payload.overchargeTotals : [])
      .filter((value) => value != null && Number.isFinite(Number(value))).join(" / ");
    addRow(t("UESRPG.Chat.DamagePanel.OverchargeRolls", "Overcharge rolls"), totals);
    addRow(t("UESRPG.Chat.DamagePanel.SelectedStrengthRolls", "Selected strength rolls"), rollTotals(context.spellStrengthSelectedRolls));
  }
  if (payload.overloadBonus) addRow(t("UESRPG.Chat.DamagePanel.OverloadBonus", "Overload bonus"), payload.overloadBonus);
  if (payload.elementalBonus) addRow(payload.elementalBonusLabel || t("UESRPG.Chat.DamagePanel.ElementalBonus", "Elemental bonus"), payload.elementalBonus);
  const block = damageData.blockResult;
  const ward = damageData.wardResult;
  if (block) {
    addRow(t("UESRPG.Chat.DamagePanel.BlockRating", "Block rating"), block.blockRating);
    if (block.isAoE) addRow(t("UESRPG.Chat.DamagePanel.AfterBlock", "After block"), block.reducedDamage);
  }
  if (ward) {
    addRow(t("UESRPG.Chat.DamagePanel.WardRating", "Ward rating"), ward.wardBR);
    if (ward.isAoE) addRow(t("UESRPG.Chat.DamagePanel.AfterWard", "After ward"), ward.reducedDamage);
  }
  if (total !== null && (damageData.mode === "healing" || payload.isDamaging !== false)) {
    addRow(tf("UESRPG.Chat.DamagePanel.ResultTotal", { label: damageLabel }, `${damageLabel} total`), total);
  }
  // This is the existing persisted Roll.render() output, not newly evaluated dice.
  const rollHtml = String(payload.rollHTML ?? damageData.damageString ?? "").trim();
  const content = metadataHtml + rows.join("") + componentsHtml
    + (rollHtml ? `<div class="dmg-roll-html">${rollHtml}</div>` : "");
  return content ? `<div class="dmg-public-details">${content}</div>` : "";
}

/**
 * Build inline damage panel for the opposed card.
 * Renders damage results, hit location, quality pills, and Apply button
 * inline within the opposed card instead of a separate chat message.
 *
 * @param {Object|null} damageData - Damage state from flags.
 * @returns {string} - HTML string for the damage panel, or empty string.
 */
export function _buildDamagePanel(damageData, { showHeader = true, showHitLocation = true } = {}) {
  if (!damageData || damageData.rolled !== true) return "";

  const mode = String(damageData.mode ?? "weapon");
  const isHealing = mode === "healing";
  const p = damageData.applyPayload ?? {};
  const isMagic = Boolean(damageData._magicPayload) || String(p.magic ?? "") === "1" || mode === "magic" || isHealing;
  const rawTotal = damageData.finalDamage ?? damageData._magicPayload?.damage ?? p.damage;
  const total = rawTotal != null && rawTotal !== "" && Number.isFinite(Number(rawTotal)) ? Number(rawTotal) : null;
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
      const suffix = br.shieldSplitter ? ", SS" : "";
      statusBadge = `<span class="dmg-status dmg-status--blocked">\u{1F6E1} ${tf("UESRPG.Chat.DamagePanel.Blocked", { br: br.blockRating, suffix }, `Blocked (BR ${br.blockRating}${suffix})`)}</span>`;
    } else if (br.isAoE) {
      statusBadge = `<span class="dmg-status dmg-status--aoe">\u{1F6E1} ${tf("UESRPG.Chat.DamagePanel.AoeBlocked", { damage: br.reducedDamage ?? damageData.finalDamage }, `AoE Blocked \u2192 ${br.reducedDamage ?? damageData.finalDamage} dmg`)}</span>`;
    } else {
      statusBadge = `<span class="dmg-status dmg-status--penetrated">\u26A0 ${tf("UESRPG.Chat.DamagePanel.BlockPenetrated", { damage: damageData.finalDamage, br: br.blockRating }, `Block Penetrated (${damageData.finalDamage} > BR ${br.blockRating})`)}</span>`;
    }
  }
  if (mode === "ward" && damageData.wardResult) {
    const wr = damageData.wardResult;
    if (wr.blocked) {
      statusBadge = `<span class="dmg-status dmg-status--blocked">\u{1F6E1} ${tf("UESRPG.Chat.DamagePanel.Warded", { br: wr.wardBR }, `Warded (BR ${wr.wardBR})`)}</span>`;
    } else if (wr.isAoE) {
      statusBadge = `<span class="dmg-status dmg-status--aoe">\u{1F6E1} ${tf("UESRPG.Chat.DamagePanel.AoeWarded", { damage: wr.reducedDamage ?? damageData.finalDamage }, `AoE Warded \u2192 ${wr.reducedDamage ?? damageData.finalDamage} dmg`)}</span>`;
    } else {
      statusBadge = `<span class="dmg-status dmg-status--penetrated">\u26A0 ${tf("UESRPG.Chat.DamagePanel.WardPenetrated", { damage: damageData.finalDamage, br: wr.wardBR }, `Ward Penetrated (${damageData.finalDamage} > BR ${wr.wardBR})`)}</span>`;
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
  const fallbackType = _localizeDamageType(damageData._magicPayload?.damageType ?? p.damageType ?? "");
  const componentsHtml = damageComponents.length
    ? `<div class="dmg-components">${damageComponents.map((c) => {
      const rawLabel = c?.displayLabel ?? c?.sourceLabel ?? c?.source;
      const label = maybeT(rawLabel, rawLabel) || t("UESRPG.Chat.DamagePanel.Source", "Source");
      const amount = Number(c?.amount ?? 0) || 0;
      const dtype = String(c?.damageType ?? "").trim();
      const dtypeLabel = dtype ? _localizeDamageType(dtype) : "";
      const repeatedSource = damageComponents.length === 1 && label === maybeT(headerLabel, headerLabel);
      return `<div class="dmg-component-line"><span class="dmg-component-source">${repeatedSource ? `<b>${damageLabel}:</b>` : _escapeHtml(label)}</span><span class="dmg-component-value"><b>${amount}</b>${dtypeLabel ? ` <span class="type-tag">${_escapeHtml(dtypeLabel)}</span>` : ""}</span></div>`;
    }).join("")}</div>`
    : (isMagic && total !== null && (isHealing || damageData._magicPayload?.isDamaging !== false))
      ? `<div class="dmg-components"><div class="dmg-component-line"><span class="dmg-component-source"><b>${damageLabel}:</b></span><span class="dmg-component-value"><b>${total}</b>${fallbackType && !isHealing ? ` <span class="type-tag">${_escapeHtml(fallbackType)}</span>` : ""}</span></div></div>`
      : "";

  // ── Combined header row: icon + name + hit location on one line ──
  const hitLocationDisplay = localizeHitLocation(damageData.hitLocation, t("UESRPG.Sheets.Item.HitLocation.Body", "Body"));
  const hdrRowHtml = !showHeader ? "" : fullyBlocked
    ? `<div class="dmg-hdr">${headerImg}</div>`
    : `<div class="dmg-hdr ${headerImg ? "has-icon" : ""}">${headerImg}<div class="dmg-title">${headerLabel}</div></div>`;
  const pillsHtml = pills ? `<div class="val-pills">${pills}</div>` : "";
  const metadataHtml = metadataRows.length
    ? `<div class="dmg-meta">${metadataRows.map((row) => {
      const label = maybeT(row.label, row.label || t("UESRPG.Chat.DamagePanel.Info", "Info"));
      return `<div><b>${_escapeHtml(label)}:</b> ${_escapeHtml(maybeT(row.value, row.value ?? ""))}</div>`;
    }).join("")}</div>`
    : "";
  const damageDisplayHtml = fullyBlocked ? "" : `
    <div class="dmg-kv">
      ${isMagic ? "" : metadataHtml}
      ${pillsHtml}
      <div class="dmg-summary">${componentsHtml}${showHitLocation ? `<div class="dmg-hitloc"><b>${t("UESRPG.Chat.DamagePanel.HitLocationShort", "Hit Loc.")}</b> ${hitLocationDisplay}</div>` : ""}</div>
    </div>`;

  const gmDetailsAnchor = (gmReportKey || p.targetUuid)
    ? `<div class="dmg-gm-breakdown-anchor" data-ues-gm-damage-report-key="${gmReportKey}" data-ues-gm-damage-target="${String(p.targetUuid ?? "").trim()}"></div>`
    : "";

  const publicDetails = isMagic ? _buildSpellPanelDetails(damageData, metadataHtml, damageComponents.length ? componentsHtml : "", total, damageLabel) : "";
  const damageDetailsHtml = (publicDetails || (!fullyBlocked && gmDetailsAnchor)) ? `
    <details class="dmg-details">
      <summary class="dmg-details-summary">${isMagic ? t("UESRPG.Chat.DamagePanel.Detail", "Detail") : t("UESRPG.UI.Details", "Details")}</summary>
      <div class="dmg-details-content">
        ${publicDetails}
        ${fullyBlocked ? "" : gmDetailsAnchor}
      </div>
    </details>` : "";
  const kvGrid = damageDisplayHtml + damageDetailsHtml;


  // ── Extra note ──
  const extraNoteHtml = damageData.extraNoteHtml
    ? `<div class="dmg-note">${damageData.extraNoteHtml}</div>`
    : "";

  // ── Action: apply button or applied state ──
  let actionSection = "";
  const applicationStatus = String(damageData.applicationStatus ?? "");
  if (fullyBlocked) {
    actionSection = "";
  } else if (applicationStatus === "partial") {
    actionSection = `<div class="dmg-action" role="status">${t("UESRPG.Chat.Common.ApplicationPartial", "Partially applied — review remaining effects before retrying.")}</div>`;
  } else if (damageData.applied) {
    actionSection = `<div class="dmg-action"><span class="damage-applied-label"><i class="fa-solid fa-check" aria-hidden="true"></i> ${tf("UESRPG.Chat.Common.Applied", { label: damageLabel }, `${damageLabel} Applied`)}</span></div>`;
  } else {
    const btnClass = isHealing ? "apply-healing-btn" : "apply-damage-btn";
    const btnLabel = tf("UESRPG.Chat.Common.ApplyToTarget", { target: p.targetName ?? t("UESRPG.Chat.Common.Target", "Target") }, `Apply \u2192 ${p.targetName ?? "Target"}`);
    const dataAttrs = Object.entries(p)
      .filter(([k]) => k !== "buttonLabel" && k !== "targetName")
      .map(([k, v]) => `data-${_camelToKebab(k)}="${_escapeHtml(v)}"`)
      .join(" ");
    actionSection = `<div class="dmg-action"><button type="button" class="${btnClass}" ${dataAttrs}>${btnLabel}</button></div>`;
    if (applicationStatus === "failed") {
      actionSection += `<div role="status">${t("UESRPG.Chat.Common.ApplicationFailed", "Application failed. Review the target before retrying.")}</div>`;
    }
  }

  return `
    <div class="uesrpg-damage-panel" data-ues-outcome-target="${_escapeHtml(p.targetUuid ?? "")}" data-ues-outcome-id="${_escapeHtml(damageData.application?.id ?? "")}">
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
