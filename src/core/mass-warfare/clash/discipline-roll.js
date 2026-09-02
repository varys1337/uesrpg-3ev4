/**
 * src/core/mass-warfare/clash/discipline-roll.js
 *
 * Standalone Discipline test roll for Warfare Unit actors.
 *
 * Supports:
 *  - Unopposed: this unit rolls against its own Discipline TN ± modifier.
 *  - Opposed: this unit and a targeted Warfare Unit both roll simultaneously;
 *    winner determined by success + DoS comparison.
 *
 * Lucky/Unlucky crit flags are suppressed — warfare units have no character crits.
 * DSN (Dice So Nice) animation plays simultaneously for all rolls before the card posts.
 */

import { customDialog } from "../../../utils/dialog-v2-helper.js";
import { doTestRoll } from "../../../utils/degree-roll-helper.js";
import { buildWarfareDisciplineTN } from "../tn.js";
import { ensureEncounterAllowsUtilityAction } from "../encounter/controller.js";

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Open the Discipline Roll dialog and execute the roll for a Warfare Unit actor.
 * Posts a chat card with the result.
 *
 * @param {SimpleActor} actor — the warfare unit opening the dialog
 * @returns {Promise<void>}
 */
export async function rollDisciplineForUnit(actor) {
  const gate = await ensureEncounterAllowsUtilityAction(actor, { actionLabel: "Discipline Test" });
  if (!gate?.allowed) return;

  const baseTn = buildWarfareDisciplineTN(actor).baseTN;

  const choices = await _showDisciplineDialog(actor.name, baseTn);
  if (!choices) return; // cancelled

  const { mode, modifier } = choices;
  const selfTn = buildWarfareDisciplineTN(actor, { manualModifier: modifier });

  if (mode === "opposed") {
    await _runOpposedRoll(actor, selfTn, modifier);
  } else {
    await _runUnopposedRoll(actor, selfTn, modifier);
  }
}

// ── Roll execution ─────────────────────────────────────────────────────────────

async function _runOpposedRoll(actor, selfTn, modifier) {
  const targets = [...(game.user.targets ?? [])];
  if (targets.length !== 1) {
    ui.notifications.warn("Select exactly one target Warfare Unit token for an opposed Discipline roll.");
    return;
  }
  const targetActor = targets[0].actor;
  if (!targetActor || targetActor.type !== "Warfare Unit") {
    ui.notifications.warn("The targeted token must be a Warfare Unit.");
    return;
  }
  if (targetActor.id === actor.id) {
    ui.notifications.warn("Cannot roll opposed against itself.");
    return;
  }

  const targetTn = buildWarfareDisciplineTN(targetActor);

  // Roll both simultaneously
  const [selfResult, targetResult] = await Promise.all([
    doTestRoll(actor,       { target: selfTn.finalTN,   allowLucky: false, allowUnlucky: false }),
    doTestRoll(targetActor, { target: targetTn.finalTN, allowLucky: false, allowUnlucky: false }),
  ]);

  // DSN — simultaneous animation
  if (game.dice3d) {
    await Promise.all(
      [selfResult.roll, targetResult.roll].filter(Boolean)
        .map(r => game.dice3d.showForRoll(r, game.user, true).catch(() => {}))
    );
  }

  const content = _renderOpposedCard(
    actor, selfResult, selfTn, modifier,
    targetActor, targetResult, targetTn
  );
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
  });
}

async function _runUnopposedRoll(actor, selfTn, modifier) {
  const result = await doTestRoll(actor, { target: selfTn.finalTN, allowLucky: false, allowUnlucky: false });

  if (game.dice3d) {
    await game.dice3d.showForRoll(result.roll, game.user, true).catch(() => {});
  }

  const content = _renderUnopposedCard(actor, result, selfTn, modifier);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
  });
}

// ── Dialog ─────────────────────────────────────────────────────────────────────

function _buildDisciplineDialogContent(baseTn) {
  return `
    <div class="warfare-discipline-dialog">
      <div class="form-group">
        <label>Mode</label>
        <select name="mode">
          <option value="unopposed">Unopposed</option>
          <option value="opposed">Opposed <span style="font-size:0.8em; opacity:0.65;">(target required)</span></option>
        </select>
      </div>
      <div class="form-group">
        <label>Modifier</label>
        <input type="number" name="modifier" value="0" style="width:70px;">
        <p class="notes">Flat ±bonus to your Discipline TN (base ${baseTn}).</p>
      </div>
    </div>`;
}

async function _showDisciplineDialog(unitName, baseTn) {
  return customDialog({
    layout: "workflow",
    title: `${unitName} — Discipline Test`,
    content: _buildDisciplineDialogContent(baseTn),
    buttons: {
      roll: {
        label: "Roll",
        callback: (html) => ({
          mode:     html.querySelector('[name="mode"]').value,
          modifier: Number(html.querySelector('[name="modifier"]')?.value ?? 0),
        }),
      },
      cancel: { label: "Cancel" },
    },
    defaultButton: "roll",
  });
}

