import { requestUpdateDocument } from "../../../../utils/authority-proxy.js";
import { SYSTEM_ID, templatePath } from "../../../constants.js";
import {
  extractConfiguredLuckyNumbers,
  extractConfiguredUnluckyNumbers,
} from "../../../../core/luck/lucky-numbers.js";
import { readActorBirthsignLabel } from "../../../../core/traits/starsigns/index.js";

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function appendChargenAudit(actor, entry = {}) {
  if (!actor) return [];
  const chargen = actor.getFlag(SYSTEM_ID, "chargen") ?? {};
  const log = Array.isArray(chargen.auditLog) ? [...chargen.auditLog] : [];
  log.push({
    step: String(entry.step ?? "unknown"),
    action: String(entry.action ?? "update"),
    timestamp: new Date().toISOString(),
    payload: entry.payload ?? {},
  });
  await requestUpdateDocument(actor, { "flags.uesrpg-3ev4.chargen.auditLog": log });
  return log;
}

function collectFavoriteCharacteristics(characteristics = {}) {
  const labels = {
    str: "STR",
    end: "END",
    agi: "AGI",
    int: "INT",
    wp: "WP",
    prc: "PRC",
    prs: "PRS",
    lck: "LCK",
  };
  return Object.entries(characteristics)
    .filter(([, value]) => Boolean(value?.favored))
    .map(([key]) => labels[key] ?? String(key).toUpperCase());
}

export function buildChargenSummary(actor, auditLog = []) {
  const system = actor?.system ?? {};
  const characteristics = system.characteristics ?? {};
  const luckyNumbers = extractConfiguredLuckyNumbers(actor);
  const unluckyNumbers = extractConfiguredUnluckyNumbers(actor);
  const spendLog = Array.isArray(actor?.getFlag(SYSTEM_ID, "chargen")?.spendLog)
    ? actor.getFlag(SYSTEM_ID, "chargen").spendLog
    : [];
  const spellLearningLog = Array.isArray(actor?.getFlag(SYSTEM_ID, "chargen")?.spellLearning?.log)
    ? actor.getFlag(SYSTEM_ID, "chargen").spellLearning.log
    : [];
  const learnedSpells = spellLearningLog
    .filter((row) => row?.outcome === "learned")
    .map((row) => ({
      name: row?.spell?.name ?? "Unknown",
      school: row?.spell?.school ?? "",
      level: asNumber(row?.spell?.level, 1),
      type: row?.spell?.type ?? "conventional",
      paymentMode: row?.paymentMode ?? "xp",
      costXp: asNumber(row?.costs?.xp, 0),
      costWealth: asNumber(row?.costs?.drakes, 0),
      timestamp: row?.timestamp ?? null,
    }));
  const spellBlocked = spellLearningLog
    .filter((row) => row?.outcome === "blocked")
    .map((row) => ({
      name: row?.spell?.name ?? "Unknown",
      reason: row?.reason ?? "blocked",
      paymentMode: row?.paymentMode ?? "xp",
      timestamp: row?.timestamp ?? null,
    }));
  const spellTotals = learnedSpells.reduce((acc, row) => {
    acc.spentXp += asNumber(row.costXp, 0);
    acc.spentWealth += asNumber(row.costWealth, 0);
    const school = String(row.school ?? "").toLowerCase() || "unknown";
    const type = String(row.type ?? "").toLowerCase() || "conventional";
    acc.bySchool[school] = (acc.bySchool[school] ?? 0) + 1;
    acc.byType[type] = (acc.byType[type] ?? 0) + 1;
    return acc;
  }, { spentXp: 0, spentWealth: 0, bySchool: {}, byType: {} });
  const statsGeneration = actor?.getFlag(SYSTEM_ID, "chargen")?.statsGeneration ?? {};
  const rawRollHistory = Array.isArray(statsGeneration?.rollHistory) ? statsGeneration.rollHistory : [];
  const fallbackRollHistory = Array.isArray(statsGeneration?.rollPool) && statsGeneration.rollPool.length
    ? [{
      source: "initial",
      pool: statsGeneration.rollPool,
      luckRoll: asNumber(statsGeneration.luckRoll, 0),
    }]
    : [];
  const rollHistory = (rawRollHistory.length ? rawRollHistory : fallbackRollHistory)
    .map((entry, index) => ({
      source: String(entry?.source ?? (index === 0 ? "initial" : "reroll")).trim() || (index === 0 ? "initial" : "reroll"),
      pool: Array.isArray(entry?.pool) ? entry.pool.map((value) => asNumber(value, 0)) : [],
      luckRoll: asNumber(entry?.luckRoll, 0),
    }))
    .filter((entry) => entry.pool.length > 0);

  return {
    actorUuid: actor?.uuid ?? null,
    actorName: actor?.name ?? "Unknown",
    race: system.race ?? "",
    birthSign: readActorBirthsignLabel(actor),
    resources: {
      wealth: asNumber(system.wealth, 0),
      xpTotal: asNumber(system.xpTotal, 0),
      xp: asNumber(system.xp, 0),
      campaignRank: system.campaignRank ?? "Novice",
    },
    favoredCharacteristics: collectFavoriteCharacteristics(characteristics),
    characteristics: {
      str: asNumber(characteristics.str?.total, 0),
      end: asNumber(characteristics.end?.total, 0),
      agi: asNumber(characteristics.agi?.total, 0),
      int: asNumber(characteristics.int?.total, 0),
      wp: asNumber(characteristics.wp?.total, 0),
      prc: asNumber(characteristics.prc?.total, 0),
      prs: asNumber(characteristics.prs?.total, 0),
      lck: asNumber(characteristics.lck?.total, 0),
    },
    luckyNumbers,
    unluckyNumbers,
    statsGeneration: {
      rerollCount: Math.max(0, rollHistory.length - 1),
      rollHistory,
    },
    spendLog,
    spellLearning: {
      entries: learnedSpells,
      blocked: spellBlocked,
      totals: {
        learnedCount: learnedSpells.length,
        blockedCount: spellBlocked.length,
        spentXp: spellTotals.spentXp,
        spentWealth: spellTotals.spentWealth,
        bySchool: spellTotals.bySchool,
        byType: spellTotals.byType,
      },
      rawLog: spellLearningLog,
    },
    auditLog,
    completedAt: new Date().toISOString(),
  };
}

