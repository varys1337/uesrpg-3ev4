import { getDefenderCommitAvailability } from "../../opposed/shared/defense-availability.js";
/**
 * @module magic/opposed/render
 *
 * src/core/magic/opposed/render.js
 *
 * Chat card rendering for magic opposed workflow.
 */

import { getDefenderEntries, isMultiDefender, isBankChoicesEnabledForData, getBankCommitState, getDefenderOutcome, getMagicDefenderDamage } from "./schema.js";
import { hasActiveWard } from "../../combat/ward-defense.js";
import { AttackTracker } from "../../combat/attack-tracker.js";
import { isActorInStartedCombatEncounter } from "../../combat/combat-scope.js";
import { computeSpellAttemptMagickaCost } from "../magicka-utils.js";
import { classifySpellForRouting } from "../spell-runtime.js";
import { _buildDamagePanel } from "../../combat/opposed/cards/template-helpers.js";
import { createUuidResolver, getActorFromResolvedDocument, resolveUuidSync } from "../../../utils/uuid-cache.js";
import { renderOpposedLayout, renderOpposedParticipant, renderParticipantContext, renderRollSummary, renderTargetNumberLine, renderOpposedOutcome, renderUnavailableCommitNotice, renderCommitWaitingStatus, renderAutomaticNoDefenseNotice } from "../../opposed/shared/card-rendering.js";
import { escapeHtml } from "../../../utils/html.js";
import { localizeHitLocation } from "../../combat/combat-utils.js";
import { buildMagicCastContextRows } from "./cast-context.js";
import { t, tf } from "../../../utils/i18n.js";
import { systemTooltipAttributes } from "../../../ui/shared/system-tooltips.js";
import { renderEffectLinks } from "../../../ui/shared/effect-chat.js";

function renderAutomationCompletion(data) {
  if (data?.context?.automationCompletion?.status !== "partial") return "";
  return `<div class="uesrpg-chat-notice">${escapeHtml(t("UESRPG.Chat.Magic.AutomationPartial"))}</div>`;
}

/**
 * Format signed number (+/-).
 */
function fmtSigned(n) {
  const v = Number(n ?? 0) || 0;
  return v >= 0 ? `+${v}` : `${v}`;
}

/** Extract TN from TN object or number. */
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
  if (winner === "attacker") return t("UESRPG.Chat.Magic.CasterWins", "Caster wins.");
  if (winner === "defender") return t("UESRPG.Chat.Magic.TargetWins", "Target wins.");
  if (winner === "none") return t("UESRPG.Chat.Magic.BothFail", "Both fail - neither resolves.");
  return t("UESRPG.Chat.Status.Resolved", "Resolved.");
}

function extractRollTotal(result) {
  const n = Number(result?.rollTotal ?? result?.total ?? result?.roll?.total ?? result?.roll?.result ?? NaN);
  return Number.isFinite(n) ? n : null;
}

function renderRow(label, value) {
  return `<div class="uesrpg-opposed-stat"><b>${label}</b> <span>${value}</span></div>`;
}

function getMagicTestLabel(a, revealed) {
  if (!revealed) return "??";
  return String(a?.spellSchool ?? a?.spellName ?? t("UESRPG.Chat.Magic.Spell", "Spell"));
}

function getMagicAttackLabel(a, revealed, spell = null) {
  if (!revealed) return "??";
  const spellName = String(a?.spellName ?? t("UESRPG.Chat.Magic.Spell", "Spell"));
  const castContext = buildMagicCastContextRows(a, spell);
  const baseLevel = Math.max(1, Number(castContext?.baseLevel ?? a?.spellLevel ?? 1) || 1);
  const castLevel = Math.max(1, Number(castContext?.castLevel ?? a?.spellOptions?.castLevel ?? baseLevel) || baseLevel);
  const spellStrength = Number(castContext?.spellStrengthValue ?? NaN);
  const details = [`L${castLevel}`];
  if (Number.isFinite(spellStrength) && spellStrength > 0) details.push(`SS ${Math.floor(spellStrength)}`);
  return `${spellName} (${details.join(", ")})`;
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
        return `<div class="uesrpg-chat-kv-row"><span>${label}</span><span>${fmtSigned(value)}</span></div>`;
      }).join("")
    : "";

  return renderTargetNumberLine(tnValue, rows);
}

function renderRollLine(result) {
  if (!result) return "";
  const total = extractRollTotal(result);
  const totalText = total == null ? "??" : String(total);
  return renderRollSummary(totalText, result, { automatic: Boolean(result.noRoll) });
}

