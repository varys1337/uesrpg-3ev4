import { hasTalent } from "../../core/traits/talents-api.js";
import { clearRacialTalentUsageOnRest } from "../../core/traits/racial-talents.js";
import { _num } from "../../utils/coerce.js";
import { _canPromptForActor } from "../../core/traits/index.js";
import { customDialog } from "../../utils/dialog-v2-helper.js";
import { requestUpdateDocument } from "../../utils/authority-proxy.js";

// Chapter 5: Untreated wounds block natural HP regeneration.
// Reuse the authoritative helper from the wounds subsystem when available.
function hasUntreatedWounds(actor) {
  const api = game?.uesrpg?.wounds;
  if (api?.canNaturalHeal) return !api.canNaturalHeal(actor);
  // Fallback: if we cannot evaluate wound treatment state, assume wounded = untreated.
  return Boolean(actor?.system?.wounded);
}

const _hpHealSkipNotify = new Map();

function _notifyHpHealingSkipped(actor) {
  try {
    if (!ui?.notifications?.warn) return;
    const key = String(actor?.id ?? actor?._id ?? "");
    const now = Date.now();
    const last = _hpHealSkipNotify.get(key) ?? 0;
    // Avoid rapid duplicate toasts (e.g., group rest runs).
    if (now - last < 1000) return;
    _hpHealSkipNotify.set(key, now);
    ui.notifications.warn(`${actor?.name ?? "Actor"}: Natural HP healing skipped due to untreated wounds.`);
  } catch (_) {
    // Intentionally ignore notification failures.
  }
}

export function buildRestChatContent(title, lines) {
  const safeLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
  return `<h3>${title}</h3><ul>${safeLines.join("")}</ul>`;
}

async function _promptMeditationChoice(actor) {
  return await customDialog({
    title: "Meditation",
    content: `
      <div class="uesrpg-meditation-short-rest">
        <p><b>${foundry.utils.escapeHTML(actor?.name ?? "Actor")}</b> has <b>Meditation</b>.</p>
        <p>Spend this short rest in uninterrupted meditation to <b>double</b> normal Magicka and Stamina regeneration?</p>
      </div>
    `,
    buttons: {
      yes: { label: "Meditate", callback: () => true },
      no: { label: "Normal Rest", callback: () => false }
    },
    default: "yes",
    width: 420
  });
}

export async function applyShortRest(actor, opts = {}) {
  if (!actor) return { line: "", updatesApplied: false };

  // Fatigue level is derived; the persistable control is fatigue.bonus (see Actor prepare).
  const fatigueBonus = _num(actor.system?.fatigue?.bonus ?? 0);
  const currentSP = _num(actor.system?.stamina?.value ?? 0);
  const maxSP = _num(actor.system?.stamina?.max ?? 0);
  const currentMP = _num(actor.system?.magicka?.value ?? 0);
  const maxMP = _num(actor.system?.magicka?.max ?? 0);
  const currentHP = _num(actor.system?.hp?.value ?? 0);
  const maxHP = _num(actor.system?.hp?.max ?? 0);

  const updateData = {};
  let line = `<li><b>${actor.name}</b>: `;

  // Meditation (Chapter 4): optional short rest mode that doubles MP/SP regeneration.
  const allowPrompt = opts?.allowPrompt !== false;
  let useMeditation = false;
  if (hasTalent(actor, "meditation")) {
    if (typeof opts?.useMeditation === "boolean") {
      useMeditation = opts.useMeditation;
    } else if (allowPrompt && _canPromptForActor(actor)) {
      try {
        useMeditation = await _promptMeditationChoice(actor);
      } catch (_e) {
        useMeditation = false;
      }
    }
  }

  // RAW: Remove 1 fatigue OR recover 1 SP
  if (fatigueBonus > 0) {
    updateData["system.fatigue.bonus"] = Math.max(0, fatigueBonus - 1);
    line += `Removed 1 fatigue (now ${Math.max(0, fatigueBonus - 1)})`;
  } else if (currentSP < maxSP) {
    const deltaSP = useMeditation ? 2 : 1;
    const newSP = Math.min(currentSP + deltaSP, maxSP);
    updateData["system.stamina.value"] = newSP;
    line += `Recovered ${Math.min(deltaSP, Math.max(0, maxSP - currentSP))} SP (now ${newSP}/${maxSP})`;
  } else {
    line += "No recovery needed";
  }

  // RAW: Recover MP = floor(maxMP / 10)
  const mpRecoverBase = Math.floor(maxMP / 10);
  const mpRecover = useMeditation ? (mpRecoverBase * 2) : mpRecoverBase;
  if (mpRecover > 0 && currentMP < maxMP) {
    const newMP = Math.min(currentMP + mpRecover, maxMP);
    updateData["system.magicka.value"] = newMP;
    line += ` (+${mpRecover} MP)`;
  }

  // Rapid Recovery (Chapter 4): heal 1d4 HP on a short rest.
  if (hasTalent(actor, "rapidrecovery") && currentHP < maxHP) {
    try {
      const roll = await new Roll("1d4").evaluate();
      const heal = Math.max(0, Number(roll.total ?? 0) || 0);
      if (heal > 0) {
        const newHP = Math.min(maxHP, currentHP + heal);
        updateData["system.hp.value"] = newHP;
        line += ` (+${heal} HP)`;
      }
    } catch (_e) {
      // Non-blocking.
    }
  }

  if (useMeditation) line += " (Meditation)";

  line += "</li>";

  const hasUpdates = Object.keys(updateData).length > 0;
  if (hasUpdates) await requestUpdateDocument(actor, updateData);
  try { await clearRacialTalentUsageOnRest(actor, { restType: "short" }); } catch (_e) { /* ignore */ }

  return { line, updatesApplied: hasUpdates };
}

