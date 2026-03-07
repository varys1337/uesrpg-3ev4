/**
 * @module magic/opposed/render
 *
 * src/core/magic/opposed/render.js
 *
 * Chat card rendering for magic opposed workflow.
 */

import { getDefenderEntries, isMultiDefender, isBankChoicesEnabledForData, getBankCommitState, getDefenderOutcome, getMagicDefenderDamage, allDefendersCommitted } from "./schema.js";
import { hasActiveWard } from "../../combat/ward-defense.js";
import { AttackTracker } from "../../combat/attack-tracker.js";
import { computeSpellAttemptMagickaCost } from "../magicka-utils.js";
import { classifySpellForRouting } from "../spell-runtime.js";
import { _buildDamagePanel } from "../../combat/opposed/cards/template-helpers.js";
import { createUuidResolver, getActorFromResolvedDocument, resolveUuidSync } from "../../../utils/uuid-cache.js";

/**
 * Format signed number (+/-).
 */
function fmtSigned(n) {
  const v = Number(n ?? 0) || 0;
  return v >= 0 ? `+${v}` : `${v}`;
}

/**
 * Format degree (DoS/DoF).
 */
function fmtDegree(result) {
  if (!result) return "";
  const deg = Number(result.degree ?? 0);
  if (result.isSuccess) return `<span style="color: green;">${deg} DoS</span>`;
  return `<span style="color: red;">${deg} DoF</span>`;
}

/**
 * Extract TN from TN object or number.
 */
function extractTN(tnObj) {
  if (tnObj == null) return "-";
  if (typeof tnObj === 'object' && tnObj.finalTN != null) return tnObj.finalTN;
  if (typeof tnObj === 'number') return tnObj;
  return "-";
}

function shouldShowStatusLine() {
  return Boolean(game?.settings?.get?.("uesrpg-3ev4", "opposedShowStatusLine"));
}

function summarizeOutcomeText(outcome) {
  // For characteristic defense, show the detailed text (includes save result)
  if (outcome?.characteristicDefense && outcome?.text) return outcome.text;
  const winner = String(outcome?.winner ?? "");
  if (winner === "attacker") return "Caster wins.";
  if (winner === "defender") return "Target wins.";
  if (winner === "none") return "Both fail - neither resolves.";
  return "Resolved.";
}

function extractRollTotal(result) {
  const n = Number(result?.rollTotal ?? result?.total ?? result?.roll?.total ?? result?.roll?._total ?? result?.roll?.result ?? NaN);
  return Number.isFinite(n) ? n : null;
}

function renderRow(label, value, { nowrapValue = false } = {}) {
  const valueStyle = nowrapValue ? "white-space:nowrap;" : "";
  return `<div><b>${label}</b> <span style="${valueStyle}">${value}</span></div>`;
}

function getMagicTestLabel(a, revealed) {
  if (!revealed) return "-";
  return String(a?.spellSchool ?? a?.spellName ?? "Spell");
}

function getMagicAttackLabel(a, revealed) {
  if (!revealed) return "-";
  const spellName = String(a?.spellName ?? "Spell");
  const spellLevel = Number(a?.spellLevel ?? 1);
  return `${spellName} (${spellLevel})`;
}

function shouldShowAttackRow(data, a, revealed) {
  if (!revealed) return true;
  // Healing-direct casts are non-attack resolution paths.
  if (Boolean(data?.context?.healingDirect)) return false;
  // In opposed cards, assume spell rows are attack-capable unless explicitly marked non-attack.
  const spellName = String(a?.spellName ?? "").trim();
  return spellName.length > 0;
}

function renderTNLine(tnValue, entries) {
  const rows = Array.isArray(entries)
    ? entries.filter((m) => {
        const value = Number(m?.value ?? 0) || 0;
        if (m?.keepZero) return true;
        return value !== 0;
      }).map((m) => {
        const label = String(m?.label ?? "Modifier");
        const value = Number(m?.value ?? 0) || 0;
        return `<div style="display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:start; padding:2px 0;"><span style="overflow-wrap:anywhere; word-break:normal; text-align:left;">${label}</span><span style="font-variant-numeric: tabular-nums; white-space:nowrap; text-align:right;">${fmtSigned(value)}</span></div>`;
      }).join("")
    : "";

  if (!rows) return renderRow("TN:", tnValue, { nowrapValue: true });
  return `
    <details style="margin:0;">
      <summary style="display:inline-block; cursor:pointer; user-select:none; white-space:nowrap;">
        <b>TN:</b> ${tnValue} &#9654;
      </summary>
      <div style="margin:4px 0 0 0; padding-left:8px; width:100%; box-sizing:border-box; font-size:12px; opacity:0.95;">${rows}</div>
    </details>
  `;
}

