import { t, tf } from "../../utils/i18n.js";
import { formatResultOutcomeLabel } from "../../utils/degree-roll-helper.js";
import { STRIKE_ENCHANTMENTS_CATALOG } from "../../data/strike-enchantments-catalog.js";
import { SPELL_EFFECTS_CATALOG } from "../../data/spell-effects-catalog.js";

const esc = (value) => foundry.utils.escapeHTML(String(value ?? ""));
const STRIKE_LABELS = new Map(STRIKE_ENCHANTMENTS_CATALOG.map((entry) => [entry.key, entry.label]));
const SPELL_EFFECT_LABELS = new Map(SPELL_EFFECTS_CATALOG.map((entry) => [entry.key, entry.label]));

function modeLabel(mode) {
  const key = String(mode ?? "");
  return t(`UESRPG.Apps.EnchantingWorkshop.Modes.${key.charAt(0).toUpperCase()}${key.slice(1)}.Label`, key);
}

function row(label, value, cssClass = "") {
  return `<div class="uesrpg-enchanting-card__row ${cssClass}"><span>${esc(label)}</span><strong>${value}</strong></div>`;
}

function statusClass(data) {
  if (data.resolved) return "is-resolved";
  if (data.resolving) return "is-resolving";
  return "is-pending";
}

function cardHeader(data, subtitle, status) {
  return `<header class="uesrpg-enchanting-card__header">
    <img src="${esc(data.actorImg || "icons/svg/mystery-man.svg")}" alt="">
    <div class="uesrpg-enchanting-card__identity"><strong>${esc(data.actorName)}</strong><span>${esc(subtitle)}</span></div>
    <span class="uesrpg-enchanting-card__status">${esc(status)}</span>
  </header>`;
}

function effectLabel(mode, entry = {}) {
  const provided = String(entry.label ?? "").trim();
  const rawKey = String(entry.effectKey ?? entry.key ?? provided).trim();
  const catalog = mode === "strike" ? STRIKE_LABELS : SPELL_EFFECT_LABELS;
  const resolved = catalog.get(rawKey);
  if (resolved) return resolved;
  if (provided && provided !== rawKey) return provided;
  return rawKey || t("UESRPG.UI.Effect", "Effect");
}

export function renderEnchantmentPendingCard(data = {}) {
  const effects = (data.entries ?? []).map((entry) => (
    `<li><span>${esc(entry.label)}</span><small>${esc(entry.detail)}</small></li>`
  )).join("");
  const stateText = data.resolved
    ? t("UESRPG.Apps.EnchantingWorkshop.Chat.Resolved", "Resolved")
    : data.resolving
      ? t("UESRPG.Apps.EnchantingWorkshop.Chat.Resolving", "Resolving...")
      : t("UESRPG.Apps.EnchantingWorkshop.Chat.Pending", "Pending Enchant test");
  const subtitle = `${modeLabel(data.mode)} ${t("UESRPG.Apps.EnchantingWorkshop.Chat.Ritual", "enchantment ritual")}`;
  const action = data.resolved
    ? ""
    : `<footer class="uesrpg-enchanting-card__footer">
        <button type="button" data-action="enchantingRoll" ${data.resolving ? "disabled" : ""}>
          <i class="fas fa-dice-d20" aria-hidden="true"></i>
          ${esc(t("UESRPG.Apps.EnchantingWorkshop.Chat.RollEnchant", "Roll Enchant"))}
        </button>
      </footer>`;
  return `<div class="uesrpg-enchanting-card ${statusClass(data)}">
      ${cardHeader(data, subtitle, stateText)}
      <section class="uesrpg-enchanting-card__body">
        ${row(t("UESRPG.Apps.EnchantingWorkshop.Chat.Target", "Target"), esc(data.targetName))}
        ${row(t("UESRPG.Apps.EnchantingWorkshop.Chat.SoulGem", "Soul Gem"), `${esc(data.gemName)} <span class="type-tag">${Number(data.gemEnergy ?? 0)} / ${Number(data.gemCapacity ?? 0)}</span>`)}
        <div class="uesrpg-enchanting-card__summary">
          <span><small>${esc(t("UESRPG.Apps.EnchantingWorkshop.Chat.EnchantTN", "Enchant TN"))}</small><strong>${Number(data.enchantTN ?? 0)}</strong></span>
          <span><small>${esc(t("UESRPG.Apps.EnchantingWorkshop.Chat.PoolCap", "Pool cap"))}</small><strong>${Number(data.poolMax ?? 0)}</strong></span>
        </div>
        ${effects ? `<ul class="uesrpg-enchanting-card__entries">${effects}</ul>` : ""}
        ${data.issue ? `<div class="uesrpg-enchanting-card__issue">${esc(data.issue)}</div>` : ""}
      </section>
      ${action}
    </div>`;
}