function getCostPresentation(attacker = {}) {
  const castSource = attacker?.castSource ?? null;
  const costMode = String(castSource?.costMode ?? "soul").trim().toLowerCase();

  if (castSource?.type === "enchantment") {
    const bindingStrength = Math.max(0, Number(castSource?.bindingStrength ?? 0) || 0);
    const degree = Math.max(0, Number(attacker?.result?.degree ?? attacker?.result?.degrees ?? bindingStrength) || 0);
    return {
      label: t("UESRPG.Chat.Magic.DoS", "DoS"),
      value: tf("UESRPG.Chat.Magic.BindingStrengthDoSValue", { degree, bindingStrength }, `${degree} (Binding Strength ${bindingStrength})`),
      isNoCost: costMode === "none",
      isEnchantmentDoS: true
    };
  }

  return {
    label: t("UESRPG.Chat.Magic.MPCost", "MP Cost"),
    value: String(Number(attacker?.spellCost ?? 0) || 0),
    isNoCost: false
  };
}

function renderMagicCostRow(attacker = {}) {
  const cost = getCostPresentation(attacker);
  const spent = Number(attacker.mpSpent ?? attacker.spellCost ?? 0) || 0;
  const refund = Number(attacker.mpRefund ?? 0) || 0;
  const detail = attacker.castSource?.type === "enchantment" ? cost.value
    : (cost.isNoCost ? "0" : `${Number(attacker.spellCost ?? 0) || 0}${spent ? ` <span class="uesrpg-chat-secondary">(paid: ${spent}${refund ? `, refunded: ${refund}` : ""})</span>` : ""}`);
  return renderRow(`${cost.label}:`, detail);
}


/**
 * Render button.
 */