function renderRollLine(result, { noRollText = "Automatic" } = {}) {
  if (!result) return "";
  if (result.noRoll) return renderRow("Roll:", noRollText, { nowrapValue: true });
  const total = extractRollTotal(result);
  const totalText = total == null ? "??" : String(total);
  return renderRow("Roll:", `${totalText} - ${fmtDegree(result)}`, { nowrapValue: true });
}

function getCostPresentation(attacker = {}) {
  const castSource = attacker?.castSource ?? null;
  const costMode = String(castSource?.costMode ?? "soul").trim().toLowerCase();
  const spentCost = Number(attacker?.mpSpent ?? attacker?.spellCost ?? 0) || 0;

  if (castSource?.type === "enchantment") {
    if (costMode === "none") {
      return {
        label: "No Resource Cost",
        value: "0",
        isNoCost: true
      };
    }
    if (costMode === "magicka") {
      return {
        label: "MP Cost",
        value: String(spentCost),
        isNoCost: false
      };
    }
    return {
      label: "Soul Energy Cost",
      value: `${spentCost} (pool: ${Number(castSource?.pool?.value ?? 0)}/${Number(castSource?.pool?.max ?? 0)})`,
      isNoCost: false
    };
  }

  return {
    label: "MP Cost",
    value: String(Number(attacker?.spellCost ?? 0) || 0),
    isNoCost: false
  };
}


/**
 * Render TN breakdown as collapsible details.
 */
function renderBreakdownDetails(title, entries, { inline = false } = {}) {
  const arr = Array.isArray(entries) ? entries : [];
  if (!arr.length) return "";

  const filtered = arr.filter((m) => {
    const value = Number(m?.value ?? 0) || 0;
    if (m?.keepZero) return true;
    return value !== 0;
  });

  if (!filtered.length) return "";

  const rows = filtered
    .map((m) => {
      const label = String(m?.label ?? "Modifier");
      const value = Number(m?.value ?? 0) || 0;
      return `<div style="display:flex; justify-content:space-between; gap:10px; padding:2px 0;"><span>${label}</span><span style="font-variant-numeric: tabular-nums; white-space:nowrap;">${fmtSigned(value)}</span></div>`;
    })
    .join("");

  if (inline) {
    return `
      <details style="display:inline-block; margin-left:6px; vertical-align:baseline;">
        <summary style="display:inline-block; cursor:pointer; user-select:none; white-space:nowrap;" title="${String(title ?? "Breakdown")}">&#9654;</summary>
        <div style="margin-top:4px; font-size:12px; opacity:0.95;">${rows}</div>
      </details>
    `;
  }

  return `
    <details style="margin-top:6px;">
      <summary style="cursor:pointer; user-select:none; white-space:nowrap; overflow-wrap:normal; word-break:keep-all;">${String(title ?? "Breakdown")}</summary>
      <div style="margin-top:4px; font-size:12px; opacity:0.95;">${rows}</div>
    </details>
  `;
}


/**
 * Render button.
 */
