/**
 * src/core/combat/defense-dialog.js
 *
 * Defender selection dialog for opposed combat.
 *
 * Design goals:
 *  - Deterministic, no inline JS.
 *  - Provides Evade / Parry / Block / Counter-Attack selection.
 *  - Optional Combat Style selection (Parry/Block/Counter) when available.
 *  - Provides Manual Modifier and Combat Circumstance Modifiers inputs.
 *  - Live TN previews for each defense option using module/combat/tn.js computeTN().
 *
 * Uses DialogV2 via customDialog helper.
 */

import { computeTN, listCombatStyles, hasEquippedShield } from "./tn.js";
import { hasCondition } from "../conditions/condition-engine.js";
import { computeDefenseAvailability, normalizeDefenseType } from "./defense-options.js";
import { applySenseLossPenaltyAdjustments } from "../traits/awareness-talents.js";
import { hasActiveWard, getWardBlockRating } from "./ward-defense.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";

function asNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

// ──────────── Content Rendering ────────────

function _renderContent({
  styles,
  defaultStyleUuid,
  defaultDefenseType,
  defaultManualMod,
  defaultCircMod,
  shieldOk,
  availability,
  hasBlinded,
  hasDeafened,
  defaultApplyBlinded,
  defaultApplyDeafened,
  gladiator
}) {
  const styleOptions = styles
    .map(s => `<option value="${s.uuid}" ${s.uuid === defaultStyleUuid ? "selected" : ""}>${Handlebars.escapeExpression(s.name)}</option>`)
    .join("");

  const showStyle = styles.length > 0;

  const allowed = availability?.allowed ?? { evade: true, parry: true, block: Boolean(shieldOk), counter: true, ward: false };
  const reasons = availability?.reasons ?? { evade: [], parry: [], block: [], counter: [], ward: [] };
  const gates = availability?.gates ?? {
    isRangedAttack: false,
    attackerHasFlail: false,
    attackerHasEntangling: false,
    smallVsTwoHandedGate: false,
    shieldOk: Boolean(shieldOk),
    wardOk: false
  };

  const blockDisabled = allowed.block ? "" : "disabled";
  const parryDisabled = allowed.parry ? "" : "disabled";
  const counterDisabled = allowed.counter ? "" : "disabled";
  const wardDisabled = allowed.ward ? "" : "disabled";

  const notes = [];
  if (gates.isRangedAttack) notes.push(`<p class="notes" style="margin:6px 0 0 0;"><b>Ranged:</b> Ranged attacks cannot be parried or counter-attacked.</p>`);
  if (gates.attackerHasFlail) notes.push(`<p class="notes" style="margin:6px 0 0 0;"><b>Flail:</b> Attacks with a flail cannot be parried or counter-attacked.</p>`);
  if (gates.attackerHasEntangling) {
    notes.push(`<p class="notes" style="margin:6px 0 0 0;"><b>Entangling:</b> Attacks with an entangling weapon cannot be parried or blocked.</p>`);
  }
  if (gates.smallVsTwoHandedGate) notes.push(`<p class="notes" style="margin:6px 0 0 0;"><b>Small:</b> A Small weapon cannot be used to Parry or Counter-Attack against a two-handed weapon.</p>`);

  const extraNotes = notes.join("");

  const sensoryRow = (hasBlinded || hasDeafened) ? `
  <div class="form-group" style="margin-top:8px;">
    <label><b>Sensory Impairment</b></label>
    <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
      ${hasBlinded ? `<label style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" name="applyBlinded" ${defaultApplyBlinded ? "checked" : ""} />
        <span>Apply Blinded (-30, sight-based)</span>
      </label>` : ``}
      ${hasDeafened ? `<label style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" name="applyDeafened" ${defaultApplyDeafened ? "checked" : ""} />
        <span>Apply Deafened (-30, hearing-based)</span>
      </label>` : ``}
    </div>
    <p class="notes">Check only if this defense relies primarily on the impaired sense.</p>
  </div>` : ``;

  const gladiatorMode = String(gladiator?.mode ?? "disabled");
  const gladiatorTriggered = Boolean(gladiator?.triggered);
  const gladiatorAvailable = Boolean(gladiator?.available);
  const showGladiator = gladiatorTriggered && gladiatorMode !== "disabled";

  const gladiatorBlock = showGladiator ? `
  <div class="form-group" style="margin-top:8px;">
    <label><b>Gladiator</b></label>
    ${gladiatorMode === "updated"
      ? `
      <label style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" name="gladiatorFree" ${gladiatorAvailable ? "" : "disabled"} />
        <span>Gladiator: Make this defense free (1/round)</span>
      </label>
      ${gladiatorAvailable ? `` : `<p class="notes">Already used this round.</p>`}
      `
      : `
      <p class="notes">${gladiatorAvailable ? "Gladiator: This defense is free (1/round)." : "Gladiator: Already used this round."}</p>
      `}
  </div>` : ``;

  return `
<div class="uesrpg defense-dialog">
  <div class="form-group">
    <label><b>Manual Modifier</b></label>
    <input type="number" name="manualMod" value="${asNumber(defaultManualMod)}" step="1" />
  </div>

  <div class="form-group">
    <label><b>Combat Circumstance Modifiers</b></label>
    <select name="circMod" style="width: 100%;">
      <option value="0" ${Number(defaultCircMod) === 0 ? "selected" : ""}>—</option>
      <option value="-10" ${Number(defaultCircMod) === -10 ? "selected" : ""}>Minor Disadvantage (-10)</option>
      <option value="-20" ${Number(defaultCircMod) === -20 ? "selected" : ""}>Disadvantage (-20)</option>
      <option value="-30" ${Number(defaultCircMod) === -30 ? "selected" : ""}>Major Disadvantage (-30)</option>
    </select>
  </div>

  ${sensoryRow}

  ${gladiatorBlock}

  ${showStyle ? `
  <div class="form-group">
    <label><b>Combat Style</b></label>
    <select name="styleUuid" style="width: 100%;">
      ${styleOptions}
    </select>
    <p class="notes">Used for Parry, Block, and Counter-Attack.</p>
  </div>` : ``}

  <hr/>

  <div class="defense-grid" style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
    <label class="def-opt">
      <input type="radio" name="defenseType" value="evade" ${defaultDefenseType === "evade" ? "checked" : ""}/>
      <div class="def-opt__card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span><b>Evade</b></span>
          <span class="tn-pill" style="font-variant-numeric: tabular-nums;">TN: <span data-tn-for="evade">\u2014</span></span>
        </div>
      </div>
    </label>

    <label class="def-opt" style="opacity:${parryDisabled ? "0.45" : "1"};">
      <input type="radio" name="defenseType" value="parry" ${defaultDefenseType === "parry" ? "checked" : ""} ${parryDisabled}/>
      <div class="def-opt__card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span><b>Parry</b></span>
          <span class="tn-pill" style="font-variant-numeric: tabular-nums;">TN: <span data-tn-for="parry">\u2014</span></span>
        </div>
        ${parryDisabled ? `<p class="notes">Not available for this attack.</p>` : ``}
      </div>
    </label>

    <label class="def-opt" style="opacity:${blockDisabled ? "0.45" : "1"};">
      <input type="radio" name="defenseType" value="block" ${defaultDefenseType === "block" ? "checked" : ""} ${blockDisabled}/>
      <div class="def-opt__card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span><b>Block</b></span>
          <span class="tn-pill" style="font-variant-numeric: tabular-nums;">TN: <span data-tn-for="block">\u2014</span></span>
        </div>
        ${blockDisabled ? `<p class="notes">${Handlebars.escapeExpression(String(reasons?.block?.[0] ?? "Not available for this attack."))}</p>` : ``}
      </div>
    </label>

    <label class="def-opt" style="opacity:${counterDisabled ? "0.45" : "1"};">
      <input type="radio" name="defenseType" value="counter" ${defaultDefenseType === "counter" ? "checked" : ""} ${counterDisabled}/>
      <div class="def-opt__card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span><b>Counter-Attack</b></span>
          <span class="tn-pill" style="font-variant-numeric: tabular-nums;">TN: <span data-tn-for="counter">\u2014</span></span>
        </div>
        ${counterDisabled ? `<p class="notes">Not available for this attack.</p>` : ``}
      </div>
    </label>

    <label class="def-opt" style="opacity:${wardDisabled ? "0.45" : "1"}; grid-column: span 2;">
      <input type="radio" name="defenseType" value="ward" ${defaultDefenseType === "ward" ? "checked" : ""} ${wardDisabled}/>
      <div class="def-opt__card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span><b>Ward</b></span>
          <span class="tn-pill" style="font-variant-numeric: tabular-nums;">TN: <span data-tn-for="ward">\u2014</span></span>
        </div>
        ${wardDisabled ? `<p class="notes">${Handlebars.escapeExpression(String(reasons?.ward?.[0] ?? "Requires an active Ward spell."))}</p>` : `<p class="notes">Spell acts as shield. BR = Spell Strength. Power Block incompatible.</p>`}
      </div>
    </label>
  </div>

  ${extraNotes}
</div>`;
}

