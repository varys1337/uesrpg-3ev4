/**
 * src/core/combat/defense-dialog.js
 *
 * Defender selection dialog for opposed combat.
 */

import { computeTN, listCombatStyles, hasEquippedShield } from "./tn.js";
import { hasCondition } from "../conditions/condition-engine.js";
import { computeDefenseAvailability, normalizeDefenseType } from "./defense-options.js";
import { applySenseLossPenaltyAdjustments } from "../traits/awareness-talents.js";
import { canUseWardDefense, getPreferredWardDefenseSpell } from "./ward-defense.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { buildCircumstanceOptionsHtml } from "../opposed/circumstance.js";
import { t } from "../../utils/i18n.js";
import { systemTooltipAttributes, setSystemOptionTooltip } from "../../ui/shared/system-tooltips.js";
import { buildCombatOptionTooltipText } from "../../data/tooltips/index.js";
import { renderTNPill } from "../../ui/shared/tn-presentation.js";

function asNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function _renderDefenseChoice({ value, title, checked, disabled, tnKey, desc = "", fullWidth = false, extraHtml = "" } = {}) {
  const help = buildCombatOptionTooltipText(value, desc);
  return `
    <div class="uesrpg-adv-choice-group ${fullWidth ? "uesrpg-defense-grid__full" : ""}">
    <label class="uesrpg-adv-choice uesrpg-choice-bar def-opt ${disabled ? "is-disabled" : ""}" ${systemTooltipAttributes({ text: help })} ${disabled ? 'tabindex="0"' : ""}>
      <input type="radio" name="defenseType" value="${value}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}/>
      <span class="uesrpg-adv-choice__label def-opt__card">
        <span class="uesrpg-defense-card__head">
          <span class="uesrpg-adv-choice__title">${title}</span>
          ${renderTNPill(tnKey)}
        </span>
      </span>
    </label>${extraHtml || ""}
    </div>
  `;
}

function _renderBlockSourceSelect({ show, shieldOk, wardOk, defaultBlockSource = "shield", disabled = false } = {}) {
  if (!show) return "";
  const selected = (defaultBlockSource === "ward" && wardOk) ? "ward" : "shield";
  return `
    <span class="uesrpg-adv-choice__desc uesrpg-block-source">
      <label class="uesrpg-dialog-row">
        <span>${t("UESRPG.Dialogs.Opposed.Source", "Source")}</span>
        <select name="blockSource" ${disabled ? "disabled" : ""}>
          ${shieldOk ? `<option value="shield" ${selected === "shield" ? "selected" : ""}>${t("UESRPG.Dialogs.Opposed.Shield", "Shield")}</option>` : ""}
          ${wardOk ? `<option value="ward" ${selected === "ward" ? "selected" : ""}>${t("UESRPG.Chat.Opposed.Ward", "Ward")}</option>` : ""}
        </select>
      </label>
    </span>
  `;
}

function _normalizeBlockSource(raw, availability) {
  const requested = String(raw ?? "").trim().toLowerCase();
  const shield = Boolean(availability?.gates?.blockSources?.shield);
  const ward = Boolean(availability?.gates?.blockSources?.ward);
  if (requested === "ward" && ward) return "ward";
  if (requested === "shield" && shield) return "shield";
  if (ward && !shield) return "ward";
  if (shield) return "shield";
  if (ward) return "ward";
  return "shield";
}