function btn({ label, action, disabled = false, title = "", dataset = null, style = "" } = {}) {
  const safeLabel = String(label ?? "Action");
  const safeAction = String(action ?? "");
  const safeTitle = String(title ?? "");
  const safeStyle = String(style ?? "").trim();
  const dataAttrs = dataset && typeof dataset === "object"
    ? Object.entries(dataset)
      .map(([key, val]) => `data-${String(key)}="${String(val).replaceAll('"', "&quot;")}"`)
      .join(" ")
    : "";
  return `
    <button
      type="button"
      data-ues-magic-opposed-action="${safeAction}"
      ${disabled ? "disabled=\"disabled\"" : ""}
      ${safeTitle ? `title="${safeTitle.replaceAll('"', "&quot;")}"` : ""}
      ${dataAttrs}
      ${safeStyle ? `style="${safeStyle.replaceAll('"', "&quot;")}"` : ""}
    >${safeLabel}</button>
  `;
}

function actionRowClass(count = 1) {
  const n = Math.max(1, Number(count) || 1);
  if (n === 1) return "uesrpg-opposed-action-row uesrpg-opposed-action-row--single";
  if (n === 2) return "uesrpg-opposed-action-row uesrpg-opposed-action-row--pair";
  if (n === 3) return "uesrpg-opposed-action-row uesrpg-opposed-action-row--triple";
  return "uesrpg-opposed-action-row uesrpg-opposed-action-row--quad";
}

function createRenderContext() {
  return {
    uuid: createUuidResolver(),
    actors: new Map(),
    spells: new Map(),
    items: new Map()
  };
}

function resolveActorFromUuid(uuid, ctx) {
  const raw = String(uuid ?? "").trim();
  if (!raw) return null;
  if (ctx?.actors?.has(raw)) return ctx.actors.get(raw);

  const doc = ctx?.uuid?.resolveSync(raw) ?? resolveUuidSync(raw);
  let actor = getActorFromResolvedDocument(doc);
  if (!actor) {
    const actorId = raw.split(".").pop();
    actor = game.actors?.get(actorId) ?? null;
  }
  if (ctx?.actors) ctx.actors.set(raw, actor);
  return actor;
}

function resolveSpellFromUuid(uuid, ctx) {
  const raw = String(uuid ?? "").trim();
  if (!raw) return null;
  if (ctx?.spells?.has(raw)) return ctx.spells.get(raw);
  const doc = ctx?.uuid?.resolveSync(raw) ?? resolveUuidSync(raw);
  const spell = (doc?.documentName === "Item") ? doc : null;
  if (ctx?.spells) ctx.spells.set(raw, spell);
  return spell;
}

function resolveItemFromUuid(uuid, ctx) {
  const raw = String(uuid ?? "").trim();
  if (!raw) return null;
  if (ctx?.items?.has(raw)) return ctx.items.get(raw);
  const doc = ctx?.uuid?.resolveSync(raw) ?? resolveUuidSync(raw);
  const item = doc?.documentName === "Item" ? doc : null;
  if (ctx?.items) ctx.items.set(raw, item);
  return item;
}

function getMagicAttackerCommitGate(data, ctx) {
  const attacker = resolveActorFromUuid(data?.attacker?.actorUuid, ctx);
  if (!attacker) return { allowed: false, reason: "Caster unavailable" };

  if (game?.combat) {
    const apCost = Number(data?.attacker?.apCost ?? 1) || 1;
    const currentAP = Number(foundry.utils.getProperty(attacker, "system.action_points.value") ?? 0);
    if (currentAP < apCost) return { allowed: false, reason: `${currentAP}/${apCost} AP` };
  }

  const spell = resolveSpellFromUuid(data?.attacker?.spellUuid, ctx);
  if (spell) {
    const castSource = data?.attacker?.castSource ?? null;
    const castMode = String(castSource?.costMode ?? "soul").trim().toLowerCase();
    const isEnchantSource = castSource?.type === "enchantment";
    if (game?.combat) {
      const cls = classifySpellForRouting(spell);
      if (cls?.isAttack && AttackTracker.hasExceededLimit(attacker)) {
        return { allowed: false, reason: AttackTracker.getLimitWarning(attacker) || "Attack limit reached" };
      }
    }
    if (isEnchantSource && castMode === "soul") {
      const itemUuid = String(castSource?.itemUuid ?? "").trim();
      const sourceLane = String(castSource?.sourceLane ?? "workshop").trim().toLowerCase();
      const item = itemUuid ? resolveItemFromUuid(itemUuid, ctx) : null;
      const needed = Number(castSource?.cost ?? 0) || 0;
      if (!item) return { allowed: false, reason: "Item unavailable" };
      const poolValue = sourceLane === "extension"
        ? Number(item.system?.charge?.value ?? item.flags?.["uesrpg-3ev4"]?.itemSpellcasting?.pool?.value ?? 0) || 0
        : Number(item.flags?.["uesrpg-3ev4"]?.enchanting?.cast?.pool?.value ?? 0) || 0;
      if (poolValue < needed) return { allowed: false, reason: `${poolValue}/${needed} Soul` };
    } else if (!(isEnchantSource && castMode === "none")) {
      const costInfo = computeSpellAttemptMagickaCost(attacker, spell, data?.attacker?.spellOptions ?? {});
      const needed = Number(costInfo?.cost ?? 0) || 0;
      const currentMagicka = Number(foundry.utils.getProperty(attacker, "system.magicka.value") ?? 0);
      if (currentMagicka < needed) return { allowed: false, reason: `${currentMagicka}/${needed} MP` };
    }
  }

  return { allowed: true };
}

function getMagicDefenderCommitDefenseGate(defenderData, ctx) {
  const defender = resolveActorFromUuid(defenderData?.actorUuid, ctx);
  if (!defender) return { allowed: false, reason: "Target unavailable" };
  const apCost = Number(defenderData?.apCost ?? 1) || 1;
  const currentAP = Number(foundry.utils.getProperty(defender, "system.action_points.value") ?? 0);
  if (currentAP < apCost) return { allowed: false, reason: `${currentAP}/${apCost} AP` };
  return { allowed: true };
}

/**
 * Render multi-defender card.
 */
function renderMultiDefenderCard(data, messageId, ctx) {
  const defenders = getDefenderEntries(data);
  const a = data.attacker ?? {};
  const cost = getCostPresentation(a);
  const attackerCostLine = renderRow(cost.label, cost.value);
  const bankMode = isBankChoicesEnabledForData(data);
  const anyOutcome = defenders.some(d => getDefenderOutcome(data, d));
  const { aCommitted } = getBankCommitState(data, defenders[0] ?? null);
  const readyToBegin = bankMode && allDefendersCommitted(data) && !anyOutcome && !a?.result;
  const revealAttacker = !bankMode || aCommitted || anyOutcome;
  const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
  const isMultiCharSave = defenders.some(d => d.defenseType === "characteristic-save");
  const defenseNote = isAoE
    ? "AoE: Block or Evade if aware. Choose No Defense if unable to defend."
    : (isMultiCharSave ? "Defenders must make characteristic saves." : "Defender may choose Block, Evade, or No Defense.");

  const aTestLabel = getMagicTestLabel(a, revealAttacker);
  const aAttackLabel = getMagicAttackLabel(a, revealAttacker);
  const showAttackRow = shouldShowAttackRow(data, a, revealAttacker);

  const aTN = revealAttacker ? String(extractTN(a.tn)) : "-";
  const aRollLine = renderRollLine(a.result);

  const attackerCommitLine = (() => {
    if (!bankMode || !shouldShowStatusLine()) return "";
    const rolled = !!a.result;
    const statusText = anyOutcome ? "Resolved" : rolled ? "Rolled" : (aCommitted ? "Committed" : "Awaiting choice");
    return `<div style="margin-top:4px; font-size:12px; opacity:0.85;"><b>Status:</b> ${statusText}</div>`;
  })();
  const attackerCommitGate = getMagicAttackerCommitGate(data, ctx);

  const attackerControls = (() => {
    if (a.result) return "";
    if (bankMode) {
      if (!aCommitted) {
        if (attackerCommitGate?.allowed === false) {
          return `<div style="margin-top:8px; font-size:12px; opacity:0.85;"><i>Casting unavailable: ${String(attackerCommitGate?.reason ?? "Unavailable")}</i></div>`;
        }
        return `<div class="${actionRowClass(1)}">${btn({ label: "Casting", action: "attacker-commit" })}</div>`;
      }
      return "";
    }
    return `<div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single">${btn({ label: "Roll Casting Test", action: "attacker-roll" })}</div>`;
  })();

  const defenderBlocks = defenders.map((d, idx) => {
    const { dCommitted, bothCommitted } = getBankCommitState(data, d);
    const outcome = getDefenderOutcome(data, d);
    const isCharSave = d.defenseType === "characteristic-save";
    // For characteristic saves, TN is deterministic and should be revealed immediately
    const revealDefender = !bankMode || bothCommitted || Boolean(outcome) || isCharSave;

    const dTN = revealDefender ? String(extractTN(d.tn)) : "-";
    const dTestLabel = !revealDefender
      ? "-"
      : (isCharSave ? "Characteristic" : (d.noDefense ? "No Defense" : (d.defenseType ?? "(choose)")));
    const dDefenseLabel = !revealDefender
      ? "-"
      : (isCharSave ? "Characteristic Save" : (d.noDefense ? "No Defense" : (d.defenseType ?? "-")));
    const dRollLine = isCharSave
      ? (d.result ? renderRollLine(d.result) : renderRow("Roll:", `<i style="opacity:0.8;">Awaiting test...</i>`, { nowrapValue: true }))
      : (d.noDefense
        ? renderRow("Roll:", `100 - <span style="color: red;">1 DoF</span>`, { nowrapValue: true })
        : renderRollLine(d.result));

    const defenderCommitLine = (() => {
      if (!bankMode || !shouldShowStatusLine()) return "";
      const rolled = !!d.result || !!d.noDefense;
      const statusText = outcome ? "Resolved" : rolled ? "Rolled" : (dCommitted ? "Committed" : "Awaiting choice");
      return `<div style="margin-top:4px; font-size:12px; opacity:0.85;"><b>Status:</b> ${statusText}</div>`;
    })();

    const canRollDefender = Boolean(a.result &&!d.result && !d.noDefense);
    const defenderControls = (() => {
      if (d.result || d.noDefense) return "";
      
      // BANK MODE: Handle commit buttons
      if (bankMode) {
        if (!dCommitted) {
          // Characteristic defense: single commit button
          if (isCharSave) {
            const charLabel = String(d.characteristicLabel ?? "CHA").toUpperCase();
            return `
              <div class="${actionRowClass(1)}">
                ${btn({ label: `Commit ${charLabel} Save`, action: "defender-commit-characteristic", dataset: { "defender-index": idx } })}
              </div>
            `;
          }
          const defenseCommitGate = getMagicDefenderCommitDefenseGate(d, ctx);
          if (defenseCommitGate?.allowed === false) {
            return `
              <div class="${actionRowClass(1)}">
                ${btn({ label: "No Defense", action: "defender-commit-nodefense", dataset: { "defender-index": idx } })}
              </div>
              <div style="margin-top:4px; font-size:12px; opacity:0.85;"><i>Defense unavailable: ${String(defenseCommitGate?.reason ?? "Unavailable")}</i></div>
            `;
          }
          // Standard defense: Defense / No Defense buttons
          return `
            <div class="${actionRowClass(2)}">
              ${btn({ label: "Defense", action: "defender-commit", dataset: { "defender-index": idx } })}
              ${btn({ label: "No Defense", action: "defender-commit-nodefense", dataset: { "defender-index": idx } })}
            </div>
          `;
        }
        return "";
      }
      
      // NON-BANK MODE: Characteristic defense roll button
      if (isCharSave && a.result && !d.result) {
        const charLabel = String(d.characteristicLabel ?? "CHA").toUpperCase();
        return `
          <div class="${actionRowClass(1)}">
            ${btn({ label: `Roll ${charLabel} Save`, action: "defender-characteristic-test", dataset: { "defender-index": idx } })}
          </div>
        `;
      }

      // NON-BANK MODE: Standard defense roll buttons
      if (canRollDefender && !isCharSave) {
        const defenderActor = resolveActorFromUuid(d.actorUuid, ctx);
        const wardAvailable = defenderActor ? hasActiveWard(defenderActor) : false;
        const buttons = [
          btn({ label: "Block", action: "defender-roll-block", dataset: { "defender-index": idx } }),
          btn({ label: "Evade", action: "defender-roll-evade", dataset: { "defender-index": idx } }),
          ...(wardAvailable ? [btn({ label: "Ward", action: "defender-roll-ward", dataset: { "defender-index": idx } })] : []),
          btn({ label: "No Defense", action: "defender-no-defense", dataset: { "defender-index": idx } })
        ];
        return `<div class="${actionRowClass(buttons.length)}">${buttons.join("")}</div>`;
      }
      return "";
    })();

    let outcomeLine = "";
    if (outcome) {
      const defType = String(d.defenseType ?? "").toLowerCase();
      const resolveLabel = defType === "ward" ? "Resolve Ward" : "Resolve Block";
      const resolveAction = defType === "ward" ? "ward-resolve" : "block-resolve";
      const dmgData = getMagicDefenderDamage(data, d);
      const blockResolveButton = (outcome?.needsBlockResolution && !isAoE && !dmgData?.rolled)
        ? `<div class="${actionRowClass(1)}">${btn({ label: resolveLabel, action: resolveAction, dataset: { "defender-index": idx } })}</div>`
        : "";

      outcomeLine = `
        <div style="margin-top:10px;"><b>Outcome:</b> ${summarizeOutcomeText(outcome)}</div>
        ${blockResolveButton}
      `;
    } else if (bankMode && !bothCommitted) {
      outcomeLine = `<div style="margin-top:10px;"><i>Waiting for both sides to commit choices...</i></div>`;
    } else if (a.result && !d.result && !d.noDefense) {
      outcomeLine = `
        <div style="margin-top:10px; padding:8px; background:rgba(0,0,0,0.05); border-left:3px solid #666;">
          <div style="font-weight:700;">Awaiting defense selection</div>
          <div style="margin-top:4px; font-size:12px; opacity:0.9;">${defenseNote}</div>
        </div>
      `;
    }

    const damagePanel = _buildDamagePanel(getMagicDefenderDamage(data, d));

    return `
      <div style="padding:6px; border:1px solid rgba(0,0,0,0.12); border-radius:6px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
          <div style="font-size:14px; font-weight:700;">Target</div>
          <div style="font-size:12px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><b>${d.tokenName ?? d.name ?? ""}</b></div>
        </div>
        <div style="margin-top:4px; font-size:13px; line-height:1.25;">
          ${renderRow("Test:", dTestLabel)}
          ${renderRow("Defense:", dDefenseLabel)}
          ${renderTNLine(d.noDefense ? "-" : dTN, (d.noDefense || !revealDefender) ? null : (d.tn?.breakdown ?? d.tn?.modifiers))}
          ${dRollLine}
          ${defenderCommitLine}
        </div>
        ${defenderControls}
        ${outcomeLine}
        ${damagePanel}
      </div>
    `;
  }).join("");

  const beginRollActions = readyToBegin
    ? `<div style="margin-top:8px;" data-ues-gm-only="true" class="${actionRowClass(1)}">${btn({ label: "Begin Opposed Roll", action: "begin-banked-roll" })}</div>`
    : "";

  return `
    <div class="ues-opposed-card ues-magic-opposed-card" data-message-id="${String(messageId ?? "")}" data-ues-magic-opposed="1" style="padding:6px 6px;">
      <div style="display:grid; grid-template-columns: 1fr; gap:12px;">
        <div style="padding-bottom:8px; border-bottom:1px solid rgba(0,0,0,0.12);">
          <div style="display:flex; justify-content:space-between; align-items:baseline;">
            <div style="font-size:14px; font-weight:700;">✨</div>
            <div style="font-size:13px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><b>${a.tokenName ?? a.name ?? ""}</b></div>
          </div>
          <div style="margin-top:4px; font-size:13px; line-height:1.25;">
            ${renderRow("Test:", aTestLabel)}
            ${showAttackRow ? renderRow("Attack:", aAttackLabel) : ""}
            ${attackerCostLine}
            ${renderTNLine(aTN, revealAttacker ? (a.tn?.breakdown ?? a.tn?.modifiers) : null)}
            ${aRollLine}
            ${attackerCommitLine}
          </div>
          ${attackerControls}
        </div>
        <div style="display:grid; grid-template-columns: 1fr; gap:10px;">
          ${defenderBlocks}
        </div>
        ${beginRollActions}
      </div>
    </div>
  `;
}

