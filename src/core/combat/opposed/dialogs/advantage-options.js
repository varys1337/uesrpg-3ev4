import { buildSpecialActionTooltipText, buildSpecialActionHelpText } from "../../../../data/tooltips/index.js";
import { systemTooltipAttributes, setSystemOptionTooltip } from "../../../../ui/shared/system-tooltips.js";
import { escapeHtml } from "../../../../utils/html.js";
import { t } from "../../../../utils/i18n.js";

export function renderSpecialActionOption(sa, { name, value, type = "checkbox" } = {}) {
  const id = String(sa?.id ?? "").trim();
  if (!id) return "";
  const label = String(sa?.name ?? id);
  const typ = String(sa?.actionType ?? "").toLowerCase();
  const tooltip = buildSpecialActionTooltipText({ name: label, id, actionType: typ || "primary/secondary" });
  const helpText = buildSpecialActionHelpText({ name: label, id });
  const chipClass = typ === "primary" ? "uesrpg-adv-chip--primary" : "uesrpg-adv-chip--secondary";
  const chipLabel = typ === "primary" ? t("UESRPG.Sheets.Combat.Primary", "Primary") : t("UESRPG.Sheets.Combat.Secondary", "Secondary");
  return `
      <label class="uesrpg-adv-choice" ${systemTooltipAttributes({ text: tooltip })} data-uesrpg-inline-help="true" data-uesrpg-inline-help-label="${escapeHtml(label)}" data-uesrpg-inline-help-text="${escapeHtml(tooltip)}" data-uesrpg-inline-help-dialog-text="${escapeHtml(helpText)}">
        <input type="${type}" name="${escapeHtml(name ?? `sa_${id}`)}" value="${escapeHtml(value ?? id)}" />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">${escapeHtml(label)}</span>
          <span class="uesrpg-adv-chip uesrpg-adv-chip--inline ${chipClass}">${chipLabel}</span>
        </span>
      </label>
    `;
}

const ATTACK_ADVANTAGES = ["precisionStrike", "penetrateArmor", "forcefulImpact", "pressAdvantage"];
const DEFENSE_ADVANTAGES = ["overextend", "overwhelm"];

/** The existing RAW calculator awards zero, one, or two; effects keep their Boolean contract. */
export function getAdvantageChoiceLimit(count) {
  const n = Number(count);
  return Number.isFinite(n) ? Math.min(2, Math.max(0, Math.floor(n))) : 0;
}

export function isAdvantageSelectionValid(selection, count, { role = "attacker", allowPress = true } = {}) {
  if (!selection || typeof selection !== "object") return false;
  const limit = getAdvantageChoiceLimit(count);
  if (Number(count) !== limit) return false;
  const permitted = role === "defender" ? DEFENSE_ADVANTAGES : ATTACK_ADVANTAGES;
  const all = [...ATTACK_ADVANTAGES, ...DEFENSE_ADVANTAGES];
  if (all.some(key => selection[key] && !permitted.includes(key))) return false;
  if (!allowPress && selection.pressAdvantage) return false;
  const special = selection.specialActionsSelected ?? [];
  if (!Array.isArray(special) || special.some(id => typeof id !== "string" || !id.trim())) return false;
  if (new Set(special).size !== special.length) return false;
  return permitted.filter(key => Boolean(selection[key])).length + special.length <= limit;
}

/** One radio group for ordinary outcomes; critical choices are separate native draft inputs. */
export function renderAdvantageChoices({ count, options = [], extraHtml = "" } = {}) {
  const limit = getAdvantageChoiceLimit(count);
  return `<div class="uesrpg-adv-sequence" data-advantage-limit="${limit}">
    ${Array.from({ length: limit }, (_, index) => {
      const name = `advantageChoice${index + 1}`;
      const legend = index === 0
        ? t("UESRPG.Dialogs.Opposed.FirstAdvantage", "First Advantage")
        : t("UESRPG.Dialogs.Opposed.SecondAdvantage", "Second Advantage");
      return `<fieldset data-advantage-step="${index}" ${index ? "hidden" : ""}>
        <legend ${limit === 1 ? 'class="uesrpg-chat-sr-only"' : ""}>${limit === 1 ? t("UESRPG.Chat.Common.Advantage", "Advantage") : legend}</legend>
        <div class="uesrpg-adv-grid">
          <label class="uesrpg-adv-choice uesrpg-adv-choice--none uesrpg-choice-bar">
            <input type="radio" name="${name}" value="none" checked />
            <span class="uesrpg-adv-choice__label"><span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.NoAdvantage", "None")}</span></span>
          </label>
          ${options.map(option => option.special
            ? renderSpecialActionOption(option.special, { name, value: option.id, type: "radio" })
            : `<label class="uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: option.help })}>
              <input type="radio" name="${name}" value="${escapeHtml(option.id)}" />
              <span class="uesrpg-adv-choice__label"><span class="uesrpg-adv-choice__title">${escapeHtml(option.title)}</span></span>
            </label>`).join("")}
        </div>
      </fieldset>`;
    }).join("")}
    ${extraHtml}
  </div>`;
}

