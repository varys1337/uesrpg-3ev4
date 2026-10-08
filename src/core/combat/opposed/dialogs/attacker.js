import { systemTooltipAttributes, setSystemOptionTooltip, setSystemTooltip } from "../../../../ui/shared/system-tooltips.js";
import { buildCombatOptionTooltipText } from "../../../../data/tooltips/index.js";
import { renderTNPill, updateTNPill } from "../../../../ui/shared/tn-presentation.js";
import { renderAdvantageChoices, readAdvantageChoices, bindAdvantageChoices, getAdvantageChoiceLimit, isAdvantageSelectionValid } from "./advantage-options.js";
import { escapeHtml as _escapeHtml } from '../../../../utils/html.js';
/**
 * src/core/combat/opposed/dialogs/attacker.js
 *
 * Attacker-side dialog functions for opposed combat workflow.
 * Extracted from monolith (Phase 11) to improve modularity and performance.
 *
 * Exported functions:
 * - attackerDeclareDialog: Attack options dialog (variant, weapon, modifiers)
 * - promptWeaponAndAdvantages: Damage resolution dialog (weapon selection + advantage spending)
 */

import { hasCondition } from "../../../conditions/condition-engine.js";

import { buildSpecialActionsForActor } from "../../combat-style-utils.js";
import { hasTalent } from "../../../traits/talents-api.js";
import { 
  getContextAttackMode, 
  canUseExploitAdvantage as _canUseExploitAdvantage,
  getPendingAttackApCost,
  collectAttackerDeclarationModifiers,
  getTokenMovementAction,
  getPreferredWeaponUuid as _getPreferredWeaponUuid
} from "../helpers/workflow.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";

import { bindItemDescriptionTooltips, clearItemDescriptionTooltip } from "../../../../ui/sheets/v2/shared/sheet-tooltips.js";
import { buildCircumstanceOptionsHtml } from "../../../opposed/circumstance.js";
import { t, tf } from "../../../../utils/i18n.js";
import { isActorInStartedCombatEncounter } from "../../combat-scope.js";
import { computeTN } from "../../tn.js";
import { _resolveItemViaActor } from "../helpers/docs.js";
import { computeRangedRangeContext } from "../helpers/combat.js";
import { getWeaponCombatCapabilities } from "../../combat-utils.js";
import { applyLengthPenaltyToTN } from "../../../homebrew/reach-length/weapon.js";


const HIT_LOCATION_KEYS = Object.freeze({
  Head: "Head",
  Body: "Body",
  "Right Arm": "RightArm",
  "Left Arm": "LeftArm",
  "Right Leg": "RightLeg",
  "Left Leg": "LeftLeg",
});

function _hitLocationLabel(location) {
  const key = HIT_LOCATION_KEYS[location] ?? "Body";
  return t(`UESRPG.Sheets.Item.HitLocation.${key}`, location);
}

/**
 * Display attacker's attack declaration dialog.
 * Returns selected options or null if canceled.
 */