function _renderContent({
  defaultDefenseType,
  defaultBlockSource,
  defaultManualMod,
  defaultCircMod,
  availability,
  hasBlinded,
  hasDeafened,
  defaultApplyBlinded,
  defaultApplyDeafened,
  gladiator
}) {
  const allowed = availability?.allowed ?? { evade: true, parry: true, block: false, counter: true };
  const reasons = availability?.reasons ?? { evade: [], parry: [], block: [], counter: [] };
  const gates = availability?.gates ?? {
    isRangedAttack: false,
    attackerHasFlail: false,
    attackerHasEntangling: false,
    smallVsTwoHandedGate: false,
    blockSources: { shield: false, ward: false }
  };

  const blockSourceShield = Boolean(gates?.blockSources?.shield);
  const blockSourceWard = Boolean(gates?.blockSources?.ward);
  const showBlockSourceSelect = blockSourceShield && blockSourceWard;

  const sensoryFlags = [
    hasBlinded ? `<label class="uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: buildCombatOptionTooltipText("blinded") })}><input type="checkbox" name="applyBlinded" ${defaultApplyBlinded ? "checked" : ""} /> <span class="uesrpg-adv-choice__label">${t("UESRPG.Dialogs.Opposed.BlindedShort", "Blinded (-30)")}</span></label>` : ``,
    hasDeafened ? `<label class="uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: buildCombatOptionTooltipText("deafened") })}><input type="checkbox" name="applyDeafened" ${defaultApplyDeafened ? "checked" : ""} /> <span class="uesrpg-adv-choice__label">${t("UESRPG.Dialogs.Opposed.DeafenedShort", "Deafened (-30)")}</span></label>` : ``
  ].filter(Boolean);
  const sensoryRow = sensoryFlags.length ? `
  <div class="uesrpg-defense-flags">
    <span class="uesrpg-defense-flags__label">${t("UESRPG.Dialogs.Opposed.ApplyIfRelevant", "Apply if relevant:")}</span>
    <div class="uesrpg-defense-flags__items">
      ${sensoryFlags.join("")}
    </div>
  </div>` : ``;

  const gladiatorMode = String(gladiator?.mode ?? "disabled");
  const gladiatorTriggered = Boolean(gladiator?.triggered);
  const gladiatorAvailable = Boolean(gladiator?.available);
  const showGladiator = gladiatorTriggered && gladiatorMode !== "disabled";
  const gladiatorBlock = showGladiator ? `
  <div class="uesrpg-defense-flags">
    <span class="uesrpg-defense-flags__label">${t("UESRPG.Dialogs.Opposed.Gladiator", "Gladiator")}</span>
    <div class="uesrpg-defense-flags__items">
      ${gladiatorMode === "updated"
        ? `
        <label class="uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: buildCombatOptionTooltipText("gladiator", gladiatorAvailable ? t("UESRPG.Dialogs.Opposed.DefenseIsFree", "This defense is free (1/round).") : t("UESRPG.Dialogs.Opposed.AlreadyUsedThisRound", "Already used this round.")) })} ${gladiatorAvailable ? "" : 'tabindex="0"'}>
          <input type="checkbox" name="gladiatorFree" ${gladiatorAvailable ? "" : "disabled"} />
          <span class="uesrpg-adv-choice__label">${t("UESRPG.Dialogs.Opposed.GladiatorFreeShort", "Gladiator (0 AP)")}</span>
        </label>
        `
        : `
        <span class="uesrpg-sensory-hint">${gladiatorAvailable ? t("UESRPG.Dialogs.Opposed.DefenseIsFree", "This defense is free (1/round).") : t("UESRPG.Dialogs.Opposed.AlreadyUsedThisRound", "Already used this round.")}</span>
        `}
    </div>
  </div>` : ``;

  return `
<div class="uesrpg defense-dialog uesrpg-dialog-stack uesrpg-adv-dialog uesrpg-adv-dialog--defense uesrpg-adv-dialog--choice-bars">
  <div class="uesrpg-dialog-section-header">${t("UESRPG.Dialogs.Opposed.DefenseResponse", "Defense Response")}</div>
  <div class="uesrpg-adv-grid uesrpg-defense-grid">
    ${_renderDefenseChoice({
      value: "evade",
      title: t("UESRPG.Chat.Opposed.Evade", "Evade"),
      checked: defaultDefenseType === "evade",
      disabled: !allowed.evade,
      tnKey: "evade",
      desc: allowed.evade ? "" : (reasons?.evade?.[0] ?? t("UESRPG.Dialogs.Opposed.NotAvailableForAttack", "Not available for this attack."))
    })}
    ${_renderDefenseChoice({
      value: "parry",
      title: t("UESRPG.Dialogs.Opposed.Parry", "Parry"),
      checked: defaultDefenseType === "parry",
      disabled: !allowed.parry,
      tnKey: "parry",
      desc: allowed.parry ? "" : (reasons?.parry?.[0] ?? t("UESRPG.Dialogs.Opposed.NotAvailableForAttack", "Not available for this attack."))
    })}
    ${_renderDefenseChoice({
      value: "block",
      title: t("UESRPG.Chat.Opposed.Block", "Block"),
      checked: defaultDefenseType === "block",
      disabled: !allowed.block,
      tnKey: "block",
      desc: allowed.block ? "" : (reasons?.block?.[0] ?? t("UESRPG.Dialogs.Opposed.NotAvailableForAttack", "Not available for this attack.")),
      extraHtml: _renderBlockSourceSelect({
        show: showBlockSourceSelect,
        shieldOk: blockSourceShield,
        wardOk: blockSourceWard,
        defaultBlockSource,
        disabled: !allowed.block
      })
    })}
    ${_renderDefenseChoice({
      value: "counter",
      title: t("UESRPG.Dialogs.Opposed.CounterAttack", "Counter-Attack"),
      checked: defaultDefenseType === "counter",
      disabled: !allowed.counter,
      tnKey: "counter",
      desc: allowed.counter ? "" : (reasons?.counter?.[0] ?? t("UESRPG.Dialogs.Opposed.NotAvailableForAttack", "Not available for this attack."))
    })}
  </div>

  <div class="form-group">
    <label><b>${t("UESRPG.Dialogs.Opposed.CircumstanceModifier", "Circumstance Modifier")}</b></label>
    <select name="circMod">
      ${buildCircumstanceOptionsHtml(defaultCircMod)}
    </select>
  </div>

  <div class="form-group">
    <label><b>${t("UESRPG.Chat.Common.ManualModifier", "Manual modifier")}</b></label>
    <input type="number" name="manualMod" value="${asNumber(defaultManualMod)}" step="1" />
  </div>

  ${sensoryRow}
  ${gladiatorBlock}
</div>`;
}

