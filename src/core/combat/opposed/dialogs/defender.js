/**
 * src/core/combat/opposed/dialogs/defender.js
 *
 * Defender-side dialog functions for opposed combat workflow.
 * Extracted from monolith (Phase 12) to improve modularity and performance.
 *
 * Exported functions:
 * - promptDefenderAdvantage: Defender advantage spending dialog (Overextend, Overwhelm, Secondary actions)
 */

import { buildSpecialActionsForActor } from "../../combat-style-utils.js";
import { hasTalent } from "../../../traits/talents-api.js";
import { canUseExploitAdvantage as _canUseExploitAdvantage } from "../helpers/workflow.js";

/**
 * Prompt defender to spend Advantage after successful defense.
 * Returns selected options or null if canceled.
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