export async function applyLongRest(actor) {
  if (!actor) return { line: "", updatesApplied: false };

  const endBonus = Math.floor(_num(actor.system?.characteristics?.end?.total ?? 0) / 10);
  // Fatigue level is derived; the persistable control is fatigue.bonus (see Actor prepare).
  const fatigueBonus = _num(actor.system?.fatigue?.bonus ?? 0);
  const currentHP = _num(actor.system?.hp?.value ?? 0);
  const maxHP = _num(actor.system?.hp?.max ?? 0);
  const currentSP = _num(actor.system?.stamina?.value ?? 0);
  const maxSP = _num(actor.system?.stamina?.max ?? 0);
  const currentMP = _num(actor.system?.magicka?.value ?? 0);
  const maxMP = _num(actor.system?.magicka?.max ?? 0);
  const untreatedWounds = hasUntreatedWounds(actor);

  const updateData = {};
  const recoveryParts = [];

  // RAW: Remove fatigue levels first; remaining recovery applies to SP.
  let recoveryPool = Math.max(0, endBonus);

  if (fatigueBonus > 0 && recoveryPool > 0) {
    const fatigueRemoved = Math.min(fatigueBonus, recoveryPool);
    const newFatigue = Math.max(0, fatigueBonus - fatigueRemoved);
    updateData["system.fatigue.bonus"] = newFatigue;
    recoveryParts.push(`Removed ${fatigueRemoved} fatigue`);
    recoveryPool -= fatigueRemoved;
  }

  if (recoveryPool > 0 && currentSP < maxSP) {
    const spRecovered = Math.min(recoveryPool, Math.max(0, maxSP - currentSP));
    const newSP = Math.min(maxSP, currentSP + spRecovered);
    updateData["system.stamina.value"] = newSP;
    recoveryParts.push(`Recovered ${spRecovered} SP (${newSP}/${maxSP})`);
    recoveryPool -= spRecovered;
  }

  // RAW: Heal END bonus HP on long rest only if there are no untreated wounds.
  if (!untreatedWounds && currentHP < maxHP && endBonus > 0) {
    // Rapid Recovery (Chapter 4): double natural healing rate.
    const healBase = hasTalent(actor, "rapidrecovery") ? (endBonus * 2) : endBonus;
    const hpHealed = Math.min(healBase, maxHP - currentHP);
    updateData["system.hp.value"] = currentHP + hpHealed;
    recoveryParts.push(`Healed ${hpHealed} HP`);
  } else if (untreatedWounds && currentHP < maxHP) {
    recoveryParts.push("HP not healed (untreated wounds)");
  }

  // RAW: Regenerate all missing MP.
  if (currentMP < maxMP) {
    updateData["system.magicka.value"] = maxMP;
    recoveryParts.push("Recovered all MP");
  }

  if (!recoveryParts.length) recoveryParts.push("No recovery needed");

  const line = `<li><b>${actor.name}</b>: ${recoveryParts.join("; ")}</li>`;

  const hasUpdates = Object.keys(updateData).length > 0;
  if (hasUpdates) await requestUpdateDocument(actor, updateData);
  try { await clearRacialTalentUsageOnRest(actor, { restType: "long" }); } catch (_e) { /* ignore */ }

  if (untreatedWounds && currentHP < maxHP) _notifyHpHealingSkipped(actor);

  return { line, updatesApplied: hasUpdates };
}
