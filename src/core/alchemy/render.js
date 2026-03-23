/**
 * Alchemy Rendering Helpers
 *
 * Pure HTML-building functions for all alchemy chat cards.
 */

function _esc(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function _section(title, bodyHtml, extraClass = "") {
  if (!String(bodyHtml ?? "").trim()) return "";
  const titleHtml = title ? `<div class="uesrpg-alchemy-section__title">${title}</div>` : "";
  const className = ["uesrpg-alchemy-section", extraClass].filter(Boolean).join(" ");
  return `
    <section class="${className}">
      ${titleHtml}
      <div class="uesrpg-alchemy-section__body">
        ${bodyHtml}
      </div>
    </section>
  `;
}

function _summaryRow(label, value, extraClass = "") {
  return `
    <div class="uesrpg-da-row ${extraClass}">
      <span class="k">${label}</span>
      <span class="v">${value}</span>
    </div>
  `;
}

export function renderBrewPendingCard(data) {
  const {
    actorImg = "icons/svg/mystery-man.svg",
    actorName = "",
    modeLabel = "",
    skillName = "Alchemy",
    tn = 0,
    alchemyRank = 0,
    effectsHtml = "",
    poisonHtml = "",
    penaltyRowsHtml = "",
    warningRowsHtml = "",
    adjustedTN = 0,
    nothingVentured = false,
    trialBonus = 0,
    brewTime = 0,
    actorUuid = "",
  } = data;

  const summaryHtml = [
    _summaryRow("Alchemy Skill", `${skillName} (TN ${tn})`),
    _summaryRow("Alchemy Rank", `${alchemyRank}`),
    _summaryRow("Adjusted TN", `<strong>${adjustedTN}</strong>`, "is-strong"),
    _summaryRow("Brew Time", `${brewTime} hour${brewTime !== 1 ? "s" : ""}`),
  ].join("");

  const specialNotes = [
    nothingVentured
      ? '<div class="uesrpg-alchemy-note is-warning"><div class="label">Nothing Ventured</div><div class="text">Doubles or failure causes a backfire check.</div></div>'
      : "",
    trialBonus > 0
      ? `<div class="uesrpg-alchemy-note"><div class="label">Trial and Error</div><div class="text">+${trialBonus} TN from repeated recipe practice.</div></div>`
      : "",
    warningRowsHtml,
  ].join("");

  return `
    <div class="uesrpg-alchemy-brew-card">
      <div class="hdr">
        <img class="actor-thumb" src="${actorImg}" alt="">
        <div class="hdr-text">
          <div class="title">${actorName}</div>
          <div class="sub">${modeLabel}</div>
        </div>
      </div>
      <div class="body">
        ${_section("Summary", summaryHtml, "is-summary")}
        ${_section("Selected Effects", effectsHtml || poisonHtml, "is-effects")}
        ${_section("Modifiers", penaltyRowsHtml, "is-modifiers")}
        ${_section("Notes", specialNotes, "is-notes")}
      </div>
      <div class="footer uesrpg-alchemy-actions">
        <button
          type="button"
          data-action="alchemyRoll"
          data-actor-uuid="${actorUuid}">
          Roll Alchemy (TN ${adjustedTN})
        </button>
      </div>
    </div>
  `;
}

export async function renderBrewResultCard(data) {
  const {
    actorImg = "icons/svg/mystery-man.svg",
    actorName = "",
    outcomeLabel = "",
    outcomeColor = "#388e3c",
    rollTotal = 0,
    adjustedTN = 0,
    roll,
    itemHtml = "",
    backfireHtml = "",
    drinkButtonHtml = "",
  } = data;

  const renderedRoll = roll ? await roll.render() : "";

  return `
    <div class="uesrpg-alchemy-brew-card">
      <div class="hdr">
        <img class="actor-thumb" src="${actorImg}" alt="">
        <div class="hdr-text">
          <div class="title">${actorName} - Brew Result</div>
          <div class="sub" style="color:${outcomeColor};font-weight:bold;">${outcomeLabel} (${rollTotal} vs TN ${adjustedTN})</div>
        </div>
      </div>
      <div class="body">
        ${renderedRoll}
        ${_section("Outcome", itemHtml, "is-result")}
        ${_section("Backfire", backfireHtml, "is-backfire")}
      </div>
      ${drinkButtonHtml ? `<div class="footer uesrpg-alchemy-actions">${drinkButtonHtml}</div>` : ""}
    </div>
  `;
}

export function renderApplyToWeaponCard(data) {
  const {
    actorImg = "icons/svg/mystery-man.svg",
    actorName = "",
    weaponName = "",
    kind = "poison",
    poisonLevel = 1,
    damageFormula = "1d4",
    effects = [],
    maxHits = 1,
    backfired = false,
    getEffectLabel = (k) => k,
  } = data;

  let detailRows = "";
  if (kind === "poison") {
    detailRows = _summaryRow("Poison Level", `${poisonLevel} (${damageFormula})`);
  } else {
    detailRows = effects.map(
      (effect) => `
        <div class="uesrpg-alchemy-note">
          <div class="label">${effect.effectLabel ?? effect.spellName ?? getEffectLabel(effect.effectKey)}</div>
          <div class="text">SL ${effect.spellLevel ?? 1}</div>
        </div>
      `
    ).join("");
  }

  const backfiredRow = backfired
    ? '<div class="uesrpg-alchemy-note is-danger"><div class="label">Backfired</div><div class="text">Effects may be unpredictable.</div></div>'
    : "";

  return `
    <div class="uesrpg-alchemy-brew-card">
      <div class="hdr">
        <img class="actor-thumb" src="${actorImg}" alt="">
        <div class="hdr-text">
          <div class="title">${actorName}</div>
          <div class="sub">Applied ${kind === "poison" ? "Poison" : "Toxin"} to ${weaponName}</div>
        </div>
      </div>
      <div class="body">
        ${_section("Weapon", _summaryRow("Target", weaponName) + _summaryRow("Hits", `${maxHits} remaining`), "is-summary")}
        ${_section(kind === "poison" ? "Poison" : "Effects", detailRows, "is-effects")}
        ${backfiredRow ? _section("Warning", backfiredRow, "is-backfire") : ""}
      </div>
    </div>
  `;
}

export function renderAlchemyUseCard(data) {
  const {
    actorImg = "icons/svg/mystery-man.svg",
    actorName = "",
    title = "",
    bodyHtml = "",
  } = data;

  return `
    <div class="uesrpg-alchemy-brew-card">
      <div class="hdr">
        <img class="actor-thumb" src="${actorImg}" alt="">
        <div class="hdr-text">
          <div class="title">${actorName}</div>
          <div class="sub">${title}</div>
        </div>
      </div>
      <div class="body">
        ${_section("", bodyHtml, "is-effects")}
      </div>
    </div>
  `;
}

export function renderPoisonResistanceCard(data = {}) {
  const {
    actorName = "Target",
    actorUuid = "",
    weaponName = "Weapon",
    poisonLevel = 1,
    damageFormula = "1d4",
    endTN = 0,
    finalTN = null,
    rollTotal = null,
    passed = null,
    damageApplied = null,
    resolving = false,
    resolved = false,
    statusNote = "",
  } = data;

  const safeActorName = _esc(actorName);
  const safeActorUuid = _esc(actorUuid);
  const safeWeaponName = _esc(weaponName);
  const safeFormula = _esc(damageFormula);
  const safeStatusNote = _esc(statusNote);
  const showFinalTn = finalTN !== null && finalTN !== undefined;
  const showRoll = rollTotal !== null && rollTotal !== undefined;
  const showDamage = damageApplied !== null && damageApplied !== undefined;
  const resultLabel = passed === null ? "" : (passed ? "Resisted" : "Failed");

  const pendingRows = `
    <div style="display:grid; grid-template-columns:auto 1fr; gap:6px 10px; align-items:start;">
      <div><strong>Target:</strong></div><div>${safeActorName}</div>
      <div><strong>Weapon:</strong></div><div>${safeWeaponName}</div>
      <div><strong>Poison:</strong></div><div>Level ${Number(poisonLevel) || 1} (${safeFormula})</div>
      <div><strong>END TN:</strong></div><div>${Number(endTN) || 0}</div>
      ${resolving ? `<div><strong>Status:</strong></div><div>Resolving...</div>` : ``}
    </div>
  `;

  const resolvedRows = `
    <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px 12px; align-items:start;">
      <div><strong>Target:</strong> ${safeActorName}</div>
      <div><strong>Weapon:</strong> ${safeWeaponName}</div>
      <div><strong>Poison:</strong> Level ${Number(poisonLevel) || 1}</div>
      <div><strong>Formula:</strong> ${safeFormula}</div>
      ${showFinalTn ? `<div><strong>TN:</strong> ${Number(finalTN) || 0}</div>` : ``}
      ${showRoll ? `<div><strong>Roll:</strong> ${Number(rollTotal) || 0}</div>` : ``}
      ${passed !== null ? `<div><strong>Result:</strong> ${resultLabel}</div>` : ``}
      ${showDamage ? `<div><strong>Damage:</strong> ${Number(damageApplied) || 0}</div>` : ``}
      ${safeStatusNote ? `<div style="grid-column:1 / -1; display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 10px; align-items:start;"><strong>Outcome:</strong><span style="overflow-wrap:anywhere;">${safeStatusNote}</span></div>` : ``}
    </div>
  `;

  return `
    <div class="uesrpg-chat-card" data-card="alchemy-poison-resistance">
      <header class="card-header">
        <h3>${resolved ? "Poison Resistance Result" : "Poison Resistance Test"}</h3>
      </header>
      <div class="card-content">
        ${resolved ? resolvedRows : pendingRows}
      </div>
      ${resolved ? "" : `<footer class="card-footer">
        <button
          type="button"
          data-ues-alchemy-poison-action="roll"
          data-actor-uuid="${safeActorUuid}"
          ${resolving ? "disabled" : ""}>${resolving ? "Resolving..." : "Roll Poison Resistance (END)"}</button>
      </footer>`}
    </div>
  `;
}

export function renderToxinResistanceCard(data = {}) {
  const {
    actorName = "Target",
    actorUuid = "",
    weaponName = "Weapon",
    endTN = 0,
    effectsHtml = "",
    directNotesHtml = "",
    finalTN = null,
    rollTotal = null,
    passed = null,
    resolving = false,
    resolved = false,
    statusNote = "",
  } = data;

  const safeActorName = _esc(actorName);
  const safeActorUuid = _esc(actorUuid);
  const safeWeaponName = _esc(weaponName);
  const safeStatusNote = _esc(statusNote);
  const showFinalTn = finalTN !== null && finalTN !== undefined;
  const showRoll = rollTotal !== null && rollTotal !== undefined;
  const resultLabel = passed === null ? "" : (passed ? "Resisted" : "Failed");

  const pendingRows = `
    <div style="display:grid; grid-template-columns:auto 1fr; gap:6px 10px; align-items:start;">
      <div><strong>Target:</strong></div><div>${safeActorName}</div>
      <div><strong>Weapon:</strong></div><div>${safeWeaponName}</div>
      <div><strong>END TN:</strong></div><div>${Number(endTN) || 0}</div>
      ${resolving ? `<div><strong>Status:</strong></div><div>Resolving...</div>` : ``}
    </div>
    ${effectsHtml ? `<div style="margin-top:10px;"><strong>Toxin Effects</strong><div>${effectsHtml}</div></div>` : ``}
    ${directNotesHtml ? `<div style="margin-top:10px;"><strong>Direct Effects Applied</strong><div>${directNotesHtml}</div></div>` : ``}
  `;

  const resolvedRows = `
    <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px 12px; align-items:start;">
      <div><strong>Target:</strong> ${safeActorName}</div>
      <div><strong>Weapon:</strong> ${safeWeaponName}</div>
      ${showFinalTn ? `<div><strong>TN:</strong> ${Number(finalTN) || 0}</div>` : ``}
      ${showRoll ? `<div><strong>Roll:</strong> ${Number(rollTotal) || 0}</div>` : ``}
      ${passed !== null ? `<div><strong>Result:</strong> ${resultLabel}</div>` : ``}
    </div>
    ${effectsHtml ? `<div style="margin-top:10px;"><strong>Toxin Effects</strong><div>${effectsHtml}</div></div>` : ``}
    ${directNotesHtml ? `<div style="margin-top:10px;"><strong>Direct Effects Applied</strong><div>${directNotesHtml}</div></div>` : ``}
    ${safeStatusNote ? `<div style="margin-top:10px;"><strong>Outcome</strong><div style="overflow-wrap:anywhere;">${safeStatusNote}</div></div>` : ``}
  `;

  return `
    <div class="uesrpg-chat-card" data-card="alchemy-toxin-resistance">
      <header class="card-header">
        <h3>${resolved ? "Toxin Resistance Result" : "Toxin Resistance Test"}</h3>
      </header>
      <div class="card-content">
        ${resolved ? resolvedRows : pendingRows}
      </div>
      ${resolved ? "" : `<footer class="card-footer">
        <button
          type="button"
          data-ues-alchemy-toxin-action="roll"
          data-actor-uuid="${safeActorUuid}"
          ${resolving ? "disabled" : ""}>${resolving ? "Resolving..." : "Roll Toxin Resistance (END)"}</button>
      </footer>`}
    </div>
  `;
}
