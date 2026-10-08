import { SYSTEM_ID } from "../system/namespace.js";
import { readSettingIfRegistered } from "../../utils/settings-registration.js";

export const OUTCOME_APPLICATION_SETTING = "combatOutcomeApplicationMode";

export function getOutcomeApplicationMode() {
  const value = readSettingIfRegistered(OUTCOME_APPLICATION_SETTING, "gm");
  return ["gm", "owners", "automatic"].includes(value) ? value : "gm";
}

export function createOutcomeApplicationMetadata() {
  return {
    version: 1,
    id: foundry.utils.randomID(),
    autoEligible: getOutcomeApplicationMode() === "automatic",
  };
}

export function createChatOutcome({ adapter, kind = "effect", sourceActorUuid = "", targetUuid, payload = {}, label = "" }) {
  if (!adapter || !targetUuid || !["damage", "healing", "effect"].includes(kind)) {
    throw new Error("A chat outcome requires an adapter, a recipient, and a supported kind.");
  }
  return {
    ...createOutcomeApplicationMetadata(),
    adapter, kind, sourceActorUuid, targetUuid, label,
    payload: foundry.utils.deepClone(payload),
    status: "pending",
  };
}

export function chatOutcomeFlags(entries) {
  return { [SYSTEM_ID]: { chatOutcomes: { version: 1, entries } } };
}

/** Result identity and completed application records survive stale card patches. */
export function mergeChatOutcomeEnvelope(previous, incoming) {
  if (incoming?.version !== 1 || !Array.isArray(incoming.entries)) return incoming;
  const entries = foundry.utils.deepClone(previous?.version === 1 && Array.isArray(previous.entries) ? previous.entries : [])
    .filter(entry => entry && typeof entry.id === "string");
  for (const entry of incoming.entries) {
    if (!entry || typeof entry.id !== "string") continue;
    const existing = entries.find(candidate => candidate.id === entry.id);
    if (!existing) entries.push(foundry.utils.deepClone(entry));
    else if (!["applied", "partial"].includes(existing.status)) {
      for (const key of ["status", "error", "result"]) if (entry[key] !== undefined) existing[key] = foundry.utils.deepClone(entry[key]);
    }
  }
  return { ...incoming, entries, revision: Math.max(Number(previous?.revision ?? 0) + 1, Number(incoming.revision ?? 0)) };
}

/** Stamp only the transition to an applicable result, never an old pending card. */
export function stampInlineOutcomeApplications(data, prior = {}, family = "combat") {
  const entries = Array.isArray(data.defenders) ? data.defenders : [data.defender ?? data];
  const previous = Array.isArray(prior.defenders) ? prior.defenders : [prior.defender ?? prior];
  for (const entry of entries) {
    const damage = entry?.damage ?? (entries.length === 1 ? data.damage : null);
    if (!damage?.applyPayload || damage.applied || damage.application) continue;
    const oldEntry = previous.find(old => entry?.tokenUuid
      ? old?.tokenUuid === entry.tokenUuid : old?.actorUuid === entry?.actorUuid);
    const oldDamage = oldEntry?.damage ?? (previous.length === 1 ? prior.damage : null);
    if (oldDamage?.applyPayload) continue;
    damage.application = { ...createOutcomeApplicationMetadata(), family };
  }
}