export async function showDefenseDialog(defender, options = {}) {
  const styles = listCombatStyles(defender);
  const resolvedStyleUuid = options.defaultStyleUuid ?? styles?.[0]?.uuid ?? null;
  const requestedDefaultDefenseType = String(options.defaultDefenseType ?? "evade").toLowerCase();
  const requestedDefaultBlockSource = String(options.defaultBlockSource ?? "").toLowerCase();
  const defaultManualMod = Number(options.defaultManualMod ?? 0) || 0;
  const defaultCircMod = Number(options.defaultCircumstanceMod ?? 0) || 0;

  const shieldOk = hasEquippedShield(defender);
  const wardOk = canUseWardDefense(defender);
  const hasBlinded = hasCondition(defender, "blinded");
  const hasDeafened = hasCondition(defender, "deafened");
  const defaultApplyBlinded = (options.defaultApplyBlinded ?? true);
  const defaultApplyDeafened = (options.defaultApplyDeafened ?? true);

  const attackerWeaponTraits = options.attackerWeaponTraits ?? null;
  const defenderHasSmallWeapon = !!(options.defenderHasSmallWeapon);
  const attackMode = String(options?.context?.attackMode ?? options?.attackMode ?? "melee");
  const allowedDefenseTypes = Array.isArray(options.allowedDefenseTypes) ? options.allowedDefenseTypes : null;
  const allowParryRanged = Boolean(options.allowParryRanged);

  const availability = computeDefenseAvailability({
    attackMode,
    attackerWeaponTraits,
    defenderHasSmallWeapon,
    defenderHasShield: shieldOk,
    defenderHasWard: wardOk,
    attackerActor: options.attackerActor ?? null,
    defenderActor: defender,
    allowedDefenseTypes,
    allowParryRanged
  });

  let defaultDefenseType = normalizeDefenseType(requestedDefaultDefenseType, availability, "evade");
  if (requestedDefaultDefenseType === "ward" && availability?.allowed?.block) defaultDefenseType = "block";
  const defaultBlockSource = _normalizeBlockSource(requestedDefaultBlockSource, availability);
  const gladiator = options.gladiator ?? null;
  const context = options.context ?? undefined;

  const content = _renderContent({
    defaultDefenseType,
    defaultBlockSource,
    defaultManualMod,
    defaultCircMod,
    availability,
    hasBlinded,
    hasDeafened,
    defaultApplyBlinded,
    defaultApplyDeafened,
    gladiator
  });

  function getSelectedStyleUuid() {
    return resolvedStyleUuid ? String(resolvedStyleUuid) : null;
  }

  function refreshTN(root) {
    const currentAvailability = computeDefenseAvailability({
      attackMode,
      attackerWeaponTraits,
      defenderHasSmallWeapon,
      defenderHasShield: hasEquippedShield(defender),
      defenderHasWard: canUseWardDefense(defender),
      attackerActor: options.attackerActor ?? null,
      defenderActor: defender,
      allowedDefenseTypes,
      allowParryRanged
    });

    for (const name of ["evade", "block", "parry", "counter"]) {
      const radio = root.querySelector(`input[name="defenseType"][value="${name}"]`);
      if (radio) radio.disabled = !currentAvailability.allowed[name];
      const opt = radio?.closest(".def-opt");
      if (opt) opt.classList.toggle("is-disabled", Boolean(radio?.disabled));
      if (radio) setSystemOptionTooltip(radio, buildCombatOptionTooltipText(name, (currentAvailability.reasons?.[name] ?? []).join(" ")));
    }

    const blockSourceSelect = root.querySelector('select[name="blockSource"]');
    if (blockSourceSelect) {
      const nextBlockSource = _normalizeBlockSource(blockSourceSelect.value, currentAvailability);
      blockSourceSelect.value = nextBlockSource;
      const blockRadioChecked = Boolean(root.querySelector('input[name="defenseType"][value="block"]')?.checked);
      blockSourceSelect.disabled = !currentAvailability.allowed.block || !blockRadioChecked;
    }

    const checked = root.querySelector('input[name="defenseType"]:checked');
    const value = String(checked?.value ?? "evade");
    const normalized = normalizeDefenseType(value, currentAvailability, "evade");
    if (normalized !== value) {
      const normalizedRadio = root.querySelector(`input[name="defenseType"][value="${normalized}"]`);
      if (normalizedRadio) normalizedRadio.checked = true;
    }

    const manualMod = Number.parseInt(String(root.querySelector('input[name="manualMod"]')?.value ?? "0"), 10) || 0;
    const circumstanceMod = Number.parseInt(String(root.querySelector('select[name="circMod"]')?.value ?? "0"), 10) || 0;
    const applyBlinded = Boolean(root.querySelector('input[name="applyBlinded"]')?.checked);
    const applyDeafened = Boolean(root.querySelector('input[name="applyDeafened"]')?.checked);
    const situationalMods = [];
    if (applyBlinded && hasCondition(defender, "blinded")) situationalMods.push({ key: "blinded", conditionKey: "blinded", label: "Blinded (sight)", value: -30, source: "sense-loss" });
    if (applyDeafened && hasCondition(defender, "deafened")) situationalMods.push({ key: "deafened", conditionKey: "deafened", label: "Deafened (hearing)", value: -30, source: "sense-loss" });
    applySenseLossPenaltyAdjustments(situationalMods, defender);

    const styleUuid = getSelectedStyleUuid();
    const blockSource = _normalizeBlockSource(blockSourceSelect?.value, currentAvailability);
    const wardSpell = (blockSource === "ward") ? getPreferredWardDefenseSpell(defender) : null;
    if (blockSource === "ward") {
      const radio = root.querySelector('input[name="defenseType"][value="block"]');
      if (radio) setSystemOptionTooltip(radio, buildCombatOptionTooltipText("ward", (currentAvailability.reasons?.block ?? []).join(" ")));
    }
    const evadeTN = computeTN({ actor: defender, role: "defender", defenseType: "evade", manualMod, circumstanceMod, situationalMods, context }).finalTN;
    const parryTN = computeTN({ actor: defender, role: "defender", defenseType: "parry", styleUuid, manualMod, circumstanceMod, situationalMods, context }).finalTN;
    const counterTN = computeTN({ actor: defender, role: "defender", defenseType: "counter", styleUuid, manualMod, circumstanceMod, situationalMods, context }).finalTN;
    const blockTN = currentAvailability.allowed.block
      ? computeTN({
        actor: defender,
        role: "defender",
        defenseType: "block",
        styleUuid,
        manualMod,
        circumstanceMod,
        situationalMods,
        context: {
          ...(context ?? {}),
          blockSource,
          wardSpell
        }
      }).finalTN
      : 0;

    const setTN = (k, val) => {
      const el = root.querySelector(`[data-tn-for="${k}"]`);
      if (el) el.textContent = String(asNumber(val));
    };
    setTN("evade", evadeTN);
    setTN("parry", parryTN);
    setTN("counter", counterTN);
    setTN("block", blockTN);
  }

  function readSelection(root) {
    const manualMod = Number.parseInt(String(root.querySelector('input[name="manualMod"]')?.value ?? "0"), 10) || 0;
    const circumstanceMod = Number.parseInt(String(root.querySelector('select[name="circMod"]')?.value ?? "0"), 10) || 0;
    const applyBlinded = Boolean(root.querySelector('input[name="applyBlinded"]')?.checked);
    const applyDeafened = Boolean(root.querySelector('input[name="applyDeafened"]')?.checked);
    const gladiatorFree = Boolean(root.querySelector('input[name="gladiatorFree"]')?.checked);
    const rawDefenseType = String(root.querySelector('input[name="defenseType"]:checked')?.value ?? "evade");
    const currentAvailability = computeDefenseAvailability({
      attackMode,
      attackerWeaponTraits,
      defenderHasSmallWeapon,
      defenderHasShield: hasEquippedShield(defender),
      defenderHasWard: canUseWardDefense(defender),
      allowedDefenseTypes,
      allowParryRanged
    });
    const defenseType = normalizeDefenseType(rawDefenseType, currentAvailability, "evade");
    const styleUuid = getSelectedStyleUuid();

    if (defenseType === "evade") return { defenseType: "evade", label: t("UESRPG.Chat.Opposed.Evade", "Evade"), manualMod, circumstanceMod, styleUuid: null, applyBlinded, applyDeafened, gladiatorFree };
    if (defenseType === "block") {
      const blockSourceRaw = root.querySelector('select[name="blockSource"]')?.value ?? "shield";
      const blockSource = _normalizeBlockSource(blockSourceRaw, currentAvailability);
      const label = blockSource === "ward" ? t("UESRPG.Chat.Opposed.Ward", "Ward") : t("UESRPG.Chat.Opposed.Block", "Block");
      return { defenseType: "block", blockSource, label, manualMod, circumstanceMod, styleUuid, applyBlinded, applyDeafened, gladiatorFree };
    }
    if (defenseType === "parry") return { defenseType: "parry", label: t("UESRPG.Dialogs.Opposed.Parry", "Parry"), manualMod, circumstanceMod, styleUuid, applyBlinded, applyDeafened, gladiatorFree };
    if (defenseType === "counter") return { defenseType: "counter", label: t("UESRPG.Dialogs.Opposed.CounterAttack", "Counter-Attack"), manualMod, circumstanceMod, styleUuid, applyBlinded, applyDeafened, gladiatorFree };
    return { defenseType: "evade", label: t("UESRPG.Chat.Opposed.Evade", "Evade"), manualMod, circumstanceMod, styleUuid: null, applyBlinded, applyDeafened, gladiatorFree };
  }

  return await customDialog({
    layout: "workflow",
    title: t("UESRPG.Dialogs.Opposed.DefenderResponse", "Defender Response"),
    content,
    classes: ["uesrpg-attack-declare"],
    width: 460,
    buttons: {
      confirm: {
        icon: '<i class="fas fa-check"></i>',
        label: t("UESRPG.UI.Confirm", "Confirm"),
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.element ?? html;
          return readSelection(root);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: t("UESRPG.UI.Cancel", "Cancel"),
        callback: () => null
      }
    },
    defaultButton: "confirm",
    render: (event, html) => {
      const root = html instanceof HTMLElement ? html : html?.element ?? html;
      const checked = root.querySelector('input[name="defenseType"]:checked');
      const value = String(checked?.value ?? "evade");
      const normalized = normalizeDefenseType(value, availability, "evade");
      if (normalized !== value) {
        const normalizedRadio = root.querySelector(`input[name="defenseType"][value="${normalized}"]`);
        if (normalizedRadio) normalizedRadio.checked = true;
      }

      root.querySelector('input[name="manualMod"]')?.addEventListener("change", () => refreshTN(root));
      root.querySelector('select[name="circMod"]')?.addEventListener("change", () => refreshTN(root));
      root.querySelector('input[name="applyBlinded"]')?.addEventListener("change", () => refreshTN(root));
      root.querySelector('input[name="applyDeafened"]')?.addEventListener("change", () => refreshTN(root));
      root.querySelector('select[name="blockSource"]')?.addEventListener("change", () => refreshTN(root));
      for (const radio of root.querySelectorAll('input[name="defenseType"]')) {
        radio.addEventListener("change", () => refreshTN(root));
      }
      refreshTN(root);
    },
  });
}

export const DefenseDialog = {
  show: showDefenseDialog
};
