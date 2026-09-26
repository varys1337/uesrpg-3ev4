import { safeUpdateChatMessage } from "../../../utils/chat-message-socket.js";
import { cloneFlagState } from "../../../utils/clone.js";
import { perfStart, perfEnd } from "../../../utils/debug.js";
import { enqueueCardUpdate } from "./message-queue.js";

function protectLane(fresh, patch, family) {
  if (!fresh || !patch) return;
  if (family === "skills" || family === "char") {
    if (fresh.result && patch.result === null) patch.result = cloneFlagState(fresh.result);
    return;
  }
  const nullProtected = [
    "result", "tn", "declaration", "banked", "request", "itemUuid", "defenseType", "styleUuid", "skillUuid",
    "label", "defenseLabel", "testLabel", "variantLabel", "circumstanceLabel", "targetLabel", "variant", "rollMessageId",
    ...(family === "magic" ? ["castSource", "spellUuid"] : ["blockSource"]),
  ];
  for (const key of nullProtected) if (fresh[key] != null && patch[key] === null) patch[key] = cloneFlagState(fresh[key]);
  for (const key of ["hasDeclared", "declared"]) {
    if (fresh[key] === true && patch[key] != null && !patch[key]) patch[key] = true;
  }
  if (fresh.banked && patch.banked && typeof patch.banked === "object") {
    if (fresh.banked.committed === true && patch.banked.committed === false) patch.banked.committed = true;
    for (const key of ["committedAt", "committedBy"]) {
      if (fresh.banked[key] != null && patch.banked[key] === null) patch.banked[key] = fresh.banked[key];
    }
  }
  for (const key of ["target", "baseTarget", "totalMod", "variantMod", "manualMod", "circumstanceMod", ...(family === "combat" ? ["pendingApCost"] : [])]) {
    if (Number.isFinite(fresh[key]) && patch[key] === null) patch[key] = fresh[key];
  }
}

function protectCommittedState(fresh, patch, family) {
  protectLane(fresh.attacker, patch.attacker, family);
  protectLane(fresh.defender, patch.defender, family);
  if (Array.isArray(fresh.defenders) && Array.isArray(patch.defenders)) {
    for (const [index, lane] of patch.defenders.entries()) {
      const prior = fresh.defenders.find((entry) => lane?.tokenUuid
        ? entry?.tokenUuid === lane.tokenUuid
        : lane?.actorUuid && entry?.actorUuid === lane.actorUuid) ?? fresh.defenders[index];
      protectLane(prior, lane, family);
    }
  }
  if (!["combat", "magic"].includes(family) || !fresh.context || !patch.context) return;
  for (const key of ["autoRollRequested", "noDefense"]) {
    if (fresh.context[key] === true && [false, null].includes(patch.context[key])) patch.context[key] = true;
  }
  for (const key of ["autoRollRequestedAt", "autoRollRequestedBy"]) {
    if (fresh.context[key] != null && patch.context[key] === null) patch.context[key] = fresh.context[key];
  }
}

/** Explicit resets (retargeting) may replace state only at the read revision. */
export function replaceOpposedCardState(updateCard, message, data, render) {
  const expected = Number(data.context?.updatedSeq) || 0;
  return updateCard(message, (fresh) => {
    if ((Number(fresh.context?.updatedSeq) || 0) !== expected) {
      throw new Error("The opposed card changed during retargeting. Refresh it before retrying.");
    }
    return cloneFlagState(data);
  }, render, { replace: true });
}

/** Family adapters own schemas and rendering; this owns every persistence stage. */
export function createOpposedCardUpdater({ scope, key, version, family, wrapped = true, reconcile = null, render = null }) {
  return function updateCard(message, data, renderOverride = render, { replace = false } = {}) {
    const messageId = message?.id ?? message?._id;
    if (!messageId) throw new Error("Cannot persist a workflow without a ChatMessage id.");
    return enqueueCardUpdate(messageId, async () => {
      const liveMessage = game.messages.get(messageId) ?? message;
      const raw = liveMessage.flags?.[scope]?.[key];
      const live = (wrapped ? raw?.state ?? raw : raw) ?? {};
      const draft = cloneFlagState(live);
      const patch = cloneFlagState(typeof data === "function" ? await data(draft, liveMessage) ?? draft : data ?? {});
      const fresh = cloneFlagState(live);
      // Both mutators and object patches retain confirmed lane data. Explicit,
      // revision-checked resets are the only callers allowed to replace it.
      if (!replace) protectCommittedState(fresh, patch, family);
      const merged = replace ? patch
        : foundry.utils.mergeObject(fresh, patch, { overwrite: true, insertKeys: true, insertValues: true });
      if (reconcile) reconcile(merged);
      const diff = foundry.utils.diffObject(live, merged);
      if (!Object.keys(diff ?? {}).length) return { ok: true, changed: false, state: merged, message: liveMessage };
      merged.context ??= {};
      merged.context.schemaVersion ??= version;
      merged.context.updatedAt = Date.now();
      merged.context.updatedBy = game.user.id;
      merged.context.updatedSeq = Math.max(Number(live.context?.updatedSeq) || 0, Number(merged.context.updatedSeq) || 0) + 1;
      const label = `card.update:${family}:${messageId}`;
      perfStart(label);
      try {
        const content = renderOverride(merged, messageId);
        const payload = { content, flags: { [scope]: { [key]: wrapped ? { version, state: merged } : merged } } };
        if (!await safeUpdateChatMessage(liveMessage, payload)) throw new Error("Workflow update was rejected; refresh the card before retrying.");
        return { ok: true, changed: true, state: merged, message: liveMessage };
      } finally {
        perfEnd(label);
      }
    });
  };
}
