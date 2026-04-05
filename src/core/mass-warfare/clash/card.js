import { _renderTNLine } from "../../combat/opposed/cards/template-helpers.js";

function _esc(val) {
  if (val === null || val === undefined) return "-";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _rollLine(unit) {
  if (unit.testRollTotal == null) return "";
  const total = _esc(unit.testRollTotal);
  const success = unit.testIsSuccess === true;
  const degree = unit.testDegree ?? 0;
  const label = success ? `Success (${degree} DoS)` : `Failure (${degree} DoF)`;
  const color = success ? "green" : "red";
  return `<div><b>Roll:</b> ${total} - <span style="color:${color};">${_esc(label)}</span></div>`;
}

function _condLine(unit) {
  const loss = Number(unit.conditionLoss ?? 0) || 0;
  const bulkLoss = Number(unit.bulkLoss ?? 0) || 0;
  const bulkRow = bulkLoss > 0
    ? `<div><b>Bulk:</b> <span style="color:red; font-weight:700;">-${bulkLoss}</span></div>`
    : "";
  if (loss > 0) {
    const before = unit.conditionBefore ?? "?";
    const after = unit.conditionAfter ?? "?";
    return `<div><b>Resolve:</b> <span style="color:red; font-weight:700;">-${loss}</span> <span style="opacity:0.75;">(${before} -> ${after})</span></div>${bulkRow}`;
  }
  return `<div><b>Resolve:</b> <span style="color:green;">No damage</span></div>${bulkRow}`;
}

function _roleLabel(role) {
  if (role === "defend") return "Defending";
  if (role === "none") return "No Stance";
  return "Attacking";
}

function _unitHeader(name, role) {
  const icon = role === "defend" ? "DEF" : role === "none" ? "-" : "ATK";
  return `
  <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px; min-width:0;">
    <div style="font-size:12px; font-weight:700; flex-shrink:0;">${icon}</div>
    <div style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;"><b>${name}</b></div>
  </div>`;
}

function _renderPendingUnit(name, unitKey, msgId, { attackType = null } = {}) {
  const attackBadge = attackType
    ? `<div style="margin-bottom:4px; font-size:12px; color:#5a4010; font-weight:600;">${attackType === "ranged" ? "&#x2736; Ranged Attack" : "&#9876; Melee Attack"}</div>`
    : "";
  return `
  ${_unitHeader(name, null)}
  <div style="margin-top:6px; font-size:13px; line-height:1.25;">
    ${attackBadge}
    <div style="color:#888; font-style:italic; margin-bottom:6px;">Awaiting stance choice...</div>
    <button type="button"
      class="warfare-clash-btn warfare-clash-btn--commit"
      data-ues-warfare-clash-action="commit-stance"
      data-clash-unit="${_esc(unitKey)}"
      data-clash-message-id="${_esc(msgId)}">
      Choose Stance
    </button>
  </div>`;
}

function _renderCommittedUnit(unit, name) {
  const extras = [];
  if (unit.attackType && unit.attackType !== "melee") extras.push(`<div><b>Attack Type:</b> ${_esc(unit.attackType.charAt(0).toUpperCase() + unit.attackType.slice(1))}</div>`);
  if (unit.joinFray) extras.push(`<div><b>Join Fray:</b> Yes</div>`);
  if (unit.commanderJoinFray?.name) extras.push(`<div><b>Commander:</b> ${_esc(unit.commanderJoinFray.name)}</div>`);
  if (unit.modifier) extras.push(`<div><b>Modifier:</b> ${unit.modifier > 0 ? "+" : ""}${_esc(unit.modifier)}</div>`);
  if (unit.charged) extras.push(`<div><b>Charged:</b> Yes</div>`);
  if (unit.contactSide) extras.push(`<div><b>Contact Side:</b> ${_esc(unit.contactSide)}</div>`);
  if (unit.incomingChargeSide && unit.incomingChargeSide !== "none") extras.push(`<div><b>Incoming Charge:</b> ${_esc(unit.incomingChargeSide)}</div>`);
  return `
  ${_unitHeader(name, unit.role)}
  <div style="margin-top:4px; font-size:13px; line-height:1.25;">
    <div><b>Role:</b> ${_esc(_roleLabel(unit.role))}</div>
    ${extras.join("")}
    <div style="margin-top:4px; color:#3a6e3a; font-weight:600; font-size:12px;">Committed</div>
  </div>`;
}

function _renderRows(rows = []) {
  return rows.map((row) => {
    const rawValue = row?.value ?? 0;
    const numericValue = Number(rawValue);
    const isNumeric = Number.isFinite(numericValue) && String(rawValue).trim() !== "";
    const valueText = isNumeric ? `${numericValue >= 0 ? "+" : ""}${numericValue}` : _esc(rawValue);
    const note = row?.note ? ` <span style="opacity:0.7;">(${_esc(row.note)})</span>` : "";
    return `<div style="display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:start;">
      <span style="overflow-wrap:anywhere; word-break:normal; text-align:left;">${_esc(row?.label ?? "Modifier")}${note}</span>
      <span style="white-space:nowrap; text-align:right;">${valueText}</span>
    </div>`;
  }).join("");
}

function _renderDamageDetails(unit) {
  const damage = unit.damageBreakdown ?? null;
  const armor = unit.armorBreakdown ?? null;
  const mitigation = unit.mitigationBreakdown ?? null;
  if (!damage && !armor && !mitigation) return "";

  const damageRows = damage
    ? [
        ...(damage.entries ?? []),
        { label: "Rolled Total", value: Number(damage.rawTotal ?? 0) || 0 },
        ...((damage.adjustments ?? []).map((entry) => ({
          label: entry.label,
          value: entry.value,
          note: entry.note ?? "",
        }))),
        { label: "Final Outgoing Damage", value: Number(damage.total ?? 0) || 0 },
      ]
    : [];

  const armorRows = armor
    ? [
        ...(armor.entries ?? []),
        { label: "Final Armor", value: Number(armor.total ?? 0) || 0 },
      ]
    : [];

  const mitigationRows = mitigation
    ? [
        { label: "Incoming Damage", value: Number(mitigation.incomingDamage ?? 0) || 0 },
        ...((mitigation.entries ?? []).map((entry) => ({
          label: entry.label,
          value: entry.value,
          note: entry.note ?? "",
        }))),
        { label: "Net Resolve Loss", value: Number(mitigation.conditionLoss ?? 0) || 0 },
        ...(Number(unit.bulkLoss ?? 0) > 0 ? [{ label: "Bulk Lost", value: Number(unit.bulkLoss ?? 0) || 0 }] : []),
      ]
    : [];

  return `
    <details style="margin-top:4px;">
      <summary style="cursor:pointer; user-select:none; white-space:nowrap;">Damage details</summary>
      <div style="margin-top:4px; font-size:12px; opacity:0.92; display:flex; flex-direction:column; gap:6px;">
        ${damage ? `<div><b>Damage Formula:</b> <code style="font-size:11px; background:rgba(0,0,0,0.07); padding:0 3px; border-radius:2px;">${_esc(damage.rollFormula ?? unit.dmgFormula ?? "0")}</code></div>` : ""}
        ${damageRows.length ? `<div><b>Outgoing Damage</b></div><div>${_renderRows(damageRows)}</div>` : ""}
        ${armorRows.length ? `<div><b>Armor</b></div><div>${_renderRows(armorRows)}</div>` : ""}
        ${mitigationRows.length ? `<div><b>Applied Damage</b></div><div>${_renderRows(mitigationRows)}</div>` : ""}
      </div>
    </details>`;
}

function _renderResolvedUnit(unit, name) {
  const joinFrayRow = unit.joinFray
    ? `<div><b>Join Fray:</b> Yes</div>`
    : "";
  const commanderRow = unit.commanderJoinFray?.name
    ? `<div><b>Commander:</b> ${_esc(unit.commanderJoinFray.name)}</div>`
    : "";
  const holdRow = unit.holdApplied
    ? `<div><b>Hold:</b> Active <span style="opacity:0.75; font-size:12px;">(enemy TN -20)</span></div>`
    : "";
  const chargeRow = unit.charged ? `<div><b>Charged:</b> Yes</div>` : "";
  const contactRow = unit.contactSide ? `<div><b>Contact Side:</b> ${_esc(unit.contactSide)}</div>` : "";
  const incomingRow = unit.incomingChargeSide && unit.incomingChargeSide !== "none"
    ? `<div><b>Incoming Charge:</b> ${_esc(unit.incomingChargeSide)}</div>`
    : "";
  const breakRow = unit.breakTest
    ? `<div><b>Break Test:</b> TN ${_esc(unit.breakTest.tn)}; roll ${_esc(unit.breakTest.result?.rollTotal ?? "?")} - ${unit.breakTest.broken ? "<span style='color:red;'>Broken</span>" : "<span style='color:green;'>Held</span>"}</div>`
    : "";

  if (unit.role === "none") {
    return `
  ${_unitHeader(name, unit.role)}
  <div style="margin-top:4px; font-size:13px; line-height:1.25;">
    <div><b>Role:</b> ${_esc(_roleLabel(unit.role))}</div>
    ${joinFrayRow}
    ${commanderRow}
    <div><b>Test:</b> <span style="opacity:0.6;">- (skipped)</span></div>
    <div><b>Damage:</b> <span style="opacity:0.6;">- (none dealt)</span></div>
    <div><b>Armor:</b> ${_esc(unit.ar)} <span style="opacity:0.6; font-size:12px;">(base only)</span></div>
    ${_condLine(unit)}
    ${_renderDamageDetails(unit)}
  </div>`;
  }

  return `
  ${_unitHeader(name, unit.role)}
  <div style="margin-top:4px; font-size:13px; line-height:1.25;">
    <div><b>Role:</b> ${_esc(_roleLabel(unit.role))}</div>
    ${joinFrayRow}
    ${commanderRow}
    ${chargeRow}
    ${contactRow}
    ${incomingRow}
    ${holdRow}
    ${_renderTNLine({
      value: String(unit.tn ?? "??"),
      tnObj: { breakdown: Array.isArray(unit.tnBreakdown) ? unit.tnBreakdown : [] },
    })}
    ${_rollLine(unit)}
    <div><b>Damage:</b> <code style="font-size:11px; background:rgba(0,0,0,0.07); padding:0 3px; border-radius:2px;">${_esc(unit.dmgFormula)}</code> = <strong>${_esc(unit.dmgTotal)}</strong></div>
    <div><b>Armor:</b> ${_esc(unit.ar)}</div>
    ${_condLine(unit)}
    ${breakRow}
    ${_renderDamageDetails(unit)}
  </div>`;
}

function _renderUnitSection(unit, phase, unitKey, msgId) {
  const name = _esc(unit?.actorName ?? "Unknown");
  const committed = unit?.banked?.committed ?? false;

  if (phase === "resolved") return _renderResolvedUnit(unit, name);
  if (committed) return _renderCommittedUnit(unit, name);
  // Show attack type badge only on the initiating side (unit1) while pending
  const attackType = unitKey === "unit1" ? (unit?.attackType ?? null) : null;
  return _renderPendingUnit(name, unitKey, msgId, { attackType });
}

export function renderClashCard(data, msgId) {
  const phase = data?.phase ?? "pending";
  const unit1Html = _renderUnitSection(data.unit1, phase, "unit1", msgId);
  const unit2Html = _renderUnitSection(data.unit2, phase, "unit2", msgId);
  const groupRow = data?.clashGroupId
    ? `<div style="margin:0 0 8px 0; font-size:12px; opacity:0.85;"><b>Clash Group:</b> ${_esc(data.clashGroupId)}${Array.isArray(data?.groupMembers) && data.groupMembers.length ? ` <span style="opacity:0.8;">(${_esc(data.groupMembers.join(", "))})</span>` : ""}</div>`
    : "";

  return `
<div class="ues-opposed-card" data-message-id="${_esc(msgId)}" style="max-width:100%; box-sizing:border-box; padding:6px 6px 0;">
  ${groupRow}
  <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; align-items:start; max-width:100%; overflow:hidden;">
    <div style="padding-right:10px; border-right:1px solid rgba(0,0,0,0.12); min-width:0; overflow:hidden;">
      ${unit1Html}
    </div>
    <div style="padding-left:2px; min-width:0; overflow:hidden;">
      ${unit2Html}
    </div>
  </div>
</div>`;
}