/**
 * Render single-defender card.
 */
function renderSingleDefenderCard(data, messageId, ctx) {
  const a = data.attacker;
  const d = data.defender;
  const cost = getCostPresentation(a);
  const attackerCostLine = renderRow(cost.label, cost.value);

  const bankMode = isBankChoicesEnabledForData(data);
  const { aCommitted, dCommitted, bothCommitted } = getBankCommitState(data);
  const readyToBegin = bankMode && allDefendersCommitted(data) && !data?.outcome && !a?.result;
  const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
  const isCharSave = d.defenseType === "characteristic-save";
  const defenseNote = isAoE
    ? "AoE: Block or Evade if aware. Choose No Defense if unable to defend."
    : (isCharSave ? "Defender must make a characteristic save." : "Defender may choose Block, Evade, or No Defense.");
  
  const phase = String(data?.context?.phase ?? data?.status ?? "pending");
  const resolved = phase === "resolved";
  
  // Hide choices until both committed
  const revealChoices = !bankMode || bothCommitted || resolved;
  
  const aTestLabel = getMagicTestLabel(a, revealChoices);
  const aAttackLabel = getMagicAttackLabel(a, revealChoices);
  const showAttackRow = shouldShowAttackRow(data, a, revealChoices);

  const aTN = revealChoices ? String(extractTN(a.tn)) : "-";
  const dTN = revealChoices ? String(extractTN(d.tn)) : "-";
  // isCharSave already declared above at line 353
  const dTestLabel = !revealChoices
    ? "-"
    : (isCharSave ? "CHA Save" : (d.noDefense ? "No Defense" : (d.defenseType ?? "(choose)")));
  const dDefenseLabel = !revealChoices
    ? "-"
    : (isCharSave ? "Characteristic Save" : (d.noDefense ? "No Defense" : (d.defenseType ?? "-")));

  const aRollLine = renderRollLine(a.result);

  const dRollLine = isCharSave
    ? (d.result ? renderRollLine(d.result) : renderRow("Roll:", `<i style="opacity:0.8;">Awaiting test...</i>`, { nowrapValue: true }))
    : (d.noDefense
      ? renderRow("Roll:", `100 - <span style="color: red;">1 DoF</span>`, { nowrapValue: true })
      : renderRollLine(d.result));

  const aBreakdownEntries = revealChoices ? (a.tn?.breakdown ?? a.tn?.modifiers) : null;
  const dBreakdownEntries = revealChoices && !d.noDefense ? (d.tn?.breakdown ?? d.tn?.modifiers) : null;

  const awaitingDefense = phase === "awaiting-defense";

  const attackerCommitLine = (() => {
    if (!bankMode || !shouldShowStatusLine()) return "";
    const rolled = !!a.result;
    const statusText = resolved ? "Resolved" : rolled ? "Rolled" : (aCommitted ? "Committed" : "Awaiting choice");
    return `<div style="margin-top:4px; font-size:12px; opacity:0.85;"><b>Status:</b> ${statusText}</div>`;
  })();
  const attackerCommitGate = getMagicAttackerCommitGate(data, ctx);

  const defenderCommitLine = (() => {
    if (!bankMode || !shouldShowStatusLine()) return "";
    const rolled = !!d.result || !!d.noDefense;
    const statusText = resolved ? "Resolved" : rolled ? "Rolled" : (dCommitted ? "Committed" : "Awaiting choice");
    return `<div style="margin-top:4px; font-size:12px; opacity:0.85;"><b>Status:</b> ${statusText}</div>`;
  })();

  const attackerControls = (() => {
    if (a.result) return "";
    
    if (bankMode) {
      if (!aCommitted) {
        if (attackerCommitGate?.allowed === false) {
          return `<div style="margin-top:8px; font-size:12px; opacity:0.85;"><i>Casting unavailable: ${String(attackerCommitGate?.reason ?? "Unavailable")}</i></div>`;
        }
        return `<div class="${actionRowClass(1)}">${btn({ label: "Casting", action: "attacker-commit" })}</div>`;
      }
      return "";
    }
    
    return `<div class="${actionRowClass(1)}">${btn({ label: "Roll Casting Test", action: "attacker-roll" })}</div>`;
  })();

  const defenderControls = (() => {
    if (d.result || d.noDefense) return "";
    
    // BANK MODE: Handle commit buttons
    if (bankMode) {
      if (!dCommitted) {
        // Characteristic defense: single commit button
        if (isCharSave) {
          const charLabel = String(d.characteristicLabel ?? "CHA").toUpperCase();
          return `
            <div class="${actionRowClass(1)}">
              ${btn({ label: `Commit ${charLabel} Save`, action: "defender-commit-characteristic" })}
            </div>
          `;
        }
        const defenseCommitGate = getMagicDefenderCommitDefenseGate(d, ctx);
        if (defenseCommitGate?.allowed === false) {
          return `
          <div class="${actionRowClass(1)}">
            ${btn({ label: "No Defense", action: "defender-commit-nodefense" })}
          </div>
          <div style="margin-top:4px; font-size:12px; opacity:0.85;"><i>Defense unavailable: ${String(defenseCommitGate?.reason ?? "Unavailable")}</i></div>
        `;
        }
        // Standard defense: Defense / No Defense buttons
        return `
          <div class="${actionRowClass(2)}">
            ${btn({ label: "Defense", action: "defender-commit" })}
            ${btn({ label: "No Defense", action: "defender-commit-nodefense" })}
          </div>
        `;
      }
      return "";
    }
    
    // NON-BANK MODE: Characteristic defense roll button
    if (isCharSave && a.result && !d.result) {
      const charLabel = String(d.characteristicLabel ?? "CHA").toUpperCase();
      return `
        <div class="${actionRowClass(1)}">
          ${btn({ label: `Roll ${charLabel} Save`, action: "defender-characteristic-test" })}
        </div>
      `;
    }
    
    // NON-BANK MODE: Standard defense roll buttons
    if (a.result && !d.result && !d.noDefense && !isCharSave) {
      const defenderActor = resolveActorFromUuid(d.actorUuid, ctx);
      const wardAvailable = defenderActor ? hasActiveWard(defenderActor) : false;
      const buttons = [
        btn({ label: "Block", action: "defender-roll-block" }),
        btn({ label: "Evade", action: "defender-roll-evade" }),
        ...(wardAvailable ? [btn({ label: "Ward", action: "defender-roll-ward" })] : []),
        btn({ label: "No Defense", action: "defender-no-defense" })
      ];
      return `<div class="${actionRowClass(buttons.length)}">${buttons.join("")}</div>`;
    }
    return "";
  })();

  let outcomeLine = "";
  if (resolved && data.outcome) {
    const defType = String(d.defenseType ?? "").toLowerCase();
    const resolveLabel = defType === "ward" ? "Resolve Ward" : "Resolve Block";
    const resolveAction = defType === "ward" ? "ward-resolve" : "block-resolve";
    const singleDmgData = getMagicDefenderDamage(data, d);
    const blockResolveButton = (data.outcome?.needsBlockResolution && !isAoE && !singleDmgData?.rolled)
      ? `<div class="${actionRowClass(1)}">${btn({ label: resolveLabel, action: resolveAction })}</div>`
      : "";

    outcomeLine = `
      <div style="margin-top:10px;"><b>Outcome:</b> ${summarizeOutcomeText(data.outcome)}</div>
      ${blockResolveButton}
    `;
  } else if (bankMode && !bothCommitted) {
    outcomeLine = `<div style="margin-top:10px;"><i>Waiting for both sides to commit choices...</i></div>`;
  } else if (awaitingDefense) {
    outcomeLine = `
      <div style="margin-top:10px; padding:8px; background:rgba(0,0,0,0.05); border-left:3px solid #666;">
        <div style="font-weight:700;">Awaiting defense selection</div>
        <div style="margin-top:4px; font-size:12px; opacity:0.9;">${defenseNote}</div>
      </div>
    `;
  }

  const singleDamagePanel = _buildDamagePanel(getMagicDefenderDamage(data, d));
  const beginRollActions = readyToBegin
    ? `<div style="margin-top:8px;" data-ues-gm-only="true" class="${actionRowClass(1)}">${btn({ label: "Begin Opposed Roll", action: "begin-banked-roll" })}</div>`
    : "";

  return `
    <div class="ues-opposed-card ues-magic-opposed-card" data-message-id="${String(messageId ?? "")}" data-ues-magic-opposed="1" style="padding:6px 6px;">
      <div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px; align-items:stretch;">
        <div style="min-width:0; padding-right:8px; border-right:1px solid rgba(0,0,0,0.12); box-sizing:border-box; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:baseline;">
            <div style="font-size:14px; font-weight:700;">✨</div>
            <div style="font-size:13px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><b>${a.tokenName ?? a.name ?? ""}</b></div>
          </div>
        <div style="margin-top:4px; font-size:13px; line-height:1.25;">
          ${renderRow("Test:", aTestLabel)}
          ${showAttackRow ? renderRow("Attack:", aAttackLabel) : ""}
          ${attackerCostLine}
          ${renderTNLine(aTN, aBreakdownEntries)}
          ${aRollLine}
          ${attackerCommitLine}
          </div>
          <div style="margin-top:auto;">${attackerControls}</div>
        </div>

        <div style="min-width:0; padding-left:8px; box-sizing:border-box; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:baseline;">
            <div style="font-size:14px; font-weight:700;">🛡️</div>
            <div style="font-size:13px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><b>${d.tokenName ?? d.name ?? ""}</b></div>
          </div>
          <div style="margin-top:4px; font-size:13px; line-height:1.25;">
            ${renderRow("Test:", dTestLabel)}
            ${renderRow("Defense:", dDefenseLabel)}
            ${renderTNLine(d.noDefense ? "-" : dTN, dBreakdownEntries)}
            ${dRollLine}
            ${defenderCommitLine}
          </div>
          <div style="margin-top:auto;">${defenderControls}</div>
        </div>
      </div>
      ${beginRollActions}
      ${outcomeLine}
      ${singleDamagePanel}
    </div>
  `;
}

