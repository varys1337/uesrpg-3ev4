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
import { clearTokenDashContext } from "../../combat-utils.js";
import { buildSpecialActionsForActor } from "../../combat-style-utils.js";
import { hasTalent } from "../../../traits/talents-api.js";
import { 
  getContextAttackMode, 
  canUseExploitAdvantage as _canUseExploitAdvantage,
  getPreferredWeaponUuid as _getPreferredWeaponUuid
} from "../helpers/workflow.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { buildSpecialActionTooltipText, buildSpecialActionHelpText } from "../../../../data/tooltips/index.js";
import { bindItemDescriptionTooltips, clearItemDescriptionTooltip } from "../../../../ui/sheets/v2/shared/sheet-tooltips.js";
import { buildCircumstanceOptionsHtml } from "../../../opposed/circumstance.js";
import { t, tf } from "../../../../utils/i18n.js";

function _escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

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
    defaultVariant = "normal", defaultManual = 0, defaultCirc = 0, attackerToken = null, defenderToken = null } = {}) {
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
            return `<option value="${w.uuid}" ${sel}>${w.name}</option>`;
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
            return `<option value="${s.uuid}" ${sel}>${s.name}</option>`;
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
      ${hasBlinded ? `<label><input type="checkbox" name="applyBlinded" checked/> <span>${t("UESRPG.Dialogs.Opposed.ApplyBlinded", "Apply Blinded (-30, sight-based)")}</span></label>` : ""}
      ${hasDeafened ? `<label><input type="checkbox" name="applyDeafened" checked/> <span>${t("UESRPG.Dialogs.Opposed.ApplyDeafened", "Apply Deafened (-30, hearing-based)")}</span></label>` : ""}
      <p class="uesrpg-sensory-hint">${t("UESRPG.Dialogs.Opposed.SensoryHint", "RAW: these penalties apply only to tests benefiting from the relevant sense.")}</p>
    </div>` : "";

  const content = `
  <div class="uesrpg-attack-declare uesrpg-adv-dialog uesrpg-adv-dialog--attacker">
    ${styleSelect}
    ${weaponSelect}
    <div class="uesrpg-dialog-section-header">${t("UESRPG.Dialogs.Opposed.AttackVariation", "Attack Variation")}</div>
    <div class="uesrpg-adv-grid uesrpg-attack-grid">
      <label class="uesrpg-adv-choice">
        <input type="radio" name="attackVariant" value="normal" ${defaultVariant === "normal" ? "checked" : ""} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">${t("UESRPG.Chat.Opposed.Attack", "Attack")}</span>
        </span>
      </label>
      <label class="uesrpg-adv-choice">
        <input type="radio" name="attackVariant" value="allOut" ${defaultVariant === "allOut" ? "checked" : ""} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.AllOutAttack", "All Out Attack")}</span>
          <span class="uesrpg-adv-choice__desc">${t("UESRPG.Dialogs.Opposed.AllOutAttackDesc", "Melee only; +1 AP to +20 TN")}</span>
          ${hasThunderCharge ? `
            <div class="uesrpg-adv-inline ps-location ${defaultVariant === "allOut" ? "" : "disabled"}">
              <label class="uesrpg-inline-check">
                <input type="checkbox" name="thunderChargeToggle" ${defaultVariant === "allOut" ? "" : "disabled"} />
                <span>${t("UESRPG.Dialogs.Opposed.ThunderousCharge", "Thunderous Charge: waive All Out surcharge")}</span>
              </label>
            </div>
          ` : ""}
        </span>
      </label>
      <label class="uesrpg-adv-choice uesrpg-precision-option">
        <input type="radio" name="attackVariant" value="precision" ${defaultVariant === "precision" ? "checked" : ""} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.PrecisionStrike", "Precision Strike")}</span>
          <span class="uesrpg-adv-choice__desc">${t("UESRPG.Dialogs.Opposed.ChooseHitLocation", "Choose hit location")}</span>
          <div class="uesrpg-adv-inline ps-location ${defaultVariant === "precision" ? "" : "disabled"}">
            <select name="precisionLocation" ${defaultVariant === "precision" ? "" : "disabled"}>
              ${locOptions}
            </select>
          </div>
        </span>
      </label>
      <label class="uesrpg-adv-choice uesrpg-coup-option">
        <input type="radio" name="attackVariant" value="coup" ${defaultVariant === "coup" ? "checked" : ""} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.CoupDeGrace", "Coup de Grace")}</span>
          <span class="uesrpg-adv-choice__desc">${t("UESRPG.Dialogs.Opposed.HelplessTargetOnly", "Helpless target only")}</span>
          <div class="uesrpg-adv-inline coup-mode ${defaultVariant === "coup" ? "" : "disabled"}">
            <label class="uesrpg-inline-check">
              <input type="radio" name="coupMode" value="lethal" ${defaultVariant === "coup" ? "checked" : ""} ${defaultVariant === "coup" ? "" : "disabled"} /> ${t("UESRPG.Dialogs.Opposed.CoupLethal", "Lethal (HP -> 0)")}
            </label>
            <label class="uesrpg-inline-check">
              <input type="radio" name="coupMode" value="nonlethal" ${defaultVariant === "coup" ? "" : "disabled"} /> ${t("UESRPG.Dialogs.Opposed.CoupNonLethal", "Non-Lethal (-1 Stamina, +1 Fatigue)")}
            </label>
          </div>
        </span>
      </label>
    </div>

    ${showEyeOfNight ? `
    <div class="uesrpg-eon-section">
      <label>
        <input type="checkbox" name="eyeOfNight" />
        <span>${t("UESRPG.Dialogs.Opposed.EyeOfNight", "Eye of Night (night/darkness): Precision Strike without -20")}</span>
      </label>
      <p class="uesrpg-eon-hint">${t("UESRPG.Dialogs.Opposed.EyeOfNightHint", "Chapter 4: applies to the first attack made while Hidden.")}</p>
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
            const coupMode = root.querySelector('input[name="coupMode"]:checked')?.value ?? "lethal";

            // AP calculation - will be validated and Thunder Charge applied in workflow
            const baseApCost = 1;
            const apCost = (variant === "allOut") ? 1 : 0;
            const totalApCost = baseApCost + apCost;

            const ap = Number(foundry.utils.getProperty(attackerActor, "system.action_points.value") ?? 0);
            if (!Number.isFinite(ap) || ap < totalApCost) {
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
      const coupModeRadios = form.querySelectorAll('input[name="coupMode"]');

      const sync = () => {
        const variant = form.querySelector('input[name="attackVariant"]:checked')?.value ?? "normal";
        const precisionOn = variant === "precision";
        const allOutOn = variant === "allOut";
        const coupOn = variant === "coup";
        if (psSelect) psSelect.disabled = !precisionOn;
        if (eon) {
          eon.disabled = !precisionOn;
          if (!precisionOn) eon.checked = false;
        }
        if (psWrap) {
          psWrap.classList.toggle("disabled", !precisionOn);
        }
        if (thunderToggle) {
          thunderToggle.disabled = !allOutOn;
          if (!allOutOn) thunderToggle.checked = false;
        }
        if (thunderWrap) {
          thunderWrap.classList.toggle("disabled", !allOutOn);
        }
        if (coupWrap) {
          coupWrap.classList.toggle("disabled", !coupOn);
        }
        for (const r of coupModeRadios) {
          r.disabled = !coupOn;
          if (!coupOn) r.checked = false;
        }
        // Default lethal when coup is first selected
        if (coupOn) {
          const anyChecked = Array.from(coupModeRadios).some(r => r.checked);
          if (!anyChecked) {
            const lethalRadio = form.querySelector('input[name="coupMode"][value="lethal"]');
            if (lethalRadio) lethalRadio.checked = true;
          }
        }
      };

      for (const r of form.querySelectorAll('input[name="attackVariant"]')) {
        r.addEventListener("change", sync);
      }
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
    ui.notifications.warn("No equipped weapons found.");
    return null;
  }

  const max = Number(advantageCount || 0);
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

  const renderSpecialOpt = (sa) => {
    const id = String(sa?.id ?? "").trim();
    if (!id) return "";
    const label = String(sa?.name ?? id);
    const typ = String(sa?.actionType ?? "").toLowerCase();
    const tooltip = buildSpecialActionTooltipText({ name: label, id, actionType: typ || "primary/secondary" });
    const helpText = buildSpecialActionHelpText({ name: label, id });
    const chipClass = typ === "primary" ? "uesrpg-adv-chip--primary" : "uesrpg-adv-chip--secondary";
    const chipLabel = typ === "primary"
      ? t("UESRPG.Sheets.Combat.Primary", "Primary")
      : t("UESRPG.Sheets.Combat.Secondary", "Secondary");
    return `
      <label class="uesrpg-adv-choice" title="${_escapeHtml(tooltip)}" data-uesrpg-inline-help="true" data-uesrpg-inline-help-label="${_escapeHtml(label)}" data-uesrpg-inline-help-text="${_escapeHtml(tooltip)}" data-uesrpg-inline-help-dialog-text="${_escapeHtml(helpText)}">
        <input type="checkbox" name="sa_${id}" />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">${label}</span>
          <span class="uesrpg-adv-chip uesrpg-adv-chip--inline ${chipClass}">${chipLabel}</span>
        </span>
      </label>
    `;
  };

  const showWeaponSelect = allowNoWeapon || weapons.length >= 2;
  const noneSelected = allowNoWeapon && !defaultWeapon;
  const noneOption = allowNoWeapon ? `<option value="" ${noneSelected ? "selected" : ""}>${t("UESRPG.UI.None", "(none)")}</option>` : "";
  const weaponOptions = `${noneOption}${weapons
    .map(w => `<option value="${w.uuid}" ${w.uuid === defaultWeapon?.uuid ? "selected" : ""}>${w.name}</option>`)
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

  const content = `
    <div class="uesrpg-opp-dmg uesrpg-adv-dialog uesrpg-adv-dialog--attacker">
      ${showWeaponSelect ? `
      <div class="form-group uesrpg-adv-weapon">
        <label><b>${t("UESRPG.Dialogs.Opposed.Weapon", "Weapon")}</b></label>
        <select name="weaponUuid">${weaponOptions}</select>
      </div>
      ` : `<input type="hidden" name="weaponUuid" value="${_escapeHtml(resolvedWeaponUuid)}" />`}

      ${max > 0 ? `
        <hr style="margin:0.5rem 0;" />
        <div class="uesrpg-adv-summary">
          <b>${t("UESRPG.Chat.Common.Advantage", "Advantage")}</b>: ${tf("UESRPG.Dialogs.Opposed.AvailableCount", { count: max }, `${max} available`)}
          <div class="uesrpg-adv-count" aria-live="polite"></div>
        </div>

        <input type="hidden" name="defaultHitLocation" value="${safeDefaultLoc}" />

        <div class="uesrpg-adv-grid">
          <label class="uesrpg-adv-choice uesrpg-precision-option">
            <input type="checkbox" name="precisionStrike" />
            <span class="uesrpg-adv-choice__label">
              <span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.PrecisionStrike", "Precision Strike")}</span>
              <span class="uesrpg-adv-choice__desc">${t("UESRPG.Dialogs.Opposed.ChooseHitLocationSentence", "Choose a hit location.")}</span>
              <span class="uesrpg-adv-inline ps-location disabled">
                <select name="precisionLocation" disabled>${locOptions}</select>
              </span>
            </span>
          </label>

          <label class="uesrpg-adv-choice">
            <input type="checkbox" name="penetrateArmor" />
            <span class="uesrpg-adv-choice__label">
              <span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.PenetrateArmor", "Penetrate Armor")}</span>
            </span>
          </label>

          <label class="uesrpg-adv-choice">
            <input type="checkbox" name="forcefulImpact" />
            <span class="uesrpg-adv-choice__label">
              <span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.ForcefulImpact", "Forceful Impact")}</span>
            </span>
          </label>

          ${hasPressAdvantage ? `
          <label class="uesrpg-adv-choice">
            <input type="checkbox" name="pressAdvantage" />
            <span class="uesrpg-adv-choice__label">
              <span class="uesrpg-adv-choice__title">${t("UESRPG.Dialogs.Opposed.PressAdvantage", "Press Advantage")}</span>
            </span>
          </label>
          ${hasExploitTalent ? `
            <p class="hint" style="margin:0.25rem 0 0 0;">${exploitEligible ? t("UESRPG.Dialogs.Opposed.ExploitAdvantageEligible", "Exploit Advantage: Press Advantage is doubled (+20) (isolated duel).") : t("UESRPG.Dialogs.Opposed.ExploitAdvantageRequiresDuel", "Exploit Advantage: requires an isolated duel to double Press Advantage.")}</p>
          ` : ``}
          ` : ``}

          ${knownSpecial.length ? `
            <div class="uesrpg-adv-section">
              <div class="uesrpg-adv-section__title"><b>${t("UESRPG.Dialogs.Opposed.KnownSpecialActions", "Known Special Actions")}</b></div>
            </div>
            ${knownSpecial.map(renderSpecialOpt).join("\n")}
          ` : ``}
        </div>
        <p class="hint">${tf("UESRPG.Dialogs.Opposed.SelectUpToOptions", { count: max }, `Select up to ${max} option(s).`)}</p>
      ` : ``}
    </div>
  `;
  const resolveDamageWidth = Math.max(420, Math.min(620, (window?.innerWidth ?? 620) - 96));

  const tooltipScope = { kind: "adv-dialog", domain: "attacker-weapon-advantages" };
  try {
    return await customDialog({
      title: t("UESRPG.Dialogs.Opposed.ResolveDamage", "Resolve Damage"),
      width: resolveDamageWidth,
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

            const precisionStrike = Boolean(q("precisionStrike")?.checked);
            const defaultLoc = String(q("defaultHitLocation")?.value ?? "Body");
            const precisionLocation = precisionStrike
              ? String(q("precisionLocation")?.value ?? defaultLoc)
              : defaultLoc;

            const penetrateArmor = Boolean(q("penetrateArmor")?.checked);
            const forcefulImpact = Boolean(q("forcefulImpact")?.checked);
            const pressAdvantage = Boolean(q("pressAdvantage")?.checked);
            const pressAdvantageDouble = Boolean(pressAdvantage && exploitEligible);

            const selectedSpecial = [];
            for (const sa of knownSpecial) {
              const id = String(sa?.id ?? "").trim();
              if (!id) continue;
              if (Boolean(q(`sa_${id}`)?.checked)) selectedSpecial.push(id);
            }

            const selectedCount = [precisionStrike, penetrateArmor, forcefulImpact, pressAdvantage].filter(Boolean).length + selectedSpecial.length;
            if (max > 0 && selectedCount > max) {
              ui.notifications.warn(tf("UESRPG.Notifications.Opposed.OnlyHaveAdvantage", { count: max }, `You only have ${max} Advantage to spend.`));
              return null;
            }

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

      const precisionSelect = form.querySelector('select[name="precisionLocation"]');
      const defaultLoc = String(form.querySelector('input[name="defaultHitLocation"]')?.value ?? "Body");

      const listAllCheckboxes = () => [...form.querySelectorAll('input[type="checkbox"]')];
      const computeSelectedCount = () => listAllCheckboxes().filter(el => el?.dataset?.free !== "true").filter(el => Boolean(el.checked)).length;

      const updateUi = () => {
        if (precisionSelect) {
          const ps = form.querySelector('input[type="checkbox"][name="precisionStrike"]');
          const psOn = Boolean(ps?.checked);
          precisionSelect.disabled = !psOn;
          const precisionWrap = precisionSelect.closest(".ps-location");
          if (precisionWrap) precisionWrap.classList.toggle("disabled", !psOn);
          if (!psOn) precisionSelect.value = defaultLoc;
        }

        const count = computeSelectedCount();
        const c = form.querySelector(".uesrpg-adv-count");
          if (c) c.textContent = tf("UESRPG.Dialogs.Opposed.SelectedCount", { count, max }, `${count} / ${max} selected`);

        for (const el of listAllCheckboxes()) {
          if (el?.dataset?.free === "true") continue;
          if (Boolean(el.checked)) {
            el.disabled = false;
            continue;
          }
          el.disabled = (count >= max);
        }
      };

      for (const el of listAllCheckboxes()) {
        el.addEventListener("change", (ev) => {
          const count = computeSelectedCount();
          if (count > max) {
            ev.currentTarget.checked = false;
            ui.notifications.warn(tf("UESRPG.Notifications.Opposed.OnlyHaveAdvantage", { count: max }, `You only have ${max} Advantage to spend.`));
          }
          updateUi();
        });
      }

      updateUi();
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