export function buildChargenSummaryChatHtml(summary) {
  const spendRows = (summary.spendLog ?? []).map((row) => {
    const xp = asNumber(row?.costXp, 0);
    const wealth = asNumber(row?.costWealth, 0);
    return `<li><b>${row?.type ?? "action"}:</b> ${row?.name ?? "Unknown"} (XP ${xp}, Drakes ${wealth})</li>`;
  }).join("");

  const historyRows = (summary.auditLog ?? []).map((row) => {
    return `<li><b>${row.step}</b> - ${row.action} <span style="opacity:.75;">(${row.timestamp})</span></li>`;
  }).join("");
  const spellRows = (summary.spellLearning?.entries ?? []).map((row) => {
    return `<li><b>${row.name}</b> (${row.school} L${row.level}, ${row.type}) - ${row.paymentMode === "drakes" ? `Drakes ${row.costWealth}` : `XP ${row.costXp}`}</li>`;
  }).join("");
  const spellBlockedRows = (summary.spellLearning?.blocked ?? []).map((row) => {
    return `<li><b>${row.name}</b> - ${row.reason}</li>`;
  }).join("");
  const spellTotals = summary.spellLearning?.totals ?? {};
  const statsGeneration = summary.statsGeneration ?? {};
  const statsPoolRows = (statsGeneration.rollHistory ?? []).map((entry, index) => {
    const label = index === 0 ? "Initial Pool" : `Reroll ${index}`;
    const luckPart = Number(entry?.luckRoll ?? 0) > 0 ? ` | Luck ${asNumber(entry.luckRoll, 0)}` : "";
    return `<li><b>${label}:</b> ${(entry?.pool ?? []).join(", ")}${luckPart}</li>`;
  }).join("");

  return `<div class="uesrpg-chat-summary">
    <h2 style="margin:0 0 6px;">Character Generation Complete</h2>
    <p style="margin:0 0 8px;"><b>${summary.actorName}</b> | Race: <b>${summary.race || "N/A"}</b> | Birthsign: <b>${summary.birthSign || "N/A"}</b></p>
    <p style="margin:0 0 8px;">
      Resources: XP ${summary.resources.xp} / ${summary.resources.xpTotal},
      Drakes ${summary.resources.wealth}, Rank ${summary.resources.campaignRank}
    </p>
    <p style="margin:0 0 8px;">
      Favored: ${(summary.favoredCharacteristics ?? []).join(", ") || "None"} |
      Lucky: ${(summary.luckyNumbers ?? []).join(", ") || "None"} |
      Unlucky: ${(summary.unluckyNumbers ?? []).join(", ") || "None"}
    </p>
    <details style="margin:0 0 8px;">
      <summary>Characteristic Roll Pools (${asNumber(statsGeneration.rerollCount, 0)} rerolls)</summary>
      <ul style="margin:6px 0 0 16px;">${statsPoolRows || "<li>None recorded</li>"}</ul>
    </details>
    <details style="margin:0 0 8px;">
      <summary>Spend XP Summary</summary>
      <ul style="margin:6px 0 0 16px;">${spendRows || "<li>None</li>"}</ul>
    </details>
    <details style="margin:0 0 8px;">
      <summary>Spell Learning Summary</summary>
      <p style="margin:6px 0 6px;">
        Learned: ${asNumber(spellTotals.learnedCount, 0)} |
        Blocked: ${asNumber(spellTotals.blockedCount, 0)} |
        Spell XP: ${asNumber(spellTotals.spentXp, 0)} |
        Spell Drakes: ${asNumber(spellTotals.spentWealth, 0)}
      </p>
      <ul style="margin:6px 0 0 16px;">${spellRows || "<li>None</li>"}</ul>
      <p style="margin:8px 0 4px;"><b>Blocked Attempts</b></p>
      <ul style="margin:6px 0 0 16px;">${spellBlockedRows || "<li>None</li>"}</ul>
    </details>
    <details>
      <summary>Chargen Change History</summary>
      <ul style="margin:6px 0 0 16px;">${historyRows || "<li>No recorded changes</li>"}</ul>
    </details>
  </div>`;
}
