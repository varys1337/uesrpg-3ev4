import { requestDeleteEmbeddedDocuments } from "../../utils/authority-proxy.js";
import { SYSTEM_ID } from "../constants.js";
import { SKILL_DIFFICULTIES } from "../skills/skill-tn.js";

export function buildDifficultyOptionsHtml(defaultKey = "average") {
  return SKILL_DIFFICULTIES.map((d) => {
    const sign = d.mod >= 0 ? "+" : "";
    const selected = d.key === defaultKey ? "selected" : "";
    return `<option value="${d.key}" ${selected}>${d.label} (${sign}${d.mod})</option>`;
  }).join("\n");
}

export function getCurrentWorldTimeSeconds() {
  const fromApi = Number(game?.uesrpg?.time?.getWorldTimeSeconds?.() ?? NaN);
  if (Number.isFinite(fromApi)) return fromApi;
  const fromCore = Number(game?.time?.worldTime ?? NaN);
  if (Number.isFinite(fromCore)) return fromCore;
  return 0;
}

export async function deleteOwnedEffects(actor, effectIds, { reason = "wounds" } = {}) {
  if (!actor || !Array.isArray(effectIds) || !effectIds.length) return true;

  const ids = effectIds
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);
  if (!ids.length) return true;

  try {
    const ok = await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", ids);
    if (ok !== false) return true;
  } catch (_err) {
    // Fall through to one-by-one fallback.
  }

  let allOk = true;
  for (const id of ids) {
    try {
      const ok = await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", [id]);
      if (ok === false) allOk = false;
    } catch (_err) {
      allOk = false;
    }
  }
  if (!allOk) {
    console.warn(`${SYSTEM_ID} | Failed to delete one or more ActiveEffects during ${reason}`, {
      actor: actor?.uuid ?? actor?.id ?? null,
    });
  }
  return allOk;
}
