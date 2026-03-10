import { customDialog } from "../utils/dialog-v2-helper.js";
import { requestUpdateDocument } from "../utils/authority-proxy.js";

function _campaignRankFromXpTotal(xpTotalRaw) {
  const xpTotal = Number(xpTotalRaw);
  const safe = Number.isFinite(xpTotal) ? xpTotal : 0;
  if (safe >= 7000) return "Master";
  if (safe >= 5500) return "Expert";
  if (safe >= 4000) return "Adept";
  if (safe >= 2500) return "Journeyman";
  if (safe >= 1000) return "Apprentice";
  return "Novice";
}

function _resolveSelectedPcActors() {
  const tokens = Array.from(canvas?.tokens?.controlled ?? []);
  const actors = [];
  const seen = new Set();

  for (const token of tokens) {
    const actor = token?.actor ?? null;
    if (!actor) continue;
    if (String(actor.type ?? "").toLowerCase() !== "player character") continue;
    if (seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    actors.push(actor);
  }

  return actors;
}

export async function awardXpToSelectedPcs(opts = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn?.("Only a GM can award XP.");
    return { ok: false, reason: "not-gm" };
  }

  const actors = _resolveSelectedPcActors();
  if (!actors.length) {
    ui.notifications?.warn?.("Select one or more PC tokens first.");
    return { ok: false, reason: "no-selected-pcs" };
  }

  const choice = await customDialog({
    title: "Award XP to Selected PCs",
    content: `<div style="display:flex;flex-direction:column;gap:8px;">
      <p style="margin:0;">Selected PCs: <strong>${actors.length}</strong></p>
      <label style="display:flex;flex-direction:column;gap:4px;">
        <span>XP Amount</span>
        <input id="award-xp-amount" type="number" min="0" step="1" value="${Number(opts.amount ?? 0) || 0}">
      </label>
    </div>`,
    buttons: {
      submit: {
        label: "Award XP",
        callback: async (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const amount = Math.max(0, Number(root?.querySelector("#award-xp-amount")?.value ?? 0) || 0);
          if (amount <= 0) {
            ui.notifications?.warn?.("Enter an XP amount greater than 0.");
            return { ok: false, reason: "invalid-amount" };
          }

          let updated = 0;
          let failed = 0;
          for (const actor of actors) {
            const currentXp = Math.max(0, Number(actor.system?.xp ?? 0) || 0);
            const currentXpTotal = Math.max(0, Number(actor.system?.xpTotal ?? 0) || 0);
            const nextXp = currentXp + amount;
            const nextXpTotal = currentXpTotal + amount;
            const nextRank = _campaignRankFromXpTotal(nextXpTotal);

            const ok = await requestUpdateDocument(actor, {
              "system.xp": nextXp,
              "system.xpTotal": nextXpTotal,
              "system.campaignRank": nextRank,
            });

            if (ok !== false) updated += 1;
            else failed += 1;
          }

          if (updated > 0) {
            ui.notifications?.info?.(`Awarded ${amount} XP to ${updated} PC${updated === 1 ? "" : "s"}.`);
          }
          if (failed > 0) {
            ui.notifications?.warn?.(`${failed} PC update${failed === 1 ? "" : "s"} failed. Check console.`);
          }

          return { ok: failed === 0, updated, failed, amount };
        },
      },
      cancel: { label: "Cancel", callback: () => ({ ok: false, reason: "cancelled" }) },
    },
    defaultButton: "submit",
  });

  return choice ?? { ok: false, reason: "cancelled" };
}

export function registerAwardXpMacroApi() {
  game.uesrpg = game.uesrpg || {};
  game.uesrpg.xp = game.uesrpg.xp || {};
  game.uesrpg.xp.awardToSelectedPcs = awardXpToSelectedPcs;
}
