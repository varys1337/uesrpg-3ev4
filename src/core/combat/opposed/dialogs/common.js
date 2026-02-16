/**
 * src/core/combat/opposed/dialogs/common.js
 * Dialog prompt functions for opposed workflow
 * Extracted from opposed-workflow.js monolith (Phase 4)
 */

import { hasTalent } from "../../../traits/talents-api.js";
import { buildSpecialActionsForActor } from "../../combat-style-utils.js";
import { canTokenEscapeTemplate } from "../../../../utils/aoe-utils.js";
import { getContextAttackMode, isIsolatedDuelByTokens } from "../helpers/workflow.js";
import { _resolveToken } from "../helpers/docs.js";
import { _canControlActor } from "../helpers/util.js";
import { confirmDialog, customDialog } from "../../../../utils/dialog-v2-helper.js";

// ====== HELPER: EXPLOIT ADVANTAGE CHECK ======

/**
 * Check if actor can use Exploit Advantage talent (isolated duel requirement)
 */
function _canUseExploitAdvantage(actor, { actorTokenUuid = null, opponentTokenUuid = null } = {}) {
  if (!hasTalent(actor, "exploitadvantage")) return false;
  if (!actorTokenUuid || !opponentTokenUuid) return false;

  const actorToken = _resolveToken(actorTokenUuid);
  const opponentToken = _resolveToken(opponentTokenUuid);
  if (!actorToken || !opponentToken) return false;

  try {
    return isIsolatedDuelByTokens(actorToken, opponentToken) ?? false;
  } catch (_e) {
    return false;
  }
}

/**
 * List equipped weapons for an actor.
 * Falls back to ALL weapons if none are explicitly equipped (common for NPCs).
 */
function _listEquippedWeapons(actor) {
  const equipped = [];
  const all = [];
  for (const it of (actor?.items ?? [])) {
    if (!it || it.type !== "weapon") continue;
    all.push(it);
    if (it.system?.equipped === true) equipped.push(it);
  }
  if (equipped.length) return equipped;
  // Fallback: NPCs often lack explicit equipped flags — return all weapons
  if (all.length) {
    console.debug("UESRPG | _listEquippedWeapons: no weapons with equipped=true for", actor?.name, "— falling back to all weapons");
  }
  return all;
}

// ====== BASIC PROMPTS ======

/**
 * Generic Yes/No confirmation dialog
 */
export async function promptYesNo({ title, content, yesLabel = "Yes", noLabel = "No" } = {}) {
  const result = await confirmDialog({
    title: title ?? "Confirm",
    content: `<div style="min-width:340px;">${content ?? ""}</div>`,
    yesLabel,
    noLabel,
  });
  // confirmDialog returns true/false/null; coerce null (close) to false for callers
  return result === true;
}

/**
 * Token selection dialog from a list
 */
export async function promptSelectToken({ title, prompt, tokens = [] } = {}) {
  const choices = (Array.isArray(tokens) ? tokens : []).filter(t => t?.id && t?.name);
  if (choices.length === 0) return null;
  if (choices.length === 1) return choices[0];

  const options = choices
    .map(t => `<option value="${t.id}">${t.name}</option>`)
    .join("");
  const content = `
    <div style="min-width:360px;">
      <p style="margin:0 0 0.5em 0;">${prompt ?? "Select a target."}</p>
      <select name="tokenId" style="width:100%;">${options}</select>
    </div>`;

  return customDialog({
    title: title ?? "Select Target",
    content,
    buttons: {
      ok: {
        label: "OK",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const tokenId = root?.querySelector("select[name='tokenId']")?.value ?? null;
          return choices.find(t => t.id === tokenId) ?? null;
        }
      },
      cancel: { label: "Cancel", callback: () => null }
    },
    defaultButton: "ok",
  });
}

// ====== COMBAT-SPECIFIC PROMPTS ======

/**
 * Prompt for Unstoppable Might talent usage (special wield mode)
 */
export async function promptUnstoppableMightUsage({ actorName = "Actor", purpose = "attack" } = {}) {
  const details = purpose === "defense"
    ? "<p>If yes, Parry and Counter-Attack are unavailable while wielding this way.</p>"
    : "<p>If yes, two-handed damage will be used for this attack.</p>";
  return await promptYesNo({
    title: "Unstoppable Might",
    content: `
      <div class="uesrpg">
        <p><b>${actorName}</b> is using a special wield mode?</p>
        <ul>
          <li>Dual wielding hand-and-a-half weapons (use two-handed damage)</li>
          <li>Wielding a two-handed weapon in one hand</li>
        </ul>
        ${details}
      </div>
    `,
    yesLabel: "Using Special Wield",
    noLabel: "Normal Wield"
  });
}

/**
 * Prompt for AoE Evade escape (can defender move 1m to exit template?)
 */
export async function promptAoEEvadeEscape({ defenderName = "Defender", attackLabel = "the attack" } = {}) {
  try {
    return await confirmDialog({
      title: "AoE Evade",
      content: `<p>${defenderName} successfully evaded ${attackLabel}. Can they move 1m to exit the area?</p>`,
      yesLabel: "Escapes AoE",
      noLabel: "Still in AoE",
    });
  } catch (_e) {
    return null;
  }
}

// ====== ADVANTAGE SPENDING DIALOGS ======

/**
 * Attacker Advantage spending dialog (Weapon selection + Precision Strike, Penetrate Armor, Forceful Impact, Press Advantage, Special Actions)
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

      const updateUi = () => {
        if (precisionSelect) {
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
          if (ev.currentTarget?.dataset?.free === "true") {
            updateUi();
            return;
          }
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
