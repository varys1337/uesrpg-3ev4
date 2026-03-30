import { requestUpdateDocument } from "../../../utils/authority-proxy.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { isPerfEnabled, monoMs, perfRecord } from "../../../utils/perf-tracker.js";

function _actorHasCondition(actor, key) {
  if (!actor || !key) return false;
  const k = String(key).trim().toLowerCase();
  const api = game?.uesrpg?.conditions;
  if (api?.hasCondition && typeof api.hasCondition === "function") {
    try { return !!api.hasCondition(actor, k); } catch (_e) {}
  }

  const effects = actor?.effects?.contents ?? [];
  return effects.some((e) => {
    const n = String(e?.name ?? "").trim().toLowerCase();
    return n === k || n.startsWith(`${k} `) || n.startsWith(`${k}(`);
  });
}

export async function refreshActionPointsForCombatActor(actor) {
  if (!actor) return;

  const maxRaw = Number(actor?.system?.action_points?.max ?? 0);
  const max = Number.isFinite(maxRaw) ? maxRaw : 0;

  if (_actorHasCondition(actor, "stunned")) {
    const currentAP = Number(actor?.system?.action_points?.value ?? -1);
    if (currentAP === 0) return;
    await requestUpdateDocument(actor, { "system.action_points.value": 0 }).catch(err => {
      console.warn("UESRPG | Failed to suppress AP refresh for stunned actor", actor?.name, err);
    });
    return;
  }

  const min = _actorHasCondition(actor, "dazed") ? 1 : 0;
  let next = Math.max(min, max);
  const debtRaw = Number(actor.getFlag(FLAG_SCOPE, "wounds.apDebtNextRefresh") ?? 0);
  const debt = Number.isFinite(debtRaw) ? debtRaw : 0;
  const updateData = { "system.action_points.value": next };
  if (debt > 0) {
    next = Math.max(min, next - debt);
    updateData["system.action_points.value"] = next;
    updateData[`flags.${FLAG_SCOPE}.wounds.-=apDebtNextRefresh`] = null;
  }

  if (!debt) {
    const currentAP = Number(actor?.system?.action_points?.value ?? -1);
    if (currentAP === next) return;
  }

  await requestUpdateDocument(actor, updateData).catch(err => {
    console.warn("UESRPG | Failed to refresh action points for", actor?.name, err);
  });
}

export async function resetAllActionPointsForCombat(combat) {
  const _perf = isPerfEnabled();
  const _t0 = _perf ? monoMs() : 0;
  const BATCH_SIZE = 25;
  const turns = Array.from(combat?.turns ?? []);
  let _updatesAttempted = 0;
  for (let i = 0; i < turns.length; i += BATCH_SIZE) {
    const slice = turns.slice(i, i + BATCH_SIZE);
    _updatesAttempted += slice.filter(c => c?.actor).length;
    const promises = slice.map(combatant => refreshActionPointsForCombatActor(combatant?.actor));
    await Promise.allSettled(promises);
  }
  if (_perf) {
    perfRecord({
      event: "combat.resetAllAP",
      combatId: combat?.id,
      round: combat?.round,
      combatantsTotal: turns.length,
      documentUpdatesAttempted: _updatesAttempted,
      durationMs: monoMs() - _t0,
    });
  }
}