export async function attackerDeclareDialog(attackerActor, attackerLabel, { styles = [], selectedStyleUuid = null, defaultWeaponUuid = null,
    defaultVariant = "normal", defaultManual = 0, defaultCirc = 0, attackerToken = null, defenderToken = null,
    defenderActor = null, opposedData = null, prepaidBaseAttackAP = false } = {}) {
  const showStyleSelect = Array.isArray(styles) && styles.length >= 2;
  const showEyeOfNight = Boolean(attackerActor && hasTalent(attackerActor, "eyeofnight") && hasCondition(attackerActor, "hidden"));
  const hasThunderCharge = Boolean(attackerActor && hasTalent(attackerActor, "thundercharge"));

  // Weapon selection is required for deterministic weapon-quality automation (range bands, flail gating, etc.).
  const equippedWeapons = _listEquippedWeapons(attackerActor);
  const preferredWeaponUuid = String(defaultWeaponUuid ?? "").trim()
    || _getPreferredWeaponUuid(attackerActor, { meleeOnly: false })
    || (equippedWeapons[0]?.uuid ?? "");

  const weaponSelect = (equippedWeapons.length >= 2)
    ? `
      <div class="form-group">
        <label>${t("UESRPG.Dialogs.Opposed.Weapon", "Weapon")}</label>
        <select name="weaponUuid">
          ${equippedWeapons.map(w => {
            const sel = (w.uuid === preferredWeaponUuid) ? "selected" : "";
            return `<option value="${w.uuid}" ${sel}>${_escapeHtml(w.name)}</option>`;
          }).join("\n")}
        </select>
      </div>
    `
    : `<input type="hidden" name="weaponUuid" value="${preferredWeaponUuid}" />`;

  const styleSelect = showStyleSelect
    ? `
      <div class="form-group">
        <label>${t("UESRPG.Sheets.Item.CombatStyle", "Combat Style")}</label>
        <select name="styleUuid">
          ${styles.map(s => {
            const sel = (s.uuid === selectedStyleUuid) ? "selected" : "";
            return `<option value="${s.uuid}" ${sel}>${_escapeHtml(s.name)}</option>`;
          }).join("\n")}
        </select>
      </div>
    `
    : `<input type="hidden" name="styleUuid" value="${selectedStyleUuid ?? ""}" />`;

  const allowedLocs = ["Head", "Body", "Right Arm", "Left Arm", "Right Leg", "Left Leg"];
  const safeDefaultLoc = "Body";
  const locOptions = allowedLocs.map(l => {
    const sel = l === safeDefaultLoc ? "selected" : "";
    return `<option value="${l}" ${sel}>${_escapeHtml(_hitLocationLabel(l))}</option>`;
  }).join("\n");


  const hasBlinded = hasCondition(attackerActor, "blinded");
  const hasDeafened = hasCondition(attackerActor, "deafened");
  const sensoryControls = (hasBlinded || hasDeafened) ? `
    <div class="uesrpg-sensory-section">
      ${hasBlinded ? `<label class="uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: buildCombatOptionTooltipText("blinded") })}><input type="checkbox" name="applyBlinded" checked/> <span class="uesrpg-adv-choice__label">${t("UESRPG.Dialogs.Opposed.BlindedShort", "Blinded (-30)")}</span></label>` : ""}
      ${hasDeafened ? `<label class="uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: buildCombatOptionTooltipText("deafened") })}><input type="checkbox" name="applyDeafened" checked/> <span class="uesrpg-adv-choice__label">${t("UESRPG.Dialogs.Opposed.DeafenedShort", "Deafened (-30)")}</span></label>` : ""}
    </div>` : "";

  const content = `
  <div class="uesrpg-attack-declare uesrpg-dialog-stack uesrpg-adv-dialog uesrpg-adv-dialog--attacker uesrpg-adv-dialog--choice-bars">
    ${styleSelect}
    ${weaponSelect}
    <div class="uesrpg-dialog-section-header">${t("UESRPG.Dialogs.Opposed.AttackVariation", "Attack Variation")}</div>
    <div class="uesrpg-adv-grid uesrpg-attack-grid">
      <div class="uesrpg-adv-choice-group">
      <label class="uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: buildCombatOptionTooltipText("attack") })}>
        <input type="radio" name="attackVariant" value="normal" ${defaultVariant === "normal" ? "checked" : ""} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-choice-card__head"><span class="uesrpg-adv-choice__title">${t("UESRPG.Chat.Opposed.Attack", "Attack")}</span>${renderTNPill("normal")}</span>
        </span>
      </label>
      </div>
      <div class="uesrpg-adv-choice-group">
      <label class="uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: buildCombatOptionTooltipText("allOut") })}>
        <input type="radio" name="attackVariant" value="allOut" ${defaultVariant === "allOut" ? "checked" : ""} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-choice-card__head"><span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.AllOutAttack", "All Out Attack")}</span>${renderTNPill("allOut")}</span>
        </span>
      </label>
          ${hasThunderCharge ? `
            <div class="uesrpg-adv-inline ps-location ${defaultVariant === "allOut" ? "" : "disabled"}">
              <label class="uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: buildCombatOptionTooltipText("thunderCharge") })}>
                <input type="checkbox" name="thunderChargeToggle" ${defaultVariant === "allOut" ? "" : "disabled"} />
                <span class="uesrpg-adv-choice__label">${t("UESRPG.Dialogs.Opposed.ThunderousChargeShort", "Thunderous Charge (-1 AP)")}</span>
              </label>
            </div>
          ` : ""}
      </div>
      <div class="uesrpg-adv-choice-group uesrpg-precision-option">
      <label class="uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: buildCombatOptionTooltipText("precisionAttack") })}>
        <input type="radio" name="attackVariant" value="precision" ${defaultVariant === "precision" ? "checked" : ""} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-choice-card__head"><span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.PrecisionStrike", "Precision Strike")}</span>${renderTNPill("precision")}</span>
        </span>
      </label>
          <div class="uesrpg-adv-inline ps-location ${defaultVariant === "precision" ? "" : "disabled"}">
            <select name="precisionLocation" aria-label="${t("UESRPG.UI.HitLocation", "Hit location")}" ${defaultVariant === "precision" ? "" : "disabled"}>
              ${locOptions}
            </select>
          </div>
      </div>
      <div class="uesrpg-adv-choice-group uesrpg-coup-option">
      <label class="uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: buildCombatOptionTooltipText("coup") })}>
        <input type="radio" name="attackVariant" value="coup" ${defaultVariant === "coup" ? "checked" : ""} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-choice-card__head"><span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.CoupDeGrace", "Coup de Grace")}</span>${renderTNPill("coup")}</span>
        </span>
      </label>
          <div class="uesrpg-adv-inline coup-mode ${defaultVariant === "coup" ? "" : "disabled"}">
            <select name="coupMode" aria-label="${t("UESRPG.Dialogs.Opposed.CoupMode", "Coup de Grace outcome")}" ${defaultVariant === "coup" ? "" : "disabled"} ${systemTooltipAttributes({ text: buildCombatOptionTooltipText("coup") })}>
              <option value="lethal">${t("UESRPG.Dialogs.Opposed.CoupLethalShort", "Lethal")}</option>
              <option value="nonlethal">${t("UESRPG.Dialogs.Opposed.CoupNonLethalShort", "Non-Lethal")}</option>
            </select>
          </div>
      </div>
    </div>

    ${showEyeOfNight ? `
    <div class="uesrpg-eon-section">
      <label class="uesrpg-adv-choice uesrpg-choice-bar" ${systemTooltipAttributes({ text: buildCombatOptionTooltipText("eyeOfNight") })}>
        <input type="checkbox" name="eyeOfNight" />
        <span class="uesrpg-adv-choice__label">${t("UESRPG.Dialogs.Opposed.EyeOfNightShort", "Eye of Night (Precision)")}</span>
      </label>
    </div>` : ""}

    <div class="form-group">
      <label>${t("UESRPG.Dialogs.Opposed.CircumstanceModifier", "Circumstance Modifier")}</label>
      <select name="circMod">
        ${buildCircumstanceOptionsHtml(defaultCirc)}
      </select>
    </div>
    <div class="form-group">
      <label>${t("UESRPG.Chat.Common.ManualModifier", "Manual modifier")}</label>
      <input name="manualMod" type="number" value="${Number(defaultManual) || 0}" />
    </div>
  
    ${sensoryControls}
