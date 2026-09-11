import { requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { findAllConditionEffects } from "./queries.js";

export async function removeCondition(actor, key) {
  if (!actor) return;
  const ids = findAllConditionEffects(actor, key).map((effect) => effect?.id).filter(Boolean);
  if (!ids.length) return;

  try {
    await requestDeleteEmbeddedDocuments(actor, "ActiveEffect", ids);
  } catch (_err) {
    // The authority proxy owns user-facing failure reporting.
  }
}