function btn({ label, action, disabled = false, title = "", dataset = null, style = "" } = {}) {
  const safeLabel = String(label ?? t("UESRPG.Sheets.Combat.Action", "Action"));
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
      ${safeTitle ? systemTooltipAttributes({ text: safeTitle }) : ""}
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

function buildMagicTrackerContext(data, attacker, source = "magic-opposed-render") {
  const tokenUuid = String(data?.attacker?.tokenUuid ?? attacker?.token?.document?.uuid ?? attacker?.token?.uuid ?? "").trim();
  return {
    combatantId: String(data?.attacker?.combatantId ?? "").trim() || null,
    tokenUuid: tokenUuid || null,
    source,
    sourceTag: source,
    attackTraceId: String(data?.context?.attackTraceId ?? "").trim() || null,
    attackMode: "magic",
    phase: "render-gate"
  };
}

function getMagicAttackerCommitGate(data, ctx) {
  const attacker = resolveActorFromUuid(data?.attacker?.actorUuid, ctx);
  if (!attacker) return { allowed: false, reason: t("UESRPG.Chat.Magic.CasterUnavailable", "Caster unavailable") };

  if (isActorInStartedCombatEncounter(attacker, {
    tokenUuid: data?.attacker?.tokenUuid ?? null,
    combatantId: data?.attacker?.combatantId ?? null
  })) {
    const apCost = Number(data?.attacker?.apCost ?? 1) || 1;
    const currentAP = Number(foundry.utils.getProperty(attacker, "system.action_points.value") ?? 0);
    if (currentAP < apCost) return { allowed: false, reason: `${currentAP}/${apCost} AP` };
  }

  const spell = resolveSpellFromUuid(data?.attacker?.spellUuid, ctx);
  if (spell) {
    const castSource = data?.attacker?.castSource ?? null;
    const castMode = String(castSource?.costMode ?? "soul").trim().toLowerCase();
    const isEnchantSource = castSource?.type === "enchantment";
    if (isActorInStartedCombatEncounter(attacker, {
      tokenUuid: data?.attacker?.tokenUuid ?? null,
      combatantId: data?.attacker?.combatantId ?? null
    })) {
      const cls = classifySpellForRouting(spell);
      const trackerContext = buildMagicTrackerContext(data, attacker);
      if (cls?.isAttack && AttackTracker.hasExceededLimit(attacker, { attackMode: "magic" }, trackerContext)) {
        return {
          allowed: false,
          reason: AttackTracker.getLimitWarning(attacker, { attackMode: "magic" }, trackerContext)
            || t("UESRPG.Chat.Opposed.AttackLimitReached", "Attack limit reached")
        };
      }
    }
    if (isEnchantSource && castMode === "soul") {
      const itemUuid = String(castSource?.itemUuid ?? "").trim();
      const sourceLane = String(castSource?.sourceLane ?? "workshop").trim().toLowerCase();
      const item = itemUuid ? resolveItemFromUuid(itemUuid, ctx) : null;
      const needed = Number(castSource?.cost ?? 0) || 0;
      if (!item) return { allowed: false, reason: t("UESRPG.Chat.Common.ItemUnavailable", "Item unavailable") };
      const poolValue = sourceLane === "extension"
        ? Number(item.flags?.["uesrpg-3ev4"]?.itemSpellcasting?.pool?.value ?? item.system?.charge?.value ?? 0) || 0
        : Number(item.flags?.["uesrpg-3ev4"]?.enchanting?.cast?.pool?.value ?? 0) || 0;
      if (poolValue < needed) return { allowed: false, reason: `${poolValue}/${needed} Soul` };
    } else if (isEnchantSource && castMode === "magicka") {
      const needed = Number(castSource?.cost ?? 0) || 0;
      const currentMagicka = Number(foundry.utils.getProperty(attacker, "system.magicka.value") ?? 0);
      if (currentMagicka < needed) return { allowed: false, reason: `${currentMagicka}/${needed} MP` };
    } else if (!(isEnchantSource && castMode === "none")) {
      const costInfo = computeSpellAttemptMagickaCost(attacker, spell, data?.attacker?.spellOptions ?? {});
      const needed = Number(costInfo?.cost ?? 0) || 0;
      const currentMagicka = Number(foundry.utils.getProperty(attacker, "system.magicka.value") ?? 0);
      if (currentMagicka < needed) return { allowed: false, reason: `${currentMagicka}/${needed} MP` };
    }
  }

  return { allowed: true };
}

function getMagicDefenderCommitDefenseGate(data, defenderData, messageId) {
  return getDefenderCommitAvailability({ data, defenderData, messageId, mode: "magic" });
}

/**
 * Render multi-defender card.
 */
function renderMultiDefenderCard(data, messageId, ctx) {
  const defenders = getDefenderEntries(data);
  const a = data.attacker ?? {};
  const bankMode = isBankChoicesEnabledForData(data);
  const anyOutcome = defenders.some(d => getDefenderOutcome(data, d));
  const { aCommitted } = getBankCommitState(data, defenders[0] ?? null);
  const revealAttacker = !bankMode || aCommitted || anyOutcome;
  const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
  const isMultiCharSave = defenders.some(d => d.defenseType === "characteristic-save");
  const defenseNote = isAoE
    ? t("UESRPG.Chat.Magic.AoeDefenseNote", "AoE: Block or Evade if aware. Choose No Defense if unable to defend.")
    : (isMultiCharSave
      ? t("UESRPG.Chat.Magic.MultiCharacteristicSaveNote", "Defenders must make characteristic saves.")
      : t("UESRPG.Chat.Magic.StandardDefenseNote", "Defender may choose Block, Evade, or No Defense."));

  const aTestLabel = getMagicTestLabel(a, revealAttacker);
  const attackerSpell = revealAttacker ? resolveSpellFromUuid(a.spellUuid, ctx) : null;
  const aAttackLabel = getMagicAttackLabel(a, revealAttacker, attackerSpell);
  const showAttackRow = shouldShowAttackRow(data, a, revealAttacker);

  const aTN = revealAttacker ? String(extractTN(a.tn)) : "??";
  const aRollLine = renderRollLine(a.result);

  const attackerCommitLine = (() => {
    if (!bankMode || !shouldShowStatusLine()) return "";
    const rolled = !!a.result;
    const statusText = anyOutcome
      ? t("UESRPG.Chat.Status.Resolved", "Resolved")
      : rolled
        ? t("UESRPG.Chat.Status.Rolled", "Rolled")
        : (aCommitted ? t("UESRPG.Chat.Status.Committed", "Committed") : t("UESRPG.Chat.Status.AwaitingChoice", "Awaiting choice"));
    return `<div class="uesrpg-chat-status-line"><b>${t("UESRPG.Chat.Common.Status", "Status")}:</b> ${statusText}</div>`;
  })();
  const attackerCommitGate = getMagicAttackerCommitGate(data, ctx);

  const attackerControls = (() => {
    if (a.result) return "";
    if (bankMode) {
      if (!aCommitted) {
        if (attackerCommitGate?.allowed === false) {
          return "";
        }
        return `<div class="${actionRowClass(1)}">${btn({ label: t("UESRPG.Chat.Magic.Casting", "Casting"), action: "attacker-commit" })}</div>`;
      }
      return "";
    }
    return `<div class="uesrpg-opposed-action-row uesrpg-opposed-action-row--single">${btn({ label: t("UESRPG.Chat.Magic.RollCastingTest", "Roll Casting Test"), action: "attacker-roll" })}</div>`;
  })();

  const defenderBlocks = defenders.map((d, idx) => {
    const { dCommitted, bothCommitted } = getBankCommitState(data, d);
    const outcome = getDefenderOutcome(data, d);
    const isCharSave = d.defenseType === "characteristic-save";
    // For characteristic saves, TN is deterministic and should be revealed immediately
    const revealDefender = !bankMode || bothCommitted || Boolean(outcome) || isCharSave;

    const dTN = revealDefender ? String(extractTN(d.tn)) : "??";
    const dTestLabel = !revealDefender
      ? "??"
      : (isCharSave ? t("UESRPG.Chat.Magic.Characteristic", "Characteristic") : (d.noDefense ? t("UESRPG.Chat.Opposed.NoDefense", "No Defense") : (d.defenseType ?? t("UESRPG.Chat.Common.Choose", "(choose)"))));
    const dDefenseLabel = !revealDefender
      ? "??"
      : (isCharSave ? t("UESRPG.Chat.Magic.CharacteristicSave", "Characteristic Save") : (d.noDefense ? t("UESRPG.Chat.Opposed.NoDefense", "No Defense") : (d.defenseType ?? "-")));
    const dRollLine = isCharSave
      ? (d.result ? renderRollLine(d.result) : renderRow(`${t("UESRPG.Chat.Common.Roll", "Roll")}:`, `<i style="opacity:0.8;">${t("UESRPG.Chat.Magic.AwaitingTest", "Awaiting test...")}</i>`, { nowrapValue: true }))
      : (d.noDefense
        ? renderRollSummary(100, { isSuccess: false, degree: 1 })
        : renderRollLine(d.result));

    const defenderCommitLine = (() => {
      if (!bankMode || !shouldShowStatusLine()) return "";
      const rolled = !!d.result || !!d.noDefense;
      const statusText = outcome
        ? t("UESRPG.Chat.Status.Resolved", "Resolved")
        : rolled
          ? t("UESRPG.Chat.Status.Rolled", "Rolled")
          : (dCommitted ? t("UESRPG.Chat.Status.Committed", "Committed") : t("UESRPG.Chat.Status.AwaitingChoice", "Awaiting choice"));
      return `<div class="uesrpg-chat-status-line"><b>${t("UESRPG.Chat.Common.Status", "Status")}:</b> ${statusText}</div>`;
    })();

    const defenseCommitGate = isCharSave ? { allowed: true } : getMagicDefenderCommitDefenseGate(data, d, messageId);
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
                ${btn({ label: tf("UESRPG.Chat.Magic.CommitCharacteristicSave", { characteristic: charLabel }, `Commit ${charLabel} Save`), action: "defender-commit-characteristic", dataset: { "defender-index": idx } })}
              </div>
            `;
          }

          if (defenseCommitGate?.insufficientAP) return "";
          if (defenseCommitGate?.allowed === false) {
            return `
              <div class="${actionRowClass(1)}">
                ${btn({ label: t("UESRPG.Chat.Opposed.NoDefense", "No Defense"), action: "defender-commit-nodefense", dataset: { "defender-index": idx } })}
              </div>
            `;
          }
          // Standard defense: Defense / No Defense buttons
          return `
            <div class="${actionRowClass(2)}">
              ${btn({ label: t("UESRPG.Chat.Opposed.Defense", "Defense"), action: "defender-commit", dataset: { "defender-index": idx } })}
              ${btn({ label: t("UESRPG.Chat.Opposed.NoDefense", "No Defense"), action: "defender-commit-nodefense", dataset: { "defender-index": idx } })}
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
            ${btn({ label: tf("UESRPG.Chat.Magic.RollCharacteristicSave", { characteristic: charLabel }, `Roll ${charLabel} Save`), action: "defender-characteristic-test", dataset: { "defender-index": idx } })}
          </div>
        `;
      }

      // NON-BANK MODE: Standard defense roll buttons
      if (canRollDefender && !isCharSave) {
        const defenderActor = resolveActorFromUuid(d.actorUuid, ctx);
        const wardAvailable = defenderActor ? hasActiveWard(defenderActor) : false;
        const buttons = [
          btn({ label: t("UESRPG.Chat.Opposed.Block", "Block"), action: "defender-roll-block", dataset: { "defender-index": idx } }),
          btn({ label: t("UESRPG.Chat.Opposed.Evade", "Evade"), action: "defender-roll-evade", dataset: { "defender-index": idx } }),
          ...(wardAvailable ? [btn({ label: t("UESRPG.Chat.Opposed.Ward", "Ward"), action: "defender-roll-ward", dataset: { "defender-index": idx } })] : []),
          btn({ label: t("UESRPG.Chat.Opposed.NoDefense", "No Defense"), action: "defender-no-defense", dataset: { "defender-index": idx } })
        ];
        return `<div class="${actionRowClass(buttons.length)}">${buttons.join("")}</div>`;
      }
      return "";
    })();

    let outcomeLine = "";
    if (outcome) {
      const defType = String(d.defenseType ?? "").toLowerCase();
      const resolveLabel = defType === "ward" ? t("UESRPG.Chat.Opposed.ResolveWard", "Resolve Ward") : t("UESRPG.Chat.Opposed.ResolveBlock", "Resolve Block");
      const resolveAction = defType === "ward" ? "ward-resolve" : "block-resolve";
      const dmgData = getMagicDefenderDamage(data, d);
      const blockResolveButton = (outcome?.needsBlockResolution && !isAoE && !dmgData?.rolled)
        ? `<div class="${actionRowClass(1)}">${btn({ label: resolveLabel, action: resolveAction, dataset: { "defender-index": idx } })}</div>`
        : "";

      outcomeLine = `
        ${renderOpposedOutcome(summarizeOutcomeText(outcome))}
        ${blockResolveButton}
      `;
    } else if (bankMode && !bothCommitted) {
      outcomeLine = "";
    } else if (a.result?.isSuccess && !d.result && !d.noDefense) {
      outcomeLine = `
        <div class="uesrpg-chat-notice">
          <div style="font-weight:700;">${t("UESRPG.Chat.Magic.AwaitingDefenseSelection", "Awaiting defense selection")}</div>
          <div class="uesrpg-chat-secondary">${defenseNote}</div>
        </div>
      `;
    }

    const damagePanel = _buildDamagePanel(getMagicDefenderDamage(data, d));

    return renderOpposedParticipant({
      role: "defender", defenderCard: true, name: d.tokenName ?? d.name,
      title: t("UESRPG.Chat.Common.Target", "Target"),
      context: renderParticipantContext([
        { label: t("UESRPG.Chat.Common.Test", "Test"), value: dTestLabel },
        { label: t("UESRPG.Chat.Opposed.Defense", "Defense"), value: dDefenseLabel }
      ]),
      tn: renderTNLine(d.noDefense ? "-" : dTN, (d.noDefense || !revealDefender) ? null : (d.tn?.breakdown ?? d.tn?.modifiers)),
      roll: dRollLine, status: renderAutomaticNoDefenseNotice(d) + defenderCommitLine + renderUnavailableCommitNotice({ active: bankMode && !dCommitted && !d.result, gate: defenseCommitGate }), actions: defenderControls, compactActions: bankMode && !d.result,
      aftermath: outcomeLine + damagePanel
    });
  }).join("");

  const attackerPanel = renderOpposedParticipant({
    name: a.tokenName ?? a.name, title: t("UESRPG.Chat.Magic.Caster", "Caster"),
    context: renderParticipantContext([
      { label: t("UESRPG.Chat.Common.Test", "Test"), value: aTestLabel },
      ...(showAttackRow ? [{ label: t("UESRPG.Chat.Opposed.Attack", "Attack"), value: aAttackLabel }] : [])
    ]),
    tn: renderTNLine(aTN, revealAttacker ? (a.tn?.breakdown ?? a.tn?.modifiers) : null),
    roll: aRollLine, status: attackerCommitLine + renderUnavailableCommitNotice({ active: bankMode && !aCommitted && !a.result, gate: attackerCommitGate, kind: "casting" }), actions: attackerControls, compactActions: bankMode && !a.result,
    extra: (revealAttacker ? renderMagicCostRow(a) : "") + renderEffectLinks(attackerSpell?.effects)
  });
  const defendersCommitted = defenders.every(d => d.banked?.committed || d.result || d.noDefense);
  const waitingFooter = bankMode && (!aCommitted || !defendersCommitted)
    ? renderCommitWaitingStatus({ attackerCommitted: aCommitted, defendersCommitted }) : "";
  return `<div class="ues-opposed-card ues-magic-opposed-card uesrpg-chat-surface" data-message-id="${String(messageId ?? "")}" data-ues-magic-opposed="1">
    ${renderOpposedLayout({ attacker: attackerPanel, defenders: defenderBlocks, after: waitingFooter + renderAutomationCompletion(data) })}
  </div>`;
}

/**
 * Render single-defender card.
 */
function renderSingleDefenderCard(data, messageId, ctx) {
  const a = data.attacker;
  const d = data.defender;

  const bankMode = isBankChoicesEnabledForData(data);
  const { aCommitted, dCommitted, bothCommitted } = getBankCommitState(data);
  const isAoE = Boolean(data?.context?.aoe?.isAoE || data?.context?.isAoE);
  const isCharSave = d.defenseType === "characteristic-save";
  const defenseNote = isAoE
    ? t("UESRPG.Chat.Magic.AoeDefenseNote", "AoE: Block or Evade if aware. Choose No Defense if unable to defend.")
    : (isCharSave
      ? t("UESRPG.Chat.Magic.CharacteristicSaveNote", "Defender must make a characteristic save.")
      : t("UESRPG.Chat.Magic.StandardDefenseNote", "Defender may choose Block, Evade, or No Defense."));
  
  const phase = String(data?.context?.phase ?? data?.status ?? "pending");
  const hasOutcome = Boolean(data.outcome);
  const resolved = phase === "resolved" || hasOutcome;
  
  // Hide choices until both committed
  const revealChoices = !bankMode || bothCommitted || resolved;
  
  const aTestLabel = getMagicTestLabel(a, revealChoices);
  const attackerSpell = revealChoices ? resolveSpellFromUuid(a.spellUuid, ctx) : null;
  const aAttackLabel = getMagicAttackLabel(a, revealChoices, attackerSpell);
  const showAttackRow = shouldShowAttackRow(data, a, revealChoices);

  const aTN = revealChoices ? String(extractTN(a.tn)) : "??";
  const dTN = revealChoices ? String(extractTN(d.tn)) : "??";
  // isCharSave already declared above at line 353
  const dTestLabel = !revealChoices
    ? "??"
    : (isCharSave ? t("UESRPG.Chat.Magic.ChaSave", "CHA Save") : (d.noDefense ? t("UESRPG.Chat.Opposed.NoDefense", "No Defense") : (d.defenseType ?? t("UESRPG.Chat.Common.Choose", "(choose)"))));
  const dDefenseLabel = !revealChoices
    ? "??"
    : (isCharSave ? t("UESRPG.Chat.Magic.CharacteristicSave", "Characteristic Save") : (d.noDefense ? t("UESRPG.Chat.Opposed.NoDefense", "No Defense") : (d.defenseType ?? "-")));

  const aRollLine = renderRollLine(a.result);

  const dRollLine = isCharSave
    ? (d.result ? renderRollLine(d.result) : renderRow(`${t("UESRPG.Chat.Common.Roll", "Roll")}:`, `<i style="opacity:0.8;">${t("UESRPG.Chat.Magic.AwaitingTest", "Awaiting test...")}</i>`, { nowrapValue: true }))
    : (d.noDefense
      ? renderRollSummary(100, { isSuccess: false, degree: 1 })
      : renderRollLine(d.result));

  const aBreakdownEntries = revealChoices ? (a.tn?.breakdown ?? a.tn?.modifiers) : null;
  const dBreakdownEntries = revealChoices && !d.noDefense ? (d.tn?.breakdown ?? d.tn?.modifiers) : null;

  const awaitingDefense = phase === "awaiting-defense";

  const attackerCommitLine = (() => {
    if (!bankMode || !shouldShowStatusLine()) return "";
    const rolled = !!a.result;
    const statusText = resolved
      ? t("UESRPG.Chat.Status.Resolved", "Resolved")
      : rolled
        ? t("UESRPG.Chat.Status.Rolled", "Rolled")
        : (aCommitted ? t("UESRPG.Chat.Status.Committed", "Committed") : t("UESRPG.Chat.Status.AwaitingChoice", "Awaiting choice"));
    return `<div class="uesrpg-chat-status-line"><b>${t("UESRPG.Chat.Common.Status", "Status")}:</b> ${statusText}</div>`;
  })();
  const attackerCommitGate = getMagicAttackerCommitGate(data, ctx);

  const defenderCommitLine = (() => {
    if (!bankMode || !shouldShowStatusLine()) return "";
    const rolled = !!d.result || !!d.noDefense;
    const statusText = resolved
      ? t("UESRPG.Chat.Status.Resolved", "Resolved")
      : rolled
        ? t("UESRPG.Chat.Status.Rolled", "Rolled")
        : (dCommitted ? t("UESRPG.Chat.Status.Committed", "Committed") : t("UESRPG.Chat.Status.AwaitingChoice", "Awaiting choice"));
    return `<div class="uesrpg-chat-status-line"><b>${t("UESRPG.Chat.Common.Status", "Status")}:</b> ${statusText}</div>`;
  })();

  const attackerControls = (() => {
    if (a.result) return "";
    
    if (bankMode) {
      if (!aCommitted) {
        if (attackerCommitGate?.allowed === false) {
          return "";
        }
        return `<div class="${actionRowClass(1)}">${btn({ label: t("UESRPG.Chat.Magic.Casting", "Casting"), action: "attacker-commit" })}</div>`;
      }
      return "";
    }
    
    return `<div class="${actionRowClass(1)}">${btn({ label: t("UESRPG.Chat.Magic.RollCastingTest", "Roll Casting Test"), action: "attacker-roll" })}</div>`;
  })();

  const defenseCommitGate = isCharSave ? { allowed: true } : getMagicDefenderCommitDefenseGate(data, d, messageId);
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
              ${btn({ label: tf("UESRPG.Chat.Magic.CommitCharacteristicSave", { characteristic: charLabel }, `Commit ${charLabel} Save`), action: "defender-commit-characteristic" })}
            </div>
          `;
        }

        if (defenseCommitGate?.insufficientAP) return "";
          if (defenseCommitGate?.allowed === false) {
          return `
          <div class="${actionRowClass(1)}">
            ${btn({ label: t("UESRPG.Chat.Opposed.NoDefense", "No Defense"), action: "defender-commit-nodefense" })}
          </div>
        `;
        }
        // Standard defense: Defense / No Defense buttons
        return `
          <div class="${actionRowClass(2)}">
            ${btn({ label: t("UESRPG.Chat.Opposed.Defense", "Defense"), action: "defender-commit" })}
            ${btn({ label: t("UESRPG.Chat.Opposed.NoDefense", "No Defense"), action: "defender-commit-nodefense" })}
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
          ${btn({ label: tf("UESRPG.Chat.Magic.RollCharacteristicSave", { characteristic: charLabel }, `Roll ${charLabel} Save`), action: "defender-characteristic-test" })}
        </div>
      `;
    }
    
    // NON-BANK MODE: Standard defense roll buttons
    if (a.result && !d.result && !d.noDefense && !isCharSave) {
      const defenderActor = resolveActorFromUuid(d.actorUuid, ctx);
      const wardAvailable = defenderActor ? hasActiveWard(defenderActor) : false;
      const buttons = [
        btn({ label: t("UESRPG.Chat.Opposed.Block", "Block"), action: "defender-roll-block" }),
        btn({ label: t("UESRPG.Chat.Opposed.Evade", "Evade"), action: "defender-roll-evade" }),
        ...(wardAvailable ? [btn({ label: t("UESRPG.Chat.Opposed.Ward", "Ward"), action: "defender-roll-ward" })] : []),
        btn({ label: t("UESRPG.Chat.Opposed.NoDefense", "No Defense"), action: "defender-no-defense" })
      ];
      return `<div class="${actionRowClass(buttons.length)}">${buttons.join("")}</div>`;
    }
    return "";
  })();

  let outcomeLine = "";
  if (data.outcome) {
    const defType = String(d.defenseType ?? "").toLowerCase();
    const resolveLabel = defType === "ward" ? t("UESRPG.Chat.Opposed.ResolveWard", "Resolve Ward") : t("UESRPG.Chat.Opposed.ResolveBlock", "Resolve Block");
    const resolveAction = defType === "ward" ? "ward-resolve" : "block-resolve";
    const singleDmgData = getMagicDefenderDamage(data, d);
    const blockResolveButton = (data.outcome?.needsBlockResolution && !isAoE && !singleDmgData?.rolled)
      ? `<div class="${actionRowClass(1)}">${btn({ label: resolveLabel, action: resolveAction })}</div>`
      : "";

    outcomeLine = `
      ${renderOpposedOutcome(summarizeOutcomeText(data.outcome))}
      ${blockResolveButton}
    `;
  } else if (bankMode && !bothCommitted) {
    outcomeLine = renderCommitWaitingStatus({ attackerCommitted: aCommitted, defendersCommitted: dCommitted });
  } else if (awaitingDefense && a.result?.isSuccess) {
    outcomeLine = `
      <div class="uesrpg-chat-notice">
        <div style="font-weight:700;">${t("UESRPG.Chat.Magic.AwaitingDefenseSelection", "Awaiting defense selection")}</div>
        <div class="uesrpg-chat-secondary">${defenseNote}</div>
      </div>
    `;
  }

  const singleDamagePanel = _buildDamagePanel(getMagicDefenderDamage(data, d));
  const attackerPanel = renderOpposedParticipant({
    name: a.tokenName ?? a.name, title: t("UESRPG.Chat.Magic.Caster", "Caster"),
    context: renderParticipantContext([
      { label: t("UESRPG.Chat.Common.Test", "Test"), value: aTestLabel },
      ...(showAttackRow ? [{ label: t("UESRPG.Chat.Opposed.Attack", "Attack"), value: aAttackLabel }] : [])
    ]),
    tn: renderTNLine(aTN, aBreakdownEntries), roll: aRollLine,
    status: attackerCommitLine + renderUnavailableCommitNotice({ active: bankMode && !aCommitted && !a.result, gate: attackerCommitGate, kind: "casting" }), actions: attackerControls, compactActions: bankMode && !a.result,
    extra: (revealChoices ? renderMagicCostRow(a) : "") + renderEffectLinks(attackerSpell?.effects)
  });
  const defenderPanel = renderOpposedParticipant({
    role: "defender", name: d.tokenName ?? d.name, title: t("UESRPG.Chat.Common.Target", "Target"),
    context: renderParticipantContext([
      { label: t("UESRPG.Chat.Common.Test", "Test"), value: dTestLabel },
      { label: t("UESRPG.Chat.Opposed.Defense", "Defense"), value: dDefenseLabel }
    ]),
    tn: renderTNLine(d.noDefense ? "-" : dTN, dBreakdownEntries), roll: dRollLine,
    status: renderAutomaticNoDefenseNotice(d) + defenderCommitLine + renderUnavailableCommitNotice({ active: bankMode && !dCommitted && !d.result, gate: defenseCommitGate }), actions: defenderControls, compactActions: bankMode && !d.result
  });
  return `<div class="ues-opposed-card ues-magic-opposed-card uesrpg-chat-surface" data-message-id="${String(messageId ?? "")}" data-ues-magic-opposed="1">
    ${renderOpposedLayout({ attacker: attackerPanel, defender: defenderPanel, after: outcomeLine + singleDamagePanel + renderAutomationCompletion(data) })}
  </div>`;
}