/** Read native form drafts, including the hidden first step of a critical selection. */
export function readAdvantageChoices(root) {
  return [...root.querySelectorAll('.uesrpg-adv-sequence input[type="radio"]:checked')]
    .map(input => input.value).filter(value => value !== "none");
}

/** Shared non-submitting navigation; only the owning dialog's final action resolves its Promise. */
export function bindAdvantageChoices(root, { finalAction = "continue", defaultLocation = "Body" } = {}) {
  const sequence = root.querySelector(".uesrpg-adv-sequence");
  if (!sequence || sequence.dataset.bound === "true") return;
  sequence.dataset.bound = "true";
  const steps = [...sequence.querySelectorAll("[data-advantage-step]")];
  const finalButton = root.querySelector(`[data-action="${finalAction}"]`);
  const footer = finalButton?.parentElement;
  let step = 0;
  let next, back;
  if (steps.length > 1 && footer) {
    back = document.createElement("button");
    back.type = "button";
    back.className = "uesrpg-adv-back";
    back.textContent = t("UESRPG.Buttons.Back", "Back");
    next = document.createElement("button");
    next.type = "button";
    next.className = "uesrpg-adv-next";
    next.textContent = t("UESRPG.Buttons.Next", "Next");
    footer.insertBefore(back, finalButton);
    footer.insertBefore(next, finalButton);
  }
  const update = () => {
    const first = steps[0]?.querySelector("input:checked")?.value;
    for (const input of steps[1]?.querySelectorAll('input[type="radio"]') ?? []) {
      const duplicate = input.value !== "none" && input.value === first;
      if (duplicate && input.checked) steps[1].querySelector('input[value="none"]').checked = true;
      input.disabled = duplicate;
      const label = input.closest("label");
      label.classList.toggle("is-disabled", duplicate);
      label.toggleAttribute("tabindex", duplicate);
      if (duplicate) label.tabIndex = 0;
      label.dataset.advantageHelp ??= label.getAttribute("data-tooltip-text") ?? "";
      setSystemOptionTooltip(input, [label.dataset.advantageHelp, duplicate
        ? t("UESRPG.Dialogs.Opposed.AdvantageAlreadyChosen", "Already chosen as the first Advantage. Choose a different option or None.") : ""].filter(Boolean).join(" "));
    }
    steps.forEach((element, index) => { element.hidden = index !== step; });
    if (next) next.hidden = step !== 0;
    if (back) back.hidden = step !== 1;
    if (finalButton && steps.length > 1) {
      finalButton.hidden = step !== 1;
      finalButton.disabled = step !== 1;
    }
    const precision = sequence.querySelector('select[name="precisionLocation"]');
    if (precision) {
      const selected = readAdvantageChoices(sequence).includes("precisionStrike");
      precision.disabled = !selected;
      precision.closest(".ps-location")?.classList.toggle("disabled", !selected);
      if (!selected) precision.value = defaultLocation;
    }
  };
  const navigate = index => {
    step = index;
    update();
    steps[step]?.querySelector("input:checked")?.focus({ preventScroll: true });
  };
  next?.addEventListener("click", () => navigate(1));
  back?.addEventListener("click", () => navigate(0));
  sequence.addEventListener("change", update);
  // Capture before DialogV2 and the optional system Enter enhancement can submit the draft.
  root.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (steps.length > 1 && event.target.matches("button") && footer?.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.target.disabled) event.target.click();
      return;
    }
    if (event.target.matches("select, textarea, button, [contenteditable='true']")) return;
    if (steps.length > 1 && step === 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      next?.click();
    }
  }, true);
  update();
}