// ──────────── Main Dialog Function ────────────

/**
 * Show the defense dialog for a defender actor.
 * @param {Actor} defender
 * @param {object} options
 * @returns {Promise<object|null>} Selected defense options or null if canceled.
 */
export async function showDefenseDialog(defender, options = {}) {
  const styles = listCombatStyles(defender);
  const defaultStyleUuid = options.defaultStyleUuid ?? styles?.[0]?.uuid ?? null;
  const requestedDefaultDefenseType = options.defaultDefenseType ?? "evade";
  const defaultManualMod = Number(options.defaultManualMod ?? 0) || 0;
  const defaultCircMod = Number(options.defaultCircumstanceMod ?? 0) || 0;

  const shieldOk = hasEquippedShield(defender);
  const wardOk = hasActiveWard(defender);

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

  const defaultDefenseType = normalizeDefenseType(requestedDefaultDefenseType, availability, "evade");

  const gladiator = options.gladiator ?? null;
  const context = options.context ?? undefined;

  const content = _renderContent({
    styles,
    defaultStyleUuid,
    defaultDefenseType,
    defaultManualMod,
    defaultCircMod,
    shieldOk,
    availability,
    hasBlinded,
    hasDeafened,
    defaultApplyBlinded,
    defaultApplyDeafened,
    gladiator
  });

  // ── Closure helpers (capture defender, attackMode, etc. from outer scope) ──

  function getSelectedStyleUuid(root) {
    const styleSelect = root.querySelector('select[name="styleUuid"]');
    if (!styleSelect) return null;
    return styleSelect.value ? String(styleSelect.value) : null;
  }

  function refreshTN(root) {
    const currentShieldOk = hasEquippedShield(defender);
    const currentWardOk = hasActiveWard(defender);
    const currentAvailability = computeDefenseAvailability({
      attackMode,
      attackerWeaponTraits,
      defenderHasSmallWeapon,
      defenderHasShield: currentShieldOk,
      defenderHasWard: currentWardOk,
      allowParryRanged
    });

    const blockRadio = root.querySelector('input[name="defenseType"][value="block"]');
    if (blockRadio) blockRadio.disabled = !currentAvailability.allowed.block;

    const parryRadio = root.querySelector('input[name="defenseType"][value="parry"]');
    if (parryRadio) parryRadio.disabled = !currentAvailability.allowed.parry;

    const counterRadio = root.querySelector('input[name="defenseType"][value="counter"]');
    if (counterRadio) counterRadio.disabled = !currentAvailability.allowed.counter;

    const wardRadio = root.querySelector('input[name="defenseType"][value="ward"]');
    if (wardRadio) wardRadio.disabled = !currentAvailability.allowed.ward;

    // If the currently selected option becomes illegal, force fallback.
    const checked = root.querySelector('input[name="defenseType"]:checked');
    const v = String(checked?.value ?? "evade");
    const normalized = normalizeDefenseType(v, currentAvailability, "evade");
    if (normalized !== v) {
      const normalizedRadio = root.querySelector(`input[name="defenseType"][value="${normalized}"]`);
      if (normalizedRadio) normalizedRadio.checked = true;
    }

    const rawMod = root.querySelector('input[name="manualMod"]')?.value ?? "0";
    const manualMod = Number.parseInt(String(rawMod), 10) || 0;

    const rawCirc = root.querySelector('select[name="circMod"]')?.value ?? "0";
    const circumstanceMod = Number.parseInt(String(rawCirc), 10) || 0;

    const applyBlinded = Boolean(root.querySelector('input[name="applyBlinded"]')?.checked);
    const applyDeafened = Boolean(root.querySelector('input[name="applyDeafened"]')?.checked);
    const situationalMods = [];
    if (applyBlinded && hasCondition(defender, "blinded")) {
      situationalMods.push({ key: "blinded", conditionKey: "blinded", label: "Blinded (sight)", value: -30, source: "sense-loss" });
    }
    if (applyDeafened && hasCondition(defender, "deafened")) {
      situationalMods.push({ key: "deafened", conditionKey: "deafened", label: "Deafened (hearing)", value: -30, source: "sense-loss" });
    }
    applySenseLossPenaltyAdjustments(situationalMods, defender);

    const styleUuid = getSelectedStyleUuid(root);

    const evadeTN = computeTN({ actor: defender, role: "defender", defenseType: "evade", manualMod, circumstanceMod, situationalMods, context }).finalTN;
    const parryTN = computeTN({ actor: defender, role: "defender", defenseType: "parry", styleUuid, manualMod, circumstanceMod, situationalMods, context }).finalTN;
    const counterTN = computeTN({ actor: defender, role: "defender", defenseType: "counter", styleUuid, manualMod, circumstanceMod, situationalMods, context }).finalTN;
    const blockTN = currentAvailability.allowed.block
      ? computeTN({ actor: defender, role: "defender", defenseType: "block", styleUuid, manualMod, circumstanceMod, situationalMods, context }).finalTN
      : 0;
    // Ward uses the same TN as Block (Combat Style/Profession based).
    const wardTN = currentAvailability.allowed.ward
      ? computeTN({ actor: defender, role: "defender", defenseType: "block", styleUuid, manualMod, circumstanceMod, situationalMods, context }).finalTN
      : 0;

    const setTN = (k, val) => {
      const el = root.querySelector(`[data-tn-for="${k}"]`);
      if (el) el.textContent = String(asNumber(val));
    };
    setTN("evade", evadeTN);
    setTN("parry", parryTN);
    setTN("counter", counterTN);
    setTN("block", blockTN);
    setTN("ward", wardTN);
  }

  function readSelection(root) {
    const rawMod = root.querySelector('input[name="manualMod"]')?.value ?? "0";
    const manualMod = Number.parseInt(String(rawMod), 10) || 0;

    const rawCirc = root.querySelector('select[name="circMod"]')?.value ?? "0";
    const circumstanceMod = Number.parseInt(String(rawCirc), 10) || 0;

    const applyBlinded = Boolean(root.querySelector('input[name="applyBlinded"]')?.checked);
    const applyDeafened = Boolean(root.querySelector('input[name="applyDeafened"]')?.checked);
    const gladiatorFree = Boolean(root.querySelector('input[name="gladiatorFree"]')?.checked);

    const rawDefenseType = String(root.querySelector('input[name="defenseType"]:checked')?.value ?? "evade");
    const currentShieldOk = hasEquippedShield(defender);
    const currentWardOk = hasActiveWard(defender);
    const currentAvailability = computeDefenseAvailability({
      attackMode,
      attackerWeaponTraits,
      defenderHasSmallWeapon,
      defenderHasShield: currentShieldOk,
      defenderHasWard: currentWardOk,
      allowParryRanged
    });
    const defenseType = normalizeDefenseType(rawDefenseType, currentAvailability, "evade");
    const styleUuid = getSelectedStyleUuid(root);

    if (defenseType === "evade") return { defenseType: "evade", label: "Evade", manualMod, circumstanceMod, styleUuid: null, applyBlinded, applyDeafened, gladiatorFree };
    if (defenseType === "block") return { defenseType: "block", label: "Block", manualMod, circumstanceMod, styleUuid, applyBlinded, applyDeafened, gladiatorFree };
    if (defenseType === "ward") return { defenseType: "ward", label: "Ward", manualMod, circumstanceMod, styleUuid, applyBlinded, applyDeafened, gladiatorFree };
    if (defenseType === "parry") return { defenseType: "parry", label: "Parry", manualMod, circumstanceMod, styleUuid, applyBlinded, applyDeafened, gladiatorFree };
    if (defenseType === "counter") return { defenseType: "counter", label: "Counter", manualMod, circumstanceMod, styleUuid, applyBlinded, applyDeafened, gladiatorFree };

    return { defenseType: "evade", label: "Evade", manualMod, circumstanceMod, styleUuid: null, applyBlinded, applyDeafened, gladiatorFree };
  }

  // ── Show dialog ──

  return await customDialog({
    title: "Defender Response",
    content,
    classes: ["uesrpg-attack-declare"],
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

      // If the default defense type is not allowed, force a safe fallback.
      const checked = root.querySelector('input[name="defenseType"]:checked');
      const v = String(checked?.value ?? "evade");
      const normalized = normalizeDefenseType(v, availability, "evade");
      if (normalized !== v) {
        const normalizedRadio = root.querySelector(`input[name="defenseType"][value="${normalized}"]`);
        if (normalizedRadio) normalizedRadio.checked = true;
      }

      const styleSelect = root.querySelector('select[name="styleUuid"]');
      if (styleSelect) styleSelect.addEventListener("change", () => refreshTN(root));

      const manualInput = root.querySelector('input[name="manualMod"]');
      if (manualInput) manualInput.addEventListener("change", () => refreshTN(root));

      const circSelect = root.querySelector('select[name="circMod"]');
      if (circSelect) circSelect.addEventListener("change", () => refreshTN(root));

      const blindCb = root.querySelector('input[name="applyBlinded"]');
      if (blindCb) blindCb.addEventListener("change", () => refreshTN(root));
      const deafCb = root.querySelector('input[name="applyDeafened"]');
      if (deafCb) deafCb.addEventListener("change", () => refreshTN(root));

      for (const r of root.querySelectorAll('input[name="defenseType"]')) {
        r.addEventListener("change", () => refreshTN(root));
      }

      refreshTN(root);
    },
  });
}

/** Backward-compatible class-style API wrapper. */
export const DefenseDialog = {
  show: showDefenseDialog
};
