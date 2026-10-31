import { requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { findAllConditionEffects } from "./queries.js";

export async function removeCondition(actor, key, { requireConfirmed = false, operationGuard = null } = {}) {
  if (!actor) return;
  const ids = findAllConditionEffects(actor, key).map((effect) => effect?.id).filter(Boolean);
  if (!ids.length) return;

  try {
    operationGuard?.();
    const removed = await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", ids, { requireDeleted: requireConfirmed });
    if (requireConfirmed && !removed) throw new Error("Condition removal was not confirmed.");
  } catch (_err) {
    if (requireConfirmed) throw _err;
    // The authority proxy owns user-facing failure reporting.
  }
}