function resultLine(label, result, bindingStrength = null) {
  if (!result) return "";
  const outcome = formatResultOutcomeLabel({
    isSuccess: result.success,
    isCriticalSuccess: result.isCritSuccess,
    isCriticalFailure: result.isCritFailure,
  });
  const degreeLabel = result.success ? "DoS" : "DoF";
  const outcomeClass = result.success ? "is-success" : "is-failure";
  const binding = result.success && Number(bindingStrength ?? result.bindingStrength ?? 0) > 0
    ? `<span class="uesrpg-enchanting-card__binding">${esc(t("UESRPG.Apps.EnchantingWorkshop.Chat.BindingStrength", "Binding"))} ${Number(bindingStrength ?? result.bindingStrength)}</span>`
    : "";
  return `<div class="uesrpg-enchanting-card__test">
    <div><strong>${esc(label)}</strong>${binding}</div>
    <div class="uesrpg-enchanting-card__test-values">
      <span>${esc(t("UESRPG.Chat.Common.TN", "TN"))} ${Number(result.tn ?? 0)}</span>
      <span>${esc(t("UESRPG.Chat.Common.Roll", "Roll"))} <strong>${Number(result.roll ?? 0)}</strong></span>
      <span class="uesrpg-chat-result ${outcomeClass}">${esc(outcome)} (${Number(result.degrees ?? 0)} ${degreeLabel})</span>
    </div>
  </div>`;
}

function salvageLine(buildResult) {
  const salvage = buildResult?.salvageResult;
  if (!salvage) return "";
  return resultLine(t("UESRPG.Apps.EnchantingWorkshop.Chat.SalvageEnergy", "Salvage Energy"), {
    ...salvage,
    tn: buildResult?.testResult?.tn ?? 0,
    isCritSuccess: false,
    isCritFailure: false,
  });
}

export function renderEnchantmentResultCard(data = {}) {
  const tests = data.mode === "cast"
    ? (data.buildResult?.spellResults ?? []).map((entry) => (
        resultLine(entry.label, entry.testResult, entry.bindingStrength) +
        (entry.salvageResult ? resultLine(t("UESRPG.Apps.EnchantingWorkshop.Chat.SalvageEnergy", "Salvage Energy"), {
          ...entry.salvageResult,
          tn: entry.testResult?.tn ?? 0,
          isCritSuccess: false,
          isCritFailure: false,
        }) : "")
      )).join("")
    : resultLine(modeLabel(data.mode), data.buildResult?.testResult) + salvageLine(data.buildResult);
  const outcomeKey = data.enchantmentApplied ? "Applied" : "Failed";
  const outcome = t(`UESRPG.Apps.EnchantingWorkshop.Chat.${outcomeKey}`, data.enchantmentApplied ? "Enchantment applied" : "Enchantment failed");
  const gemText = data.gemPreserved
    ? t("UESRPG.Apps.EnchantingWorkshop.Chat.GemPreserved", "Soul gem preserved")
    : data.gemConsumed
      ? data.operation?.gemReusable
        ? t("UESRPG.Apps.EnchantingWorkshop.Chat.VesselEmptied", "Reusable vessel emptied")
        : t("UESRPG.Apps.EnchantingWorkshop.Chat.GemConsumed", "One soul gem consumed")
      : t("UESRPG.Apps.EnchantingWorkshop.Chat.GemUnchanged", "Soul gem unchanged");
  const issue = data.operation?.reason
    ? `<div class="uesrpg-enchanting-card__issue">${esc(data.operation.reason)}</div>`
    : "";
  return `<div class="uesrpg-enchanting-card is-result ${data.operation?.ok ? "is-success" : "is-error"}">
      ${cardHeader(data, modeLabel(data.mode), outcome)}
      <section class="uesrpg-enchanting-card__body">
        ${row(t("UESRPG.Apps.EnchantingWorkshop.Chat.Target", "Target"), esc(data.targetName))}
        <div class="uesrpg-enchanting-card__tests">${tests}</div>
        ${row(t("UESRPG.Apps.EnchantingWorkshop.Chat.SoulGemOutcome", "Soul gem"), esc(gemText))}
        ${issue}
      </section>
    </div>`;
}

export function formatPendingEntries(mode, request, preview) {
  if (mode === "cast") {
    return (request.spells ?? []).map((spell, index) => ({
      label: spell.label || tf("UESRPG.Apps.EnchantingWorkshop.Chat.SpellNumber", { number: index + 1 }, `Spell ${index + 1}`),
      detail: `SL ${Number(spell.level ?? 0)} · ${Number(preview?.spellResults?.[index]?.penalty ?? 0)} TN`,
    }));
  }
  const effects = request.effects ?? [];
  return effects.map((effect) => ({
    label: effectLabel(mode, effect),
    detail: `SL ${Number(effect.sl ?? 0)} · ${Number(preview?.penalty ?? 0)} TN`,
  }));
}