// ── Chat card rendering ────────────────────────────────────────────────────────

function _esc(val) {
  if (val === null || val === undefined) return "—";
  return String(val)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Render a single unit's result block (shared between opposed and unopposed cards).
 */
function _buildBreakdownRows(tnObj) {
  return (tnObj?.breakdown ?? []).map((entry) => {
    const value = Number(entry?.value ?? 0) || 0;
    const sign = value >= 0 ? "+" : "";
    return `<div style="display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:start;">
      <span style="overflow-wrap:anywhere; word-break:normal; text-align:left;">${_esc(entry?.label ?? "Modifier")}</span>
      <span style="white-space:nowrap; text-align:right;">${sign}${value}</span>
    </div>`;
  }).join("");
}

function _unitBlock(actor, result, tn, modifier) {
  const name    = _esc(actor.name);
  const total   = _esc(result.rollTotal);
  const success = result.isSuccess;
  const degree  = result.degree;
  const label   = success ? `Success (${degree} DoS)` : `Failure (${degree} DoF)`;
  const color   = success ? "green" : "red";
  const tnNote = `${_esc(tn?.finalTN ?? tn ?? 0)}`;
  const breakdownRows = _buildBreakdownRows(tn);
  return `
  <div style="font-size:13px; line-height:1.4;">
    <div style="font-weight:700; margin-bottom:3px;">⚔️ ${name}</div>
    <div style="opacity:0.7; font-size:12px;">TN: ${tnNote}</div>
    <div><b>Roll:</b> ${total} — <span style="color:${color}; font-weight:600;">${_esc(label)}</span></div>
    ${breakdownRows ? `<details style="margin-top:4px;"><summary style="cursor:pointer; user-select:none; white-space:nowrap;">TN breakdown</summary><div style="margin-top:4px; font-size:12px; opacity:0.9;">${breakdownRows}</div></details>` : ""}
  </div>`;
}

function _renderOpposedCard(selfActor, selfResult, selfTn, modifier, targetActor, targetResult, targetTn) {
  const selfBlock   = _unitBlock(selfActor,   selfResult,   selfTn, modifier);
  const targetBlock = _unitBlock(targetActor, targetResult, targetTn, 0);

  const ss = selfResult.isSuccess;
  const ts = targetResult.isSuccess;
  let outcomeHtml;
  if (ss && !ts) {
    outcomeHtml = `<span style="color:green; font-weight:700;">${_esc(selfActor.name)} wins</span>`;
  } else if (!ss && ts) {
    outcomeHtml = `<span style="color:green; font-weight:700;">${_esc(targetActor.name)} wins</span>`;
  } else if (ss && ts) {
    if (selfResult.degree > targetResult.degree) {
      outcomeHtml = `<span style="color:green; font-weight:700;">${_esc(selfActor.name)} wins</span> <span style="opacity:0.7; font-size:12px;">(${selfResult.degree} DoS vs ${targetResult.degree} DoS)</span>`;
    } else if (targetResult.degree > selfResult.degree) {
      outcomeHtml = `<span style="color:green; font-weight:700;">${_esc(targetActor.name)} wins</span> <span style="opacity:0.7; font-size:12px;">(${targetResult.degree} DoS vs ${selfResult.degree} DoS)</span>`;
    } else {
      outcomeHtml = `<span style="font-weight:600;">Tie</span> <span style="opacity:0.7; font-size:12px;">(both succeed — ${selfResult.degree} DoS each)</span>`;
    }
  } else {
    outcomeHtml = `<span style="font-weight:600;">Both fail</span>`;
  }

  return `
<div class="ues-opposed-card" style="max-width:100%; box-sizing:border-box; padding:6px 6px 4px;">
  <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; opacity:0.55; margin-bottom:6px;">Discipline Test — Opposed</div>
  <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; align-items:start; max-width:100%; overflow:hidden;">
    <div style="padding-right:10px; border-right:1px solid rgba(0,0,0,0.12); min-width:0; overflow:hidden;">
      ${selfBlock}
    </div>
    <div style="padding-left:2px; min-width:0; overflow:hidden;">
      ${targetBlock}
    </div>
  </div>
  <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(0,0,0,0.15); font-size:13px;">
    ${outcomeHtml}
  </div>
</div>`;
}

function _renderUnopposedCard(actor, result, tn, modifier) {
  const block = _unitBlock(actor, result, tn, modifier);
  return `
<div class="ues-opposed-card" style="max-width:100%; box-sizing:border-box; padding:6px 6px 4px;">
  <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; opacity:0.55; margin-bottom:6px;">Discipline Test — Unopposed</div>
  ${block}
</div>`;
}
