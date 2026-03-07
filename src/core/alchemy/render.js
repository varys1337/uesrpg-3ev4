/**
 * Alchemy Rendering Helpers
 *
 * Pure HTML-building functions for all alchemy chat cards.
 * No Foundry API calls, no document mutations, no side effects.
 * All functions are synchronous except renderBrewResultCard (requires roll.render()).
 *
 * Internal to the alchemy subsystem — not re-exported from index.js.
 */

// ── Brew Pending Card ─────────────────────────────────────────────────────────

/**
 * Render the pending brew chat card (shown before the Roll is made).
 *
 * @param {object} data
 * @param {string} data.actorImg
 * @param {string} data.actorName
 * @param {string} data.modeLabel        "Brew Potion" / "Brew Poison" / "Brew Toxin"
 * @param {string} data.skillName
 * @param {number} data.tn               Base TN from Alchemy skill.
 * @param {number} data.alchemyRank
 * @param {string} data.effectsHtml      Pre-built effect rows HTML (potion/toxin).
 * @param {string} data.poisonHtml       Pre-built poison row HTML.
 * @param {string} data.penaltyRowsHtml  Pre-built penalty rows HTML.
 * @param {number} data.adjustedTN       TN after modifiers.
 * @param {boolean} data.nothingVentured
 * @param {number}  data.trialBonus
 * @param {number}  data.brewTime
 * @param {string}  data.actorUuid
 * @returns {string}
 */
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
    adjustedTN = 0,
    nothingVentured = false,
    trialBonus = 0,
    brewTime = 0,
    actorUuid = "",
  } = data;

  const nothingVenturedRow = nothingVentured
    ? '<div class="uesrpg-da-row"><span class="k">⚠ Nothing Ventured</span><span class="v">Doubles or fail = backfire</span></div>'
    : "";
  const trialBonusRow = trialBonus > 0
    ? `<div class="uesrpg-da-row"><span class="k">Trial and Error</span><span class="v">+${trialBonus}</span></div>`
    : "";

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
        <div class="uesrpg-da-row"><span class="k">Alchemy Skill</span><span class="v">${skillName} (TN ${tn})</span></div>
        <div class="uesrpg-da-row"><span class="k">Alchemy Rank</span><span class="v">${alchemyRank}</span></div>
        ${effectsHtml}${poisonHtml}
        ${penaltyRowsHtml}
        <div class="uesrpg-da-row"><span class="k">Adjusted TN</span><span class="v"><strong>${adjustedTN}</strong></span></div>
        ${nothingVenturedRow}
        ${trialBonusRow}
        <div class="uesrpg-da-row"><span class="k">Brew Time</span><span class="v">${brewTime} hour${brewTime !== 1 ? "s" : ""}</span></div>
      </div>
      <div class="footer" style="margin-top:0.5rem;">
        <button type="button"
          data-action="alchemyRoll"
          data-actor-uuid="${actorUuid}"
          style="width:100%;padding:0.4rem 0;font-weight:bold;">
          Roll Alchemy (TN ${adjustedTN})
        </button>
      </div>
    </div>
  `;
}

// ── Brew Result Card ──────────────────────────────────────────────────────────

/**
 * Render the brew result chat card (shown after the roll is resolved).
 * Async because roll.render() is async.
 *
 * @param {object} data
 * @param {string} data.actorImg
 * @param {string} data.actorName
 * @param {string} data.outcomeLabel      "Success" / "Critical Success" / "Failure" / "Critical Failure"
 * @param {string} data.outcomeColor      CSS color string.
 * @param {number} data.rollTotal
 * @param {number} data.adjustedTN
 * @param {Roll}   data.roll              Foundry Roll instance (for roll.render()).
 * @param {string} data.itemHtml          Pre-built created-item row HTML.
 * @param {string} data.backfireHtml      Pre-built backfire row HTML.
 * @param {string} data.drinkButtonHtml   Pre-built drink/apply button HTML.
 * @returns {Promise<string>}
 */
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
          <div class="title">${actorName} — Brew Result</div>
          <div class="sub" style="color:${outcomeColor};font-weight:bold;">${outcomeLabel} (${rollTotal} vs TN ${adjustedTN})</div>
        </div>
      </div>
      <div class="body">
        ${renderedRoll}
        ${itemHtml}
        ${backfireHtml}
        ${drinkButtonHtml}
      </div>
    </div>
  `;
}

// ── Apply-to-Weapon Card ──────────────────────────────────────────────────────

/**
 * Render the apply-to-weapon confirmation chat card.
 *
 * @param {object} data
 * @param {string} data.actorImg
 * @param {string} data.actorName
 * @param {string} data.weaponName
 * @param {string} data.kind              "poison" | "toxin"
 * @param {number|null} data.poisonLevel  For poison kind.
 * @param {string|null} data.damageFormula For poison kind.
 * @param {object[]|null} data.effects    For toxin kind (array of { effectKey, spellLevel }).
 * @param {number} data.maxHits
 * @param {boolean} data.backfired
 * @param {Function} data.getEffectLabel  `(effectKey) => string` label resolver (to avoid importing effects here).
 * @returns {string}
 */
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
    detailRows = `<div class="uesrpg-da-row"><span class="k">Poison Level</span><span class="v">${poisonLevel} (${damageFormula})</span></div>`;
  } else {
    detailRows = effects.map(
      (e) => `<div class="uesrpg-da-row"><span class="k">${getEffectLabel(e.effectKey)}</span><span class="v">SL ${e.spellLevel ?? 1}</span></div>`
    ).join("");
  }

  const backfiredRow = backfired
    ? '<div class="uesrpg-da-row" style="color:#c62828;"><span class="k">⚠ Backfired</span><span class="v">Effects may be unpredictable</span></div>'
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
        <div class="uesrpg-da-row"><span class="k">Weapon</span><span class="v">${weaponName}</span></div>
        ${detailRows}
        <div class="uesrpg-da-row"><span class="k">Hits</span><span class="v">${maxHits} remaining</span></div>
        ${backfiredRow}
      </div>
    </div>
  `;
}

// ── Alchemy Use Card ──────────────────────────────────────────────────────────

/**
 * Render the alchemy use result chat card wrapper (potion drink, backfire results, etc.)
 *
 * @param {object} data
 * @param {string} data.actorImg
 * @param {string} data.actorName
 * @param {string} data.title    Subtitle shown under actor name.
 * @param {string} data.bodyHtml Pre-assembled body rows HTML.
 * @returns {string}
 */
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
      <div class="body">${bodyHtml}</div>
    </div>
  `;
}
