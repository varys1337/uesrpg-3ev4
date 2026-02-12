/**
 * src/core/combat/opposed/dialogs/common.js
 * Dialog prompt functions for opposed workflow
 * Extracted from opposed-workflow.js monolith (Phase 4)
 */

import { hasTalent } from "../../../traits/talents-api.js";
import { buildSpecialActionsForActor, isSpecialActionUsableNow } from "../../combat-style-utils.js";
import { canTokenEscapeTemplate } from "../../../../utils/aoe-utils.js";
import { getContextAttackMode, isIsolatedDuelByTokens } from "../helpers/workflow.js";
import { _resolveToken } from "../helpers/docs.js";
import { _canControlActor } from "../helpers/util.js";

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
 * List equipped weapons for an actor (filtered by attack mode if needed)
 */
function _listEquippedWeapons(actor) {
  const weapons = [];
  for (const it of (actor?.items ?? [])) {
    if (!it || it.type !== "weapon") continue;
    if (it.system?.equipped !== true) continue;
    weapons.push(it);
  }
  return weapons;
}

// ====== BASIC PROMPTS ======

/**
 * Generic Yes/No confirmation dialog
 */
export async function promptYesNo({ title, content, yesLabel = "Yes", noLabel = "No" } = {}) {
  return new Promise(resolve => {
    const dlg = new Dialog({
      title: title ?? "Confirm",
      content: `<div style="min-width:340px;">${content ?? ""}</div>`,
      buttons: {
        yes: {
          label: yesLabel,
          callback: () => resolve(true)
        },
        no: {
          label: noLabel,
          callback: () => resolve(false)
        }
      },
      default: "no",
      close: () => resolve(false)
    });
    dlg.render(true);
  });
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

  return new Promise(resolve => {
    const dlg = new Dialog({
      title: title ?? "Select Target",
      content,
      buttons: {
        ok: {
          label: "OK",
          callback: html => {
            const tokenId = html?.find?.("select[name='tokenId']")?.val?.() ?? null;
            const token = choices.find(t => t.id === tokenId) ?? null;
            resolve(token);
          }
        },
        cancel: {
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "ok",
      close: () => resolve(null)
    });
    dlg.render(true);
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
  if (typeof Dialog?.confirm !== "function") return null;
  try {
    return await Dialog.confirm({
      title: "AoE Evade",
      content: `<p>${defenderName} successfully evaded ${attackLabel}. Can they move 1m to exit the area?</p>`,
      yes: "Escapes AoE",
      no: "Still in AoE",
      defaultYes: true
    });
  } catch (_e) {
    return null;
  }
}

// ====== ADVANTAGE SPENDING DIALOGS ======

/**
 * Defender Advantage spending dialog (Overextend, Overwhelm, Special Actions)
 */
export async function promptDefenderAdvantage({ defenderActor, attackerActor, advantageCount = 0, defenderTokenUuid = null, opponentTokenUuid = null } = {}) {
  if (!defenderActor || advantageCount <= 0) return null;

  const max = Number(advantageCount || 0);

  const hasExploitTalent = Boolean(defenderActor && hasTalent(defenderActor, "exploitadvantage"));
  const exploitEligible = Boolean(hasExploitTalent && _canUseExploitAdvantage(defenderActor, { actorTokenUuid: defenderTokenUuid, opponentTokenUuid }));

  // Known Special Actions are derived ONLY from the actor's active combat style.
  // Defender advantage usage is reaction context: only Secondary actions are offered.
  const knownSecondary = (() => {
    try {
      const all = buildSpecialActionsForActor(defenderActor);
      return all.filter(a => a.known && String(a.actionType).toLowerCase() === "secondary");
    } catch (_e) {
      return [];
    }
  })();

  const renderSpecialOpt = (sa) => {
    const id = String(sa?.id ?? "").trim();
    if (!id) return "";
    const label = String(sa?.name ?? id);
    return `
      <label class="uesrpg-adv-choice">
        <input type="checkbox" name="sa_${id}" />
        <span class="uesrpg-adv-choice__label">
          <span class="uesrpg-adv-choice__title">${label}</span>
        </span>
        <span class="uesrpg-adv-chip uesrpg-adv-chip--secondary">Secondary</span>
      </label>
    `;
  };

  const content = `
    <form class="uesrpg-adv-dialog uesrpg-adv-dialog--defender">
      <div class="uesrpg-adv-summary">
        <div><b>Advantage</b>: ${max} available</div>
        <div class="uesrpg-adv-count" aria-live="polite"></div>
      </div>
      <div class="uesrpg-adv-grid">
        <label class="uesrpg-adv-choice">
          <input type="checkbox" name="overextend" />
          <span class="uesrpg-adv-choice__label">
            <span class="uesrpg-adv-choice__title">Overextend</span>
            <span class="uesrpg-adv-choice__desc">Opponent's next attack within 1 round suffers -10.</span>
          </span>
        </label>
        ${hasExploitTalent ? `
        <p class="hint" style="margin:0.25rem 0 0 0;">${exploitEligible ? "Exploit Advantage: Overextend is doubled (-20) (isolated duel)." : "Exploit Advantage: requires an isolated duel to double Overextend."}</p>
        ` : ``}
        <label class="uesrpg-adv-choice">
          <input type="checkbox" name="overwhelm" />
          <span class="uesrpg-adv-choice__label">
            <span class="uesrpg-adv-choice__title">Overwhelm</span>
            <span class="uesrpg-adv-choice__desc">Opponent cannot make Attacks of Opportunity until your next turn.</span>
          </span>
        </label>
        ${knownSecondary.length ? `
          <div class="uesrpg-adv-section">
            <div class="uesrpg-adv-section__title"><b>Known Special Actions</b></div>
          </div>
          ${knownSecondary.map(renderSpecialOpt).join("\n")}
        ` : ``}
      </div>
      <p class="hint">Select up to ${max} option(s).</p>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const dialog = new Dialog({
      title: "Use Defender Advantage",
      content,
      buttons: {
        apply: {
          label: "Apply",
          callback: (html) => {
            const root = (html && "0" in html && html[0] instanceof Element) ? html[0] : (html instanceof Element ? html : null);
            const form = root?.querySelector("form.uesrpg-adv-dialog--defender");
            if (!form) return settle(null);

            const q = (name) => form.querySelector(`[name="${name}"]`);
            const overextend = Boolean(q("overextend")?.checked);
            const overextendDouble = Boolean(overextend && exploitEligible);
            const overwhelm = Boolean(q("overwhelm")?.checked);

            const selectedSpecial = [];
            for (const sa of knownSecondary) {
              const id = String(sa?.id ?? "").trim();
              if (!id) continue;
              if (Boolean(q(`sa_${id}`)?.checked)) selectedSpecial.push(id);
            }

            const selectedCount = [overextend, overwhelm].filter(Boolean).length + selectedSpecial.length;
            if (selectedCount > max) {
              ui.notifications.warn(`You only have ${max} Advantage to spend.`);
              return false;
            }

            return settle({ overextend, overextendDouble, overwhelm, specialActionsSelected: selectedSpecial });
          }
        },
        skip: { label: "Skip", callback: () => settle({ overextend: false, overextendDouble: false, overwhelm: false, specialActionsSelected: [] }) }
      },
      default: "apply",
      close: () => settle(null)
    });

    Hooks.once("renderDialog", (app, html) => {
      if (app !== dialog) return;
      const root = html?.[0] instanceof Element ? html[0] : null;
      const form = root?.querySelector("form.uesrpg-adv-dialog--defender");
      if (!form) return;

      const listAllCheckboxes = () => [...form.querySelectorAll('input[type="checkbox"]')];
      const computeSelectedCount = () => listAllCheckboxes().filter(el => Boolean(el.checked)).length;

      const updateUi = () => {
        const count = computeSelectedCount();
        const c = form.querySelector(".uesrpg-adv-count");
        if (c) c.textContent = `${count} / ${max} selected`;

        for (const el of listAllCheckboxes()) {
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
    });

    dialog.render(true);
  });
}

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
  opponentTokenUuid = null
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

  // Known Special Actions are derived ONLY from the actor's active combat style.
  // For attacker spend: Primary must be usable now; Secondary is always usable.
  const knownSpecial = (() => {
    try {
      const all = buildSpecialActionsForActor(attackerActor);
      return all.filter(a => a.known && isSpecialActionUsableNow(attackerActor, a.actionType));
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
    <form class="uesrpg-opp-dmg uesrpg-adv-dialog uesrpg-adv-dialog--attacker">
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
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const dialog = new Dialog({
      title: "Resolve Damage",
      content,
      buttons: {
        continue: {
          label: "Continue",
          callback: (html) => {
            const root = (html && "0" in html && html[0] instanceof Element) ? html[0] : (html instanceof Element ? html : null);
            const form = root?.querySelector("form.uesrpg-opp-dmg");
            if (!form) return settle(null);

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
              return false;
            }

            return settle({
              weaponUuid,
              precisionStrike,
              precisionLocation,
              penetrateArmor,
              forcefulImpact,
              pressAdvantage,
              pressAdvantageDouble,
              specialActionsSelected: selectedSpecial
            });
          }
        },
        cancel: { label: "Cancel", callback: () => settle(null) }
      },
      default: "continue",
      close: () => settle(null)
    });

    Hooks.once("renderDialog", (app, html) => {
      if (app !== dialog) return;
      const root = html?.[0] instanceof Element ? html[0] : null;
      const form = root?.querySelector("form.uesrpg-opp-dmg");
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
    });

    dialog.render(true);
  });
}