</div>
`;

    return await customDialog({
      layout: "workflow",
      title: tf("UESRPG.Dialogs.Opposed.AttackOptionsTitle", { label: attackerLabel }, `${attackerLabel} - Attack Options`),
      content,
      buttons: {
        ok: {
          label: t("UESRPG.UI.Continue", "Continue"),
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.element ?? html;
            if (!root) {
              return null;
            }
            
            const styleUuid = root.querySelector('select[name="styleUuid"]')?.value
              ?? root.querySelector('input[name="styleUuid"]')?.value
              ?? "";
            const weaponUuid = root.querySelector('select[name="weaponUuid"]')?.value
              ?? root.querySelector('input[name="weaponUuid"]')?.value
              ?? "";
            const variant = root.querySelector('input[name="attackVariant"]:checked')?.value ?? "normal";
            const raw = root.querySelector('input[name="manualMod"]')?.value ?? "0";
            const manualMod = Number.parseInt(String(raw), 10) || 0;
            const rawCirc = root.querySelector('select[name="circMod"]')?.value ?? "0";
            const circumstanceMod = Number.parseInt(String(rawCirc), 10) || 0;
            const precisionLocation = root.querySelector('select[name="precisionLocation"]')?.value ?? safeDefaultLoc;
            const applyBlinded = Boolean(root.querySelector('input[name="applyBlinded"]')?.checked);
            const applyDeafened = Boolean(root.querySelector('input[name="applyDeafened"]')?.checked);
            const eyeOfNight = Boolean(root.querySelector('input[name="eyeOfNight"]')?.checked);
            const thunderChargeToggle = Boolean(root.querySelector('input[name="thunderChargeToggle"]')?.checked);
            const coupMode = root.querySelector('select[name="coupMode"]')?.value ?? "lethal";

            // AP calculation - will be validated and Thunder Charge applied in workflow
            const apCost = (variant === "allOut") ? 1 : 0;
            const totalApCost = getPendingAttackApCost({
              mode: "attack",
              context: {
                isFreeActionAttack: false,
                activationPrepaidBaseAttackAP: prepaidBaseAttackAP === true
              }
            }, { extraApCost: apCost });

            const ap = Number(foundry.utils.getProperty(attackerActor, "system.action_points.value") ?? 0);
            const tokenUuid = attackerToken?.document?.uuid ?? attackerToken?.uuid ?? null;
            if (isActorInStartedCombatEncounter(attackerActor, { tokenUuid }) && (!Number.isFinite(ap) || ap < totalApCost)) {
              ui.notifications?.warn?.(tf("UESRPG.Notifications.Opposed.NotEnoughApAttack", { cost: totalApCost }, `Not enough Action Points to perform this attack (requires ${totalApCost} AP).`));
              return null;
            }

            return {
              styleUuid,
              weaponUuid,
              variant,
              manualMod,
              circumstanceMod,
              precisionLocation,
              apCost,
              applyBlinded,
              applyDeafened,
              eyeOfNight,
              thunderChargeToggle,
              thunderChargeApplied: false,  // Will be computed in workflow
              coupMode
            };
          }
        },
        cancel: {
          label: t("UESRPG.UI.Cancel", "Cancel"),
          callback: () => null
        }
      },
      defaultButton: "ok",
      classes: ["uesrpg-attack-declare"],
      width: 460,
      render: (event, html) => {
      const root = html instanceof HTMLElement ? html : html?.element ?? html;
      const form = root?.querySelector(".uesrpg-attack-declare") ?? root;
      if (!form) return;

      const psSelect = form.querySelector('select[name="precisionLocation"]');
      const psWrap = form.querySelector('.uesrpg-precision-option .ps-location');
      const eon = form.querySelector('input[name="eyeOfNight"]');
      const thunderToggle = form.querySelector('input[name="thunderChargeToggle"]');
      const thunderWrap = thunderToggle?.closest(".ps-location");
      const coupWrap = form.querySelector('.uesrpg-coup-option .coup-mode');
      const coupSelect = form.querySelector('select[name="coupMode"]');
      const refreshCoupTooltip = () => {
        if (!coupSelect) return;
        const modeText = coupSelect.value === "nonlethal"
          ? t("UESRPG.Dialogs.Opposed.CoupNonLethal", "Non-Lethal (-1 Stamina, +1 Fatigue)")
          : t("UESRPG.Dialogs.Opposed.CoupLethal", "Lethal (HP -> 0)");
        setSystemTooltip(coupSelect, { text: buildCombatOptionTooltipText("coup", modeText) });
      };
      coupSelect?.addEventListener("change", refreshCoupTooltip);

      const refreshTN = () => {
        const defender = defenderActor ?? defenderToken?.actor ?? null;
        const styleUuid = form.querySelector('[name="styleUuid"]')?.value ?? selectedStyleUuid;
        const weaponUuid = form.querySelector('[name="weaponUuid"]')?.value ?? preferredWeaponUuid;
        const weapon = _resolveItemViaActor(weaponUuid, attackerActor);
        const attackMode = getContextAttackMode(opposedData?.context);
        const rangeContext = attackMode === "ranged"
          ? computeRangedRangeContext({ attackerToken, defenderToken, weapon }) : null;
        const context = {
          opponentUuid: defender?.uuid ?? null,
          opponentActor: defender,
          opponentTokenUuid: defenderToken?.document?.uuid ?? opposedData?.defender?.tokenUuid ?? null,
          actorTokenUuid: attackerToken?.document?.uuid ?? opposedData?.attacker?.tokenUuid ?? null,
          opponentSize: defender?.system?.size ?? null,
          selfSize: attackerActor?.system?.size ?? null,
          attackMode, itemUuid: weaponUuid,
          movementAction: getTokenMovementAction(attackerToken), rangeContext,
        };
        const manualMod = Number.parseInt(form.querySelector('[name="manualMod"]')?.value, 10) || 0;
        const circumstanceMod = Number.parseInt(form.querySelector('[name="circMod"]')?.value, 10) || 0;
        for (const variant of ["normal", "allOut", "precision", "coup"]) {
          const declaration = {
            variant,
            applyBlinded: Boolean(form.querySelector('[name="applyBlinded"]')?.checked),
            applyDeafened: Boolean(form.querySelector('[name="applyDeafened"]')?.checked),
            eyeOfNight: variant === "precision" && Boolean(eon?.checked),
          };
          const situationalMods = collectAttackerDeclarationModifiers({ attacker: attackerActor, defender, declaration, weapon, data: opposedData });
          const tn = computeTN({ actor: attackerActor, role: "attacker", styleUuid, variant, manualMod, circumstanceMod, situationalMods, context });
          if (attackMode === "melee" && weapon?.type === "weapon" && getWeaponCombatCapabilities(weapon).meleeCapable) {
            const opponentWeapon = Array.from(defender?.items ?? []).find(item => item.type === "weapon" && item.system?.equipped && getWeaponCombatCapabilities(item).meleeCapable);
            applyLengthPenaltyToTN({ tn, ownWeapon: weapon, opponentWeapon, ownerToken: attackerToken, opponentToken: defenderToken, ownerActor: attackerActor, ownRole: "attacker" });
          }
          updateTNPill(form, variant, tn);
        }
      };

      const sync = () => {
        const variant = form.querySelector('input[name="attackVariant"]:checked')?.value ?? "normal";
        const precisionOn = variant === "precision";
        const allOutOn = variant === "allOut";
        const coupOn = variant === "coup";
        if (psSelect) psSelect.disabled = !precisionOn;
        if (eon) {
          eon.disabled = !precisionOn;
          if (!precisionOn) eon.checked = false;
          setSystemOptionTooltip(eon, buildCombatOptionTooltipText("eyeOfNight", precisionOn ? "" : t("UESRPG.Dialogs.Opposed.SelectPrecisionHint", "Select Precision Strike to enable this option.")));
        }
        if (psWrap) {
          psWrap.classList.toggle("disabled", !precisionOn);
        }
        if (thunderToggle) {
          thunderToggle.disabled = !allOutOn;
          if (!allOutOn) thunderToggle.checked = false;
          setSystemOptionTooltip(thunderToggle, buildCombatOptionTooltipText("thunderCharge", allOutOn ? "" : t("UESRPG.Dialogs.Opposed.SelectAllOutHint", "Select All Out Attack to enable this option.")));
        }
        if (thunderWrap) {
          thunderWrap.classList.toggle("disabled", !allOutOn);
        }
        if (coupWrap) {
          coupWrap.classList.toggle("disabled", !coupOn);
        }
        if (coupSelect) {
          coupSelect.disabled = !coupOn;
          // Match the previous radio reset: re-entering Coup defaults to lethal.
          if (!coupOn) coupSelect.value = "lethal";
          refreshCoupTooltip();
        }
        refreshTN();
      };

      for (const r of form.querySelectorAll('input[name="attackVariant"]')) {
        r.addEventListener("change", sync);
      }
      for (const name of ["styleUuid", "weaponUuid", "circMod", "applyBlinded", "applyDeafened", "eyeOfNight"]) {
        form.querySelector(`[name="${name}"]`)?.addEventListener("change", refreshTN);
      }
      form.querySelector('[name="manualMod"]')?.addEventListener("input", refreshTN);
      sync();
    },
  });
}

/**
 * Prompt attacker to select weapon and spend Advantage after winning opposed test.
 * Returns selected options or null if canceled.
 */
export async function promptWeaponAndAdvantages({
  attackerActor,
  advantageCount = 0,
  attackMode = "melee",
  defaultWeaponUuid = null,
  defaultHitLocation = "Body",
  allowNoWeapon = false,
  attackerTokenUuid = null,
  opponentTokenUuid = null,
  styleUuidForKnown = null
}) {
  const weapons = _listEquippedWeapons(attackerActor);
  if (!weapons.length && !allowNoWeapon) {
    ui.notifications.warn(t("UESRPG.Notifications.Opposed.NoEquippedWeaponsFound"));
    return null;
  }

  const max = getAdvantageChoiceLimit(advantageCount);
  const defaultWeapon = weapons.find(w => w.uuid === defaultWeaponUuid) ?? weapons[0] ?? null;

  const allowedLocs = ["Head", "Body", "Right Arm", "Left Arm", "Right Leg", "Left Leg"];
  const safeDefaultLoc = allowedLocs.includes(defaultHitLocation) ? defaultHitLocation : "Body";

  const locOptions = allowedLocs
    .map(l => `<option value="${l}" ${l === safeDefaultLoc ? "selected" : ""}>${_escapeHtml(_hitLocationLabel(l))}</option>`)
    .join("\n");

  const hasPressAdvantage = (getContextAttackMode({ attackMode }) === "melee");

  const hasExploitTalent = Boolean(attackerActor && hasTalent(attackerActor, "exploitadvantage"));
  const exploitEligible = Boolean(hasExploitTalent && hasPressAdvantage && _canUseExploitAdvantage(attackerActor, {
    actorTokenUuid: attackerTokenUuid,
    opponentTokenUuid: opponentTokenUuid
  }));
  const optionHelp = {
    precisionStrike: buildCombatOptionTooltipText("precisionStrike"),
    penetrateArmor: buildCombatOptionTooltipText("penetrateArmor"),
    forcefulImpact: buildCombatOptionTooltipText("forcefulImpact"),
    pressAdvantage: buildCombatOptionTooltipText("pressAdvantage",
      hasExploitTalent ? (exploitEligible
        ? t("UESRPG.Dialogs.Opposed.ExploitAdvantageEligible", "Exploit Advantage: Press Advantage is doubled (+20) (isolated duel).")
        : t("UESRPG.Dialogs.Opposed.ExploitAdvantageRequiresDuel", "Exploit Advantage: requires an isolated duel to double Press Advantage.")) : ""
    )
  };

  // Known Special Actions are derived from the provided style UUID (roll-selected style),
  // with backward-compatible fallback to default actor resolution when not provided.
  const knownSpecial = (() => {
    try {
      const all = (styleUuidForKnown != null)
        ? buildSpecialActionsForActor(attackerActor, { styleUuidOrId: styleUuidForKnown, legacyNpcFallback: true })
        : buildSpecialActionsForActor(attackerActor);
      return all.filter(a => a.known);
    } catch (_e) {
      return [];
    }
  })();


const showWeaponSelect = allowNoWeapon || weapons.length >= 2;
  const noneSelected = allowNoWeapon && !defaultWeapon;
  const noneOption = allowNoWeapon ? `<option value="" ${noneSelected ? "selected" : ""}>${t("UESRPG.UI.None", "(none)")}</option>` : "";
  const weaponOptions = `${noneOption}${weapons
    .map(w => `<option value="${w.uuid}" ${w.uuid === defaultWeapon?.uuid ? "selected" : ""}>${_escapeHtml(w.name)}</option>`)
    .join("\n")}`;
  const resolvedWeaponUuid = defaultWeapon?.uuid ?? "";
  const hasChoiceUi = max > 0;

  if (!showWeaponSelect && !hasChoiceUi) {
    return {
      weaponUuid: resolvedWeaponUuid,
      precisionStrike: false,
      precisionLocation: safeDefaultLoc,
      penetrateArmor: false,
      forcefulImpact: false,
      pressAdvantage: false,
      pressAdvantageDouble: false,
      specialActionsSelected: []
    };
  }

  const options = [
    { id: "precisionStrike", title: t("UESRPG.Dialogs.Opposed.PrecisionStrike", "Precision Strike"), help: optionHelp.precisionStrike },
    { id: "penetrateArmor", title: t("UESRPG.Dialogs.Opposed.PenetrateArmor", "Penetrate Armor"), help: optionHelp.penetrateArmor },
    { id: "forcefulImpact", title: t("UESRPG.Dialogs.Opposed.ForcefulImpact", "Forceful Impact"), help: optionHelp.forcefulImpact },
    ...(hasPressAdvantage ? [{ id: "pressAdvantage", title: t("UESRPG.Dialogs.Opposed.PressAdvantage", "Press Advantage"), help: optionHelp.pressAdvantage }] : []),
    ...knownSpecial.map(special => ({ id: `sa:${special.id}`, special }))
  ];
  const content = `
    <div class="uesrpg-opp-dmg uesrpg-dialog-stack uesrpg-adv-dialog uesrpg-adv-dialog--attacker uesrpg-adv-dialog--choice-bars">
      ${showWeaponSelect ? `<div class="form-group uesrpg-adv-weapon">
        <label><b>${t("UESRPG.Dialogs.Opposed.Weapon", "Weapon")}</b></label>
        <select name="weaponUuid">${weaponOptions}</select>
      </div>` : `<input type="hidden" name="weaponUuid" value="${_escapeHtml(resolvedWeaponUuid)}" />`}
      <input type="hidden" name="defaultHitLocation" value="${safeDefaultLoc}" />
      ${renderAdvantageChoices({ count: max, options, extraHtml: max ? `
        <div class="uesrpg-adv-inline ps-location disabled">
          <label class="uesrpg-dialog-row"><span>${t("UESRPG.UI.HitLocation", "Hit location")}</span>
            <select name="precisionLocation" disabled>${locOptions}</select>
          </label>
        </div>` : "" })}
    </div>`;

  const tooltipScope = { kind: "adv-dialog", domain: "attacker-weapon-advantages" };
  try {
    return await customDialog({
      layout: "workflow",
      title: t("UESRPG.Dialogs.Opposed.ResolveDamage", "Resolve Damage"),
      width: 460,
      classes: ["uesrpg-attack-declare", "uesrpg-adv-resolution-window"],
      content,
      buttons: {
        continue: {
          label: t("UESRPG.UI.Continue", "Continue"),
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.element ?? html;
            const form = root?.querySelector(".uesrpg-opp-dmg") ?? root;
            if (!form) return null;

            const q = (name) => form.querySelector(`[name="${name}"]`);
            const weaponUuid = String(q("weaponUuid")?.value ?? resolvedWeaponUuid);

            const selected = readAdvantageChoices(form);
            const precisionStrike = selected.includes("precisionStrike");
            const defaultLoc = String(q("defaultHitLocation")?.value ?? "Body");
            const precisionLocation = precisionStrike ? String(q("precisionLocation")?.value ?? defaultLoc) : defaultLoc;
            const penetrateArmor = selected.includes("penetrateArmor");
            const forcefulImpact = selected.includes("forcefulImpact");
            const pressAdvantage = selected.includes("pressAdvantage");
            const pressAdvantageDouble = Boolean(pressAdvantage && exploitEligible);
            const selectedSpecial = knownSpecial.filter(sa => selected.includes(`sa:${sa.id}`)).map(sa => String(sa.id));
            if (!isAdvantageSelectionValid({ precisionStrike, penetrateArmor, forcefulImpact, pressAdvantage,
              specialActionsSelected: selectedSpecial }, max, { allowPress: hasPressAdvantage })) return null;

            return {
              weaponUuid,
              precisionStrike,
              precisionLocation,
              penetrateArmor,
              forcefulImpact,
              pressAdvantage,
              pressAdvantageDouble,
              specialActionsSelected: selectedSpecial
            };
          }
        },
        cancel: { label: t("UESRPG.UI.Cancel", "Cancel"), callback: () => null }
      },
      defaultButton: "continue",

    render: (event, html) => {
      const root = html instanceof HTMLElement ? html : html?.element ?? html;
      if (root instanceof HTMLElement) bindItemDescriptionTooltips(tooltipScope, root);
      const form = root?.querySelector(".uesrpg-opp-dmg") ?? root;
      if (!form) return;

      bindAdvantageChoices(root, { defaultLocation: safeDefaultLoc });
    },
  });
  } finally {
    clearItemDescriptionTooltip(tooltipScope);
  }
}

// ------------ Helper Functions ------------

/**
 * List equipped weapons for an actor.
 * Falls back to ALL weapons if none are explicitly equipped (common for NPCs).
 */
function _listEquippedWeapons(actor) {
  const equipped = actor?.itemTypes?.weapon?.filter(w => w.system?.equipped === true) ?? [];
  if (equipped.length) return equipped.map(w => ({ uuid: w.uuid, name: w.name ?? "Weapon", img: w.img ?? "" }));
  // Fallback: NPCs often lack explicit equipped flags - return all weapons
  const all = actor?.itemTypes?.weapon ?? [];
  if (all.length) {
    console.debug("UESRPG | _listEquippedWeapons: no weapons with equipped=true for", actor?.name, "- falling back to all weapons");
  }
  return all.map(w => ({ uuid: w.uuid, name: w.name ?? "Weapon", img: w.img ?? "" }));
}
