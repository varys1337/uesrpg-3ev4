import { FLAG_SCOPE } from "../../../core/constants.js";
import { registerOnce } from "../../_internal/hook-registry.js";
import { requestAtomicUpdateDocument } from "../../../utils/authority-proxy.js";
import { isActiveGMUser } from "../../../utils/users.js";

const pending = new Map();
const failures = [];
const BUFFER_TYPES = new Set(["physical", "magical", "elemental"]);

/** Recompute each affected pool once from fresh surviving effects. */
export async function reconcileSpellBuffers(actor, types, { strict = false } = {}) {
  const wanted = new Set(Array.from(types ?? []).filter(type => BUFFER_TYPES.has(type)));
  if (!actor || !wanted.size) return true;
  let changed = false;
  let calculated = false;
  const confirmed = await requestAtomicUpdateDocument(actor, fresh => {
    calculated = true;
    const updates = {};
    for (const type of wanted) {
      const values = Array.from(fresh.effects ?? [])
        .filter(effect => effect.flags?.[FLAG_SCOPE]?.bufferApplied && effect.flags[FLAG_SCOPE].bufferType === type)
        .map(effect => Number(effect.flags[FLAG_SCOPE].bufferOriginalValue ?? 0))
        .filter(Number.isFinite);
      const value = values.length ? Math.max(...values) : 0;
      if (Number(fresh.system?.buffers?.[type] ?? 0) !== value) updates[`system.buffers.${type}`] = value;
    }
    changed = Object.keys(updates).length > 0;
    return updates;
  }, { perfKind: "spellLifecycle" });
  const ok = confirmed || (calculated && !changed);
  if (strict && !ok) throw new Error("Spell buffer reconciliation was not confirmed.");
  return ok;
}

function enqueueBufferCleanup(actor, type) {
  const key = actor.uuid;
  let state = pending.get(key);
  if (state) { state.types.add(type); return state.promise; }
  state = { types: new Set([type]), promise: null };
  state.promise = (async () => {
    while (state.types.size) {
      const types = new Set(state.types);
      state.types.clear();
      await reconcileSpellBuffers(actor, types, { strict: true });
    }
  })().finally(() => pending.delete(key));
  pending.set(key, state);
  return state.promise;
}

export async function settlePendingBufferCleanup() {
  const errors = [...failures.splice(0)];
  while (pending.size) {
    const results = await Promise.allSettled(Array.from(pending.values(), state => state.promise));
    errors.push(...results.filter(result => result.status === "rejected").map(result => result.reason));
  }
  errors.push(...failures.splice(0));
  if (errors.length) throw new AggregateError(errors, "Spell buffer cleanup only partially completed.");
}

export function registerBufferCleanup() {
  registerOnce("hooks:buffer-cleanup", () => {
    Hooks.on("deleteActiveEffect", (effect, options) => {
      if (!isActiveGMUser(game.user) || options?.uesrpgBufferCleanupHandled) return;
      const flags = effect?.flags?.[FLAG_SCOPE];
      const actor = effect?.parent;
      if (!flags?.bufferApplied || !BUFFER_TYPES.has(flags.bufferType) || actor?.documentName !== "Actor") return;
      void enqueueBufferCleanup(actor, flags.bufferType).catch(error => { failures.push(error); if (failures.length > 100) failures.shift(); console.error("UESRPG | Buffer cleanup failed", error); });
    });
  });
}