/**
 * Render an unopposed casting card (no defender / targets).
 *
 * Builds the full HTML string for a spell cast without opposition — used for
 * self-buffs, ground-targeted AoE, and utility spells.
 *
 * @param {object} data - Opposed card data with `attacker` and optional `context`
 * @param {string} messageId - ChatMessage id to embed in the card
 * @returns {string} Rendered HTML string
 */
export function renderUnopposedCard(data, messageId) {
  const a = data.attacker;
  const castSource = a.castSource ?? null;
  const spellName = a.spellName ?? "Spell";
  const spellSchool = a.spellSchool ?? "";
  const spellLevel = Number(a.spellLevel ?? 1);
  const spellCost = Number(a.spellCost ?? 0);
  const castLevel = a.spellOptions?.castLevel;
  const castLevelLine = (castLevel != null && castLevel !== spellLevel)
    ? `<div style="color:#8a2be2; font-weight:bold;">Cast at Level ${castLevel}</div>`
    : "";

  const spellMpSpent = Number(a.mpSpent ?? a.spellCost ?? 0) || 0;
  const spellMpRefund = Number(a.mpRefund ?? 0) || 0;
  const cost = getCostPresentation(a);
  const costLabel = cost.label;
  const isEnchantmentCast = castSource?.type === "enchantment";
  const isNoCost = cost.isNoCost === true;
  const costDetail = isNoCost
    ? "0"
    : (isEnchantmentCast
      ? cost.value
      : `${spellCost}${spellMpSpent ? ` <span class="muted" style="opacity:0.8;">(paid: ${spellMpSpent}${spellMpRefund ? `, refunded: ${spellMpRefund}` : ""})</span>` : ""}`);
  const aTN = a.tn?.finalTN != null ? String(a.tn.finalTN) : "-";
  const aRollLine = a.result
    ? (a.result.noRoll
      ? `<div><b>Roll:</b> Automatic</div>`
      : `<div><b>Roll:</b> ${a.result.rollTotal} - ${fmtDegree(a.result)}${a.result.isCriticalSuccess ? ' <span style="color:green; font-weight:700;">CRITICAL</span>' : ''}${a.result.isCriticalFailure ? ' <span style="color:red; font-weight:700;">CRITICAL FAIL</span>' : ''}</div>`)
    : "";

  const aBreakdown = renderBreakdownDetails("TN breakdown", a.tn?.breakdown ?? a.tn?.modifiers);

  const note = String(data?.context?.note ?? "");
  const noteLine = note
    ? `<div style="margin-top:10px; padding:8px; background:rgba(0,0,0,0.05); border-left:3px solid #666;">
         <div style="font-weight:700;">${note}</div>
       </div>`
    : "";

  return `
    <div class="ues-opposed-card ues-magic-opposed-card" data-message-id="${String(messageId ?? "")}" style="padding:6px 6px;">
      <div style="display:grid; grid-template-columns:1fr; gap:8px;">
        <div>
          <div style="font-size:18px; font-weight:800; margin-bottom:6px;">${spellName}</div>
          <div><b>School:</b> ${spellSchool || "-"}</div>
          <div><b>Level:</b> ${spellLevel}</div>${castLevelLine}
          <div><b>${costLabel}:</b> ${costDetail}</div>
          <div style="margin-top:6px;"><b>TN:</b> ${aTN}</div>
          ${aRollLine}
          ${aBreakdown}
        </div>
      </div>
      ${noteLine}
    </div>
  `;
}

/**
 * Main render function — routes to the appropriate card renderer
 * (single-defender or multi-defender) based on the data shape.
 *
 * @param {object} data - Opposed card data containing attacker, defender(s), and context
 * @param {string} messageId - ChatMessage id to embed in the card
 * @returns {string} Rendered HTML string
 */
export function renderCard(data, messageId) {
  const ctx = createRenderContext();
  if (isMultiDefender(data)) {
    return renderMultiDefenderCard(data, messageId, ctx);
  }
  return renderSingleDefenderCard(data, messageId, ctx);
}
