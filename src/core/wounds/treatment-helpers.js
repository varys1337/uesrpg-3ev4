import { customDialog } from "../../utils/dialog-v2-helper.js";
import { SKILL_DIFFICULTIES } from "../skills/skill-tn.js";
import { buildDifficultyOptionsHtml } from "./shared.js";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

export function findHealerKit(actor) {
  const items = actor?.items?.contents ?? [];
  return items.some((i) => {
    const qty = Number(i?.system?.quantity ?? 1);
    if (qty <= 0) return false;
    const name = String(i?.name ?? "").toLowerCase();
    return name.includes("healer") || name.includes("healing kit") || name.includes("medicine kit") || name.includes("bandage");
  });
}

function normalizeHealingToken(v) {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseHealingTN(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const match = s.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : 0;
}

function isHealingToken(...parts) {
  const text = normalizeHealingToken(parts.filter(Boolean).join(" "));
  if (!text) return false;
  return text.includes("survival")
    || text.includes("medicine")
    || text.includes("medic")
    || text.includes("professionmedicine");
}

export function collectHealingTestCandidates(healer) {
  if (!healer) return [];
  const candidates = [];
  const pushCandidate = (id, label, tn, source) => {
    const num = parseHealingTN(tn);
    if (!Number.isFinite(num) || num <= 0) return;
    const safeId = String(id ?? "").trim();
    if (!safeId) return;
    candidates.push({
      id: safeId,
      label: String(label ?? safeId),
      tn: Math.max(0, num),
      source: String(source ?? "unknown"),
    });
  };

  const prof = healer.system?.professions ?? {};
  for (const [k, v] of Object.entries(prof)) {
    if (!isHealingToken(k)) continue;
    pushCandidate(`prof:${k}`, `Profession: ${k}`, v ?? 0, "professions");
  }

  const skills = healer.system?.skills ?? {};
  for (const [skillKey, skillData] of Object.entries(skills)) {
    const entry = skillData ?? {};
    const specialization = String(entry?.specialization ?? "");
    const isProfessionSlot = skillKey === "profession1" || skillKey === "profession2" || skillKey === "profession3";
    const keyMatch = isHealingToken(skillKey);
    const specMatch = isHealingToken(specialization);
    if (!(keyMatch || specMatch || (isProfessionSlot && specMatch))) continue;
    const label = specMatch
      ? `Skill: ${specialization} (${skillKey})`
      : `Skill: ${skillKey}`;
    const idBase = `skill:${skillKey}:${specialization || "base"}`;
    pushCandidate(`${idBase}:tn`, label, entry?.tn, "system.skills");
    pushCandidate(`${idBase}:value`, label, entry?.value, "system.skills");
    pushCandidate(`${idBase}:total`, label, entry?.total, "system.skills");
    pushCandidate(`${idBase}:final`, label, entry?.final, "system.skills");
  }

  const items = healer.items?.contents ?? [];
  for (const i of items) {
    const name = String(i?.name ?? "");
    const field = String(i?.system?.field ?? "");
    const specialization = String(i?.system?.specialization ?? "");
    const itemType = String(i?.type ?? "").toLowerCase();
    if (!isHealingToken(name, field, specialization)) continue;
    const label = `Item: ${name || "Skill"}`;
    const idBase = `item:${String(i?.id ?? i?.uuid ?? (name || "unknown"))}`;
    pushCandidate(`${idBase}:value`, label, i?.system?.value, itemType === "skill" ? "skill-item" : "item");
    pushCandidate(`${idBase}:tn`, label, i?.system?.tn, itemType === "skill" ? "skill-item" : "item");
    pushCandidate(`${idBase}:total`, label, i?.system?.total, itemType === "skill" ? "skill-item" : "item");
    pushCandidate(`${idBase}:final`, label, i?.system?.final, itemType === "skill" ? "skill-item" : "item");
  }

  const seen = new Set();
  const deduped = [];
  for (const c of candidates) {
    const key = `${c.id}|${c.tn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }
  deduped.sort((a, b) => Number(b.tn) - Number(a.tn));
  return deduped;
}

export function resolveHealingTestTarget(healer) {
  const c = collectHealingTestCandidates(healer);
  return c.length ? Math.max(0, Number(c[0]?.tn ?? 0) || 0) : 0;
}

export async function promptTreatWoundRollOptions(healer, candidates = []) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const candidateOptions = candidates.map((c, idx) => {
    const selected = idx === 0 ? "selected" : "";
    return `<option value="${c.id}" ${selected}>${esc(c.label)} (TN ${Number(c.tn) || 0})</option>`;
  }).join("\n");

  const content = `
    <div class="uesrpg-skill-roll">
      <div class="form-group">
        <label><b>Skill Lane</b></label>
        <select name="candidateId" style="width:100%;">${candidateOptions}</select>
      </div>
      <div class="form-group" style="margin-top:8px;">
        <label><b>Difficulty</b></label>
        <select name="difficultyKey" style="width:100%;">${buildDifficultyOptionsHtml("average")}</select>
      </div>
      <div class="form-group" style="margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <label style="margin:0;"><b>Manual Modifier</b></label>
        <input name="manualMod" type="number" value="0" style="width:120px;" />
      </div>
    </div>
  `;

  const result = await customDialog({
    layout: "workflow",
    title: `Treat Wound - ${esc(healer?.name ?? "Healer")} Roll Options`,
    content,
    buttons: {
      roll: {
        label: "Roll",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          const candidateId = String(root?.querySelector('select[name="candidateId"]')?.value ?? "").trim();
          const difficultyKey = String(root?.querySelector('select[name="difficultyKey"]')?.value ?? "average");
          const manualMod = Number.parseInt(String(root?.querySelector('input[name="manualMod"]')?.value ?? "0"), 10) || 0;
          return { candidateId, difficultyKey, manualMod };
        },
      },
      cancel: { label: "Cancel", callback: () => null },
    },
    default: "roll",
    width: 420,
  });
  if (!result) return null;
  const selected = candidates.find((c) => c.id === String(result.candidateId ?? "").trim()) ?? candidates[0];
  const diff = SKILL_DIFFICULTIES.find((d) => d.key === String(result.difficultyKey ?? "average")) ?? SKILL_DIFFICULTIES.find((d) => d.key === "average");
  const finalTN = Math.max(0, (Number(selected?.tn ?? 0) || 0) + (Number(diff?.mod ?? 0) || 0) + (Number(result.manualMod ?? 0) || 0));
  return {
    candidate: selected,
    difficulty: diff,
    manualMod: Number(result.manualMod ?? 0) || 0,
    target: finalTN,
  };
}
