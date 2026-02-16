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
        <label><b>Weapon</b></label>
        <select name="weaponUuid" style="width:100%;">
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
        <label><b>Combat Style</b></label>
        <select name="styleUuid" style="width:100%;">
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
    return `<option value="${l}" ${sel}>${l}</option>`;
  }).join("\n");


  const hasBlinded = hasCondition(attackerActor, "blinded");
  const hasDeafened = hasCondition(attackerActor, "deafened");
  const sensoryControls = (hasBlinded || hasDeafened) ? `
    <div class="form-group" style="margin-top:8px;">
      <label><b>Sensory Impairment</b></label>
      <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
        ${hasBlinded ? '<label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" name="applyBlinded" checked/> <span>Apply Blinded (-30, sight-based)</span></label>' : ''}
        ${hasDeafened ? '<label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" name="applyDeafened" checked/> <span>Apply Deafened (-30, hearing-based)</span></label>' : ''}
      </div>
      <p style="opacity:0.8; font-size:12px; margin-top:6px;">
        RAW: these penalties apply only to tests benefiting from the relevant sense.
      </p>
    </div>` : "";

  const content = `
  <style>
    /* Keep layout compact but prefer the shared adv-dialog styles for consistent alignment */
    .uesrpg-attack-declare .form-row { display:flex; align-items:center; gap:12px; }
    .uesrpg-attack-declare .form-row label { flex:0 0 140px; }
    .uesrpg-attack-declare .form-row select,
    .uesrpg-attack-declare .form-row input { flex:1 1 auto; width:100%; }
    /* Use adv-grid defaults but keep a lightweight attacker-specific hook */
    .uesrpg-attack-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 12px; }
    .uesrpg-attack-grid .ps-location { margin-top:6px; width:100%; }
    .uesrpg-attack-grid .ps-location select { width:100%; }
    .uesrpg-attack-grid .ps-location.disabled { opacity:0.65; }
    /* Force dialog footer buttons to be a single row, 2 columns (scoped to this dialog) */
    .uesrpg-attack-declare .dialog-buttons { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .uesrpg-attack-declare .dialog-buttons button { width: 100%; }
    @media (max-width: 520px) {
      .uesrpg-attack-grid { grid-template-columns: 1fr; }
    }
  </style>
  <div class="uesrpg-attack-declare uesrpg-adv-dialog uesrpg-adv-dialog--attacker">
    ${styleSelect}
    ${weaponSelect}
    <div style="margin-top:12px;"><b>Attack Variation</b></div>
    <div class="uesrpg-adv-grid uesrpg-attack-grid">
      <label class="uesrpg-adv-choice">
        <input type="radio" name="attackVariant" value="normal" ${defaultVariant === "normal" ? "checked" : ""} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">Attack</span>
        </span>
      </label>
      <label class="uesrpg-adv-choice">
        <input type="radio" name="attackVariant" value="allOut" ${defaultVariant === "allOut" ? "checked" : ""} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">All Out Attack</span>
          <span class="uesrpg-adv-choice__desc">Melee only; +1 AP to +20 TN</span>
          ${hasThunderCharge ? `
            <div class="uesrpg-adv-inline ps-location ${defaultVariant === "allOut" ? "" : "disabled"}">
              <label style="display:flex; align-items:center; gap:6px; margin:0;">
                <input type="checkbox" name="thunderChargeToggle" ${defaultVariant === "allOut" ? "" : "disabled"} />
                <span>Thunderous Charge: waive All Out surcharge</span>
              </label>
            </div>
          ` : ""}
        </span>
      </label>
      <label class="uesrpg-adv-choice uesrpg-precision-option">
        <input type="radio" name="attackVariant" value="precision" ${defaultVariant === "precision" ? "checked" : ""} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">Precision Strike</span>
          <span class="uesrpg-adv-choice__desc">Choose hit location</span>
          <div class="uesrpg-adv-inline ps-location ${defaultVariant === "precision" ? "" : "disabled"}">
            <select name="precisionLocation" ${defaultVariant === "precision" ? "" : "disabled"}>
              ${locOptions}
            </select>
          </div>
        </span>
      </label>
      <label class="uesrpg-adv-choice">
        <input type="radio" name="attackVariant" value="coup" ${defaultVariant === "coup" ? "checked" : ""} />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">Coup de Grace</span>
          <span class="uesrpg-adv-choice__desc">Helpless target only</span>
        </span>
      </label>
    </div>

    ${showEyeOfNight ? `
    <div class="form-group" style="margin-top:10px;">
      <label style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" name="eyeOfNight" />
        <span><b>Eye of Night</b> (night/darkness): Precision Strike without -20</span>
      </label>
      <p style="opacity:0.8; font-size:12px; margin-top:6px;">Chapter 4: applies to the first attack made while Hidden.</p>
    </div>` : ""}
	
    <div class="form-group" style="margin-top:12px;">
      <label><b>Combat Circumstance Modifiers</b></label>
      <select name="circMod" style="width:100%;">
        <option value="0" ${Number(defaultCirc) === 0 ? "selected" : ""}>—</option>
        <option value="-10" ${Number(defaultCirc) === -10 ? "selected" : ""}>Minor Disadvantage (-10)</option>
        <option value="-20" ${Number(defaultCirc) === -20 ? "selected" : ""}>Disadvantage (-20)</option>
        <option value="-30" ${Number(defaultCirc) === -30 ? "selected" : ""}>Major Disadvantage (-30)</option>
      </select>
    </div>
    <div class="form-group" style="margin-top:12px;">
      <label><b>Manual Modifier</b></label>
      <input name="manualMod" type="number" value="${Number(defaultManual) || 0}" style="width:100%;" />
    </div>
  
    ${sensoryControls}
</div>
`;

    return await customDialog({
      title: `${attackerLabel} — Attack Options`,
      content,
      buttons: {
        ok: {
          label: "Continue",
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

            // AP calculation - will be validated and Thunder Charge applied in workflow
            const baseApCost = 1;
            const apCost = (variant === "allOut") ? 1 : 0;
            const totalApCost = baseApCost + apCost;

            const ap = Number(foundry.utils.getProperty(attackerActor, "system.action_points.value") ?? 0);
            if (!Number.isFinite(ap) || ap < totalApCost) {
              ui.notifications?.warn?.(`Not enough Action Points to perform this attack (requires ${totalApCost} AP).`);
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
              thunderChargeApplied: false  // Will be computed in workflow
            };
          }
        },
        cancel: {
          label: "Cancel",
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

      const sync = () => {
        const variant = form.querySelector('input[name="attackVariant"]:checked')?.value ?? "normal";
        const precisionOn = variant === "precision";
        const allOutOn = variant === "allOut";
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
    .map(l => `<option value="${l}" ${l === safeDefaultLoc ? "selected" : ""}>${l}</option>`)
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
    const chipClass = typ === "primary" ? "uesrpg-adv-chip--primary" : "uesrpg-adv-chip--secondary";
    const chipLabel = typ === "primary" ? "Primary" : "Secondary";
    return `
      <label class="uesrpg-adv-choice">
        <input type="checkbox" name="sa_${id}" />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">${label}</span>
        </span>
        <span class="uesrpg-adv-chip ${chipClass}">${chipLabel}</span>
      </label>
    `;
  };

  const noneSelected = allowNoWeapon && !defaultWeapon;
  const noneOption = allowNoWeapon ? `<option value="" ${noneSelected ? "selected" : ""}>None</option>` : "";
  const weaponOptions = `${noneOption}${weapons
    .map(w => `<option value="${w.uuid}" ${w.uuid === defaultWeapon?.uuid ? "selected" : ""}>${w.name}</option>`)
    .join("\n")}`;

  const content = `
    <div class="uesrpg-opp-dmg uesrpg-adv-dialog uesrpg-adv-dialog--attacker">
      <div class="form-group uesrpg-adv-weapon">
        <label><b>Weapon</b></label>
        <select name="weaponUuid">${weaponOptions}</select>
      </div>

      ${max > 0 ? `
        <hr style="margin:0.5rem 0;" />
        <div class="uesrpg-adv-summary">
          <b>Advantage</b>: ${max} available
          <div class="uesrpg-adv-count" aria-live="polite"></div>
        </div>

        <input type="hidden" name="defaultHitLocation" value="${safeDefaultLoc}" />

        <div class="uesrpg-adv-grid">
          <div class="uesrpg-adv-block">
            <label class="uesrpg-adv-choice">
              <input type="checkbox" name="precisionStrike" />
              <span class="uesrpg-adv-choice__label">
                <span class="uesrpg-adv-choice__title">Precision Strike</span>
                <span class="uesrpg-adv-choice__desc">Choose a hit location.</span>
              </span>
            </label>
            <div class="uesrpg-adv-inline">
              <select name="precisionLocation" disabled>${locOptions}</select>
            </div>
          </div>

          <label class="uesrpg-adv-choice">
            <input type="checkbox" name="penetrateArmor" />
            <span class="uesrpg-adv-choice__label">
              <span class="uesrpg-adv-choice__title">Penetrate Armor</span>
            </span>
          </label>

          <label class="uesrpg-adv-choice">
            <input type="checkbox" name="forcefulImpact" />
            <span class="uesrpg-adv-choice__label">
              <span class="uesrpg-adv-choice__title">Forceful Impact</span>
            </span>
          </label>

          ${hasPressAdvantage ? `
          <label class="uesrpg-adv-choice">
            <input type="checkbox" name="pressAdvantage" />
            <span class="uesrpg-adv-choice__label">
              <span class="uesrpg-adv-choice__title">Press Advantage</span>
            </span>
          </label>
          ${hasExploitTalent ? `
            <p class="hint" style="margin:0.25rem 0 0 0;">${exploitEligible ? "Exploit Advantage: Press Advantage is doubled (+20) (isolated duel)." : "Exploit Advantage: requires an isolated duel to double Press Advantage."}</p>
          ` : ``}
          ` : ``}

          ${knownSpecial.length ? `
            <div class="uesrpg-adv-section">
              <div class="uesrpg-adv-section__title"><b>Known Special Actions</b></div>
            </div>
            ${knownSpecial.map(renderSpecialOpt).join("\n")}
          ` : ``}
        </div>

        <p class="hint">Select up to ${max} option(s).</p>
      ` : ``}
    </div>
  `;

  return await customDialog({
      title: "Resolve Damage",
      content,
      buttons: {
        continue: {
          label: "Continue",
          callback: (html) => {
            const root = html instanceof HTMLElement ? html : html?.element ?? html;
            const form = root?.querySelector(".uesrpg-opp-dmg") ?? root;
            if (!form) return null;

            const q = (name) => form.querySelector(`[name="${name}"]`);
            const weaponUuid = String(q("weaponUuid")?.value ?? "");

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
              ui.notifications.warn(`You only have ${max} Advantage to spend.`);
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
        cancel: { label: "Cancel", callback: () => null }
      },
      defaultButton: "continue",

    render: (event, html) => {
      const root = html instanceof HTMLElement ? html : html?.element ?? html;
      const form = root?.querySelector(".uesrpg-opp-dmg") ?? root;
      if (!form) return;

      const precisionSelect = form.querySelector('select[name="precisionLocation"]');
      const defaultLoc = String(form.querySelector('input[name="defaultHitLocation"]')?.value ?? "Body");

      const listAllCheckboxes = () => [...form.querySelectorAll('input[type="checkbox"]')];
      const computeSelectedCount = () => listAllCheckboxes().filter(el => el?.dataset?.free !== "true").filter(el => Boolean(el.checked)).length;

      const updateUi = () => {        if (precisionSelect) {
          const ps = form.querySelector('input[type="checkbox"][name="precisionStrike"]');
          const psOn = Boolean(ps?.checked);
          precisionSelect.disabled = !psOn;
          if (!psOn) precisionSelect.value = defaultLoc;
        }

        const count = computeSelectedCount();
        const c = form.querySelector(".uesrpg-adv-count");
        if (c) c.textContent = `${count} / ${max} selected`;

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
            ui.notifications.warn(`You only have ${max} Advantage to spend.`);
          }
          updateUi();
        });
      }

      updateUi();
    },
  });
}

// ──────────── Helper Functions ────────────

/**
 * List equipped weapons for an actor.
 * Falls back to ALL weapons if none are explicitly equipped (common for NPCs).
 */
function _listEquippedWeapons(actor) {
  const equipped = actor?.itemTypes?.weapon?.filter(w => w.system?.equipped === true) ?? [];
  if (equipped.length) return equipped.map(w => ({ uuid: w.uuid, name: w.name ?? "Weapon", img: w.img ?? "" }));
  // Fallback: NPCs often lack explicit equipped flags — return all weapons
  const all = actor?.itemTypes?.weapon ?? [];
  if (all.length) {
    console.debug("UESRPG | _listEquippedWeapons: no weapons with equipped=true for", actor?.name, "— falling back to all weapons");
  }
  return all.map(w => ({ uuid: w.uuid, name: w.name ?? "Weapon", img: w.img ?? "" }));
}