/**
 * Render an unopposed casting card (no defender / targets).
 *
 * Builds the full HTML string for a spell cast without opposition - used for
 * self-buffs, ground-targeted AoE, and utility spells.
 *
 * @param {object} data - Opposed card data with `attacker` and optional `context`
 * @param {string} messageId - ChatMessage id to embed in the card
 * @returns {string} Rendered HTML string
 */
export function renderUnopposedCard(data, messageId) {
  const a = data.attacker;
  const spell = resolveSpellFromUuid(a.spellUuid, createRenderContext());
  const spellName = a.spellName ?? t("UESRPG.Chat.Magic.Spell", "Spell");
  const spellSchool = a.spellSchool ?? "";
  const spellLevel = Number(a.spellLevel ?? 1);
  const castContext = buildMagicCastContextRows(a, spell);
  const strengthRow = castContext.rows.find(row => row.label === "Spell Strength");
  const otherContextRows = castContext.rows.filter(row => row !== strengthRow).map(row => renderRow(`${row.label}:`, row.value)).join("");
  const aTN = a.tn?.finalTN != null ? String(a.tn.finalTN) : "-";
  const note = String(data?.context?.note ?? "");
  const targetName = String(data?.defender?.tokenName ?? data?.defender?.name ?? "").trim();
  const targetDamage = data?.defender ? getMagicDefenderDamage(data, data.defender) : null;
  const hasPayload = targetDamage?.rolled === true;
  const payloadName = targetDamage?.weaponName || targetDamage?.effectLabel;
  const sameHeader = payloadName === spellName;
  const spellImg = a.spellImg ?? spell?.img ?? (sameHeader ? targetDamage?.weaponImg : null);
  const targetDamagePanel = _buildDamagePanel(targetDamage, { showHeader: !sameHeader, showHitLocation: false });
  const outcomeLine = data?.outcome
    ? renderOpposedOutcome(summarizeOutcomeText(data.outcome))
    : "";

  return `<div class="ues-opposed-card ues-magic-opposed-card uesrpg-chat-surface uesrpg-unopposed-cast" data-message-id="${String(messageId ?? "")}">
      <header class="uesrpg-chat-item-header">
        ${spellImg ? `<img src="${escapeHtml(spellImg)}" alt="">` : ""}
        <div><h3>${escapeHtml(spellName)}</h3><div class="uesrpg-chat-secondary">${escapeHtml(spellSchool || "-")} · ${t("UESRPG.Chat.Magic.Level", "Level")} ${spellLevel}</div></div>
      </header>
      <div class="uesrpg-cast-metadata">
        ${targetName ? `<div class="uesrpg-cast-metadata__target">${renderRow(`${t("UESRPG.Chat.Common.Target", "Target")}:`, escapeHtml(targetName))}</div>` : ""}
        ${strengthRow ? `<div class="uesrpg-cast-metadata__strength">${renderRow(`${strengthRow.label}:`, strengthRow.value)}</div>` : ""}
        ${hasPayload ? `<div class="uesrpg-cast-metadata__location">${renderRow(`${t("UESRPG.Chat.DamagePanel.HitLocationShort", "Hit Loc.")}:`, localizeHitLocation(targetDamage.hitLocation, t("UESRPG.Sheets.Item.HitLocation.Body", "Body")))}</div>` : ""}
        <div class="uesrpg-cast-metadata__cost">${renderMagicCostRow(a)}</div>
        ${otherContextRows ? `<div class="uesrpg-cast-metadata__extra">${otherContextRows}</div>` : ""}
      </div>
      <div class="uesrpg-opposed-metrics">${renderTNLine(aTN, a.tn?.breakdown ?? a.tn?.modifiers)}${renderRollLine(a.result)}</div>
      ${outcomeLine}
      ${targetDamagePanel}
      ${renderAutomationCompletion(data)}
      ${note ? `<div class="uesrpg-chat-notice">${note}</div>` : ""}
      ${renderEffectLinks(spell?.effects)}
    </div>`;
}

/**
 * Main render function - routes to the appropriate card renderer
 * (single-defender or multi-defender) based on the data shape.
 *
 * @param {object} data - Opposed card data containing attacker, defender(s), and context
 * @param {string} messageId - ChatMessage id to embed in the card
 * @returns {string} Rendered HTML string
 */
export function renderCard(data, messageId) {
  if (Boolean(data?.context?.noDefenseUnopposed) || Boolean(data?.context?.unopposed)) {
    return renderUnopposedCard(data, messageId);
  }
  const ctx = createRenderContext();
  if (isMultiDefender(data)) {
    return renderMultiDefenderCard(data, messageId, ctx);
  }
  return renderSingleDefenderCard(data, messageId, ctx);
}
