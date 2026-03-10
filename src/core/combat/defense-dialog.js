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

function asNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function _renderDefenseChoice({ value, title, checked, disabled, tnKey, desc = "", fullWidth = false, extraHtml = "" } = {}) {
  return `
    <label class="uesrpg-adv-choice def-opt ${disabled ? "is-disabled" : ""} ${fullWidth ? "uesrpg-defense-grid__full" : ""}">
      <input type="radio" name="defenseType" value="${value}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}/>
      <span class="uesrpg-adv-choice__label def-opt__card">
        <span class="uesrpg-defense-card__head">
          <span class="uesrpg-adv-choice__title">${title}</span>
          <span class="tn-pill">TN: <span data-tn-for="${tnKey}">\u2014</span></span>
        </span>
        ${desc ? `<span class="uesrpg-adv-choice__desc">${Handlebars.escapeExpression(String(desc))}</span>` : ``}
        ${extraHtml || ""}
      </span>
    </label>
  `;
}

function _renderBlockSourceSelect({ show, shieldOk, wardOk, defaultBlockSource = "shield", disabled = false } = {}) {
  if (!show) return "";
  const selected = (defaultBlockSource === "ward" && wardOk) ? "ward" : "shield";
  return `
    <span class="uesrpg-adv-choice__desc" style="display:block; margin-top:6px;">
      <label style="display:flex; align-items:center; gap:8px;">
        <span>Source</span>
        <select name="blockSource" ${disabled ? "disabled" : ""} style="min-width:120px;">
          ${shieldOk ? `<option value="shield" ${selected === "shield" ? "selected" : ""}>Shield</option>` : ""}
          ${wardOk ? `<option value="ward" ${selected === "ward" ? "selected" : ""}>Ward</option>` : ""}
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

  const notes = [];
  if (gates.isRangedAttack) notes.push(`<p class="notes" style="margin:6px 0 0 0;"><b>Ranged:</b> Ranged attacks cannot be parried or counter-attacked.</p>`);
  if (gates.attackerHasFlail) notes.push(`<p class="notes" style="margin:6px 0 0 0;"><b>Flail:</b> Attacks with a flail cannot be parried or counter-attacked.</p>`);
  if (gates.attackerHasEntangling) notes.push(`<p class="notes" style="margin:6px 0 0 0;"><b>Entangling:</b> Attacks with an entangling weapon cannot be parried or blocked.</p>`);
  if (gates.smallVsTwoHandedGate) notes.push(`<p class="notes" style="margin:6px 0 0 0;"><b>Small:</b> A Small weapon cannot be used to Parry or Counter-Attack against a two-handed weapon.</p>`);

  const sensoryFlags = [
    hasBlinded ? `<label class="uesrpg-inline-check"><input type="checkbox" name="applyBlinded" ${defaultApplyBlinded ? "checked" : ""} /> <span>Blinded (-30, sight-based)</span></label>` : ``,
    hasDeafened ? `<label class="uesrpg-inline-check"><input type="checkbox" name="applyDeafened" ${defaultApplyDeafened ? "checked" : ""} /> <span>Deafened (-30, hearing-based)</span></label>` : ``
  ].filter(Boolean);
  const sensoryRow = sensoryFlags.length ? `
  <div class="uesrpg-defense-flags">
    <span class="uesrpg-defense-flags__label">Apply if relevant:</span>
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
    <span class="uesrpg-defense-flags__label">Gladiator</span>
    <div class="uesrpg-defense-flags__items">
      ${gladiatorMode === "updated"
        ? `
        <label class="uesrpg-inline-check">
          <input type="checkbox" name="gladiatorFree" ${gladiatorAvailable ? "" : "disabled"} />
          <span>Make this defense free (1/round)</span>
        </label>
        ${gladiatorAvailable ? `` : `<span class="uesrpg-sensory-hint">Already used this round.</span>`}
        `
        : `
        <span class="uesrpg-sensory-hint">${gladiatorAvailable ? "This defense is free (1/round)." : "Already used this round."}</span>
        `}
    </div>
  </div>` : ``;

  return `
<div class="uesrpg defense-dialog uesrpg-adv-dialog uesrpg-adv-dialog--defense">
  <div class="uesrpg-dialog-section-header">Defense Response</div>
  <div class="uesrpg-adv-grid uesrpg-defense-grid">
    ${_renderDefenseChoice({
      value: "evade",
      title: "Evade",
      checked: defaultDefenseType === "evade",
      disabled: false,
      tnKey: "evade"
    })}
    ${_renderDefenseChoice({
      value: "parry",
      title: "Parry",
      checked: defaultDefenseType === "parry",
      disabled: !allowed.parry,
      tnKey: "parry",
      desc: allowed.parry ? "" : (reasons?.parry?.[0] ?? "Not available for this attack.")
    })}
    ${_renderDefenseChoice({
      value: "block",
      title: "Block",
      checked: defaultDefenseType === "block",
      disabled: !allowed.block,
      tnKey: "block",
      desc: allowed.block ? "" : (reasons?.block?.[0] ?? "Not available for this attack."),
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
      title: "Counter-Attack",
      checked: defaultDefenseType === "counter",
      disabled: !allowed.counter,
      tnKey: "counter",
      desc: allowed.counter ? "" : (reasons?.counter?.[0] ?? "Not available for this attack.")
    })}
  </div>

  <div class="form-group">
    <label><b>Circumstance Modifier</b></label>
    <select name="circMod" style="width: 100%;">
      ${buildCircumstanceOptionsHtml(defaultCircMod)}
    </select>
  </div>

  <div class="form-group">
    <label><b>Manual Modifier</b></label>
    <input type="number" name="manualMod" value="${asNumber(defaultManualMod)}" step="1" />
  </div>

  ${sensoryRow}
  ${gladiatorBlock}
  ${notes.join("")}
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
      allowedDefenseTypes,
      allowParryRanged
    });

    for (const name of ["block", "parry", "counter"]) {
      const radio = root.querySelector(`input[name="defenseType"][value="${name}"]`);
      if (radio) radio.disabled = !currentAvailability.allowed[name];
      const opt = radio?.closest(".def-opt");
      if (opt) opt.classList.toggle("is-disabled", Boolean(radio?.disabled));
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

    if (defenseType === "evade") return { defenseType: "evade", label: "Evade", manualMod, circumstanceMod, styleUuid: null, applyBlinded, applyDeafened, gladiatorFree };
    if (defenseType === "block") {
      const blockSourceRaw = root.querySelector('select[name="blockSource"]')?.value ?? "shield";
      const blockSource = _normalizeBlockSource(blockSourceRaw, currentAvailability);
      const label = blockSource === "ward" ? "Ward" : "Block";
      return { defenseType: "block", blockSource, label, manualMod, circumstanceMod, styleUuid, applyBlinded, applyDeafened, gladiatorFree };
    }
    if (defenseType === "parry") return { defenseType: "parry", label: "Parry", manualMod, circumstanceMod, styleUuid, applyBlinded, applyDeafened, gladiatorFree };
    if (defenseType === "counter") return { defenseType: "counter", label: "Counter", manualMod, circumstanceMod, styleUuid, applyBlinded, applyDeafened, gladiatorFree };
    return { defenseType: "evade", label: "Evade", manualMod, circumstanceMod, styleUuid: null, applyBlinded, applyDeafened, gladiatorFree };
  }

  return await customDialog({
    title: "Defender Response",
    content,
    classes: ["uesrpg-attack-declare"],
    width: 460,
    buttons: {
      confirm: {
        icon: '<i class="fas fa-check"></i>',
        label: "Confirm",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.element ?? html;
          return readSelection(root);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel",
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
