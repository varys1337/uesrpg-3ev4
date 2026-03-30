import { getCombatRollModeMessageOptions } from "./settings.js";

export async function emitDynamicInitiativeRoundSummary(summary, { combatId = null, round = null } = {}) {
  void combatId;
  const rows = Array.isArray(summary?.rows) ? summary.rows : [];
  if (!rows.length) return;

  const esc = (v) => foundry.utils.escapeHTML(String(v ?? ""));
  const sorted = rows.slice().sort((a, b) => {
    const ai = Number(a?.initiative ?? Number.NEGATIVE_INFINITY);
    const bi = Number(b?.initiative ?? Number.NEGATIVE_INFINITY);
    if (ai !== bi) return bi - ai;
    return String(a?.combatantName ?? "").localeCompare(String(b?.combatantName ?? ""));
  });
  const choiceLabel = (row) => {
    const choice = String(row?.choice ?? "normal");
    if (choice === "combatSenses") return "Combat Senses";
    if (choice === "tactician") {
      const tacticianName = String(row?.tacticianName ?? "").trim();
      return tacticianName ? `Tactician (${tacticianName})` : "Tactician";
    }
    return "Normal";
  };

  const content = `
      <div class="uesrpg-damage-applied-card">
        <div class="hdr">
          <div class="hdr-text">
            <div class="title">Initiative - Round ${Number(round ?? summary?.round ?? 0)}</div>
          </div>
        </div>
        <div class="body">
          ${sorted.map((row, idx) => `
            <div class="uesrpg-da-row">
              <span class="k">${idx + 1}. ${esc(row?.combatantName ?? "Combatant")}</span>
              <span class="v"><b>${Number(row?.initiative ?? 0)}</b> <span class="muted">(${esc(choiceLabel(row))}, ${esc(row?.formula ?? "0")})</span></span>
            </div>
          `).join("")}
        </div>
      </div>
    `;

  const modeOpts = getCombatRollModeMessageOptions();
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ alias: "Initiative" }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    ...modeOpts,
  });

  const dsn = game?.dice3d;
  if (!dsn || typeof dsn.showForRoll !== "function") return;
  const isPublic = modeOpts.rollMode === "roll" || modeOpts.rollMode === "publicroll";
  const sync = Boolean(isPublic);
  const rolls = sorted.map((r) => r?.roll).filter(Boolean);
  await Promise.allSettled(rolls.map(async (roll) => {
    try {
      await dsn.showForRoll(roll, game.user, sync);
    } catch (_err) {
      try { await dsn.showForRoll(roll); } catch (_err2) {}
    }
  }));
}
