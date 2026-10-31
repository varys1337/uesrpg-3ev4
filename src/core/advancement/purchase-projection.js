/** Planning-only projection. All persistence belongs to purchase-service. */
import { SYSTEM_ID } from "../system/namespace.js";
import { sanitizeEmbeddedDocData } from "../../utils/authority-proxy/sanitize.js";

export const clonePurchaseData = value => foundry.utils.deepClone(value);

export function createPurchaseProjection(actor, { nativeItemIds = [] } = {}) {
  const source = actor.toObject(true);
  const excluded = new Set(nativeItemIds);
  const items = Array.from(actor.items ?? []).filter(item => !excluded.has(item.id)).map(item => ({ ...item.toObject(true), id: item.id }));
  const system = clonePurchaseData(source.system ?? {});
  for (const [key, value] of Object.entries(actor.system?.characteristics ?? {})) {
    system.characteristics ??= {};
    system.characteristics[key] = { ...clonePurchaseData(system.characteristics[key] ?? {}),
      base: Number(value.base ?? 0), total: Number(value.total ?? 0), bonus: Number(value.bonus ?? 0), favored: Boolean(value.favored) };
  }
  return { actor, system, items, steps: [], refs: new Map(), actorPatch: {}, xpCost: 0, wealthCost: 0, waivedXp: 0, spendRows: [], spellRows: [] };
}

export function purchaseActorFacade(state) {
  return { documentName: "Actor", id: state.actor.id, uuid: state.actor.uuid, type: state.actor.type,
    system: state.system, items: state.items, getFlag: (...args) => state.actor.getFlag(...args) };
}

export function spendPurchaseResources(state, xp = 0, wealth = 0, { waiveXp = false } = {}) {
  if (![xp, wealth].every(value => Number.isFinite(value) && value >= 0)) throw new Error("Invalid purchase cost.");
  const payment = waiveXp ? 0 : xp;
  if (payment > Number(state.system.xp ?? 0)) throw new Error(`Not enough XP. Required ${payment}, available ${state.system.xp ?? 0}.`);
  if (wealth > Number(state.system.wealth ?? 0)) throw new Error(`Not enough Drakes. Required ${wealth}, available ${state.system.wealth ?? 0}.`);
  state.system.xp = Number(state.system.xp ?? 0) - payment;
  state.system.wealth = Number(state.system.wealth ?? 0) - wealth;
  state.xpCost += payment;
  state.wealthCost += wealth;
  state.waivedXp += waiveXp ? xp : 0;
}

export function assertPurchasePatch(patch) {
  for (const key of Object.keys(patch ?? {})) {
    if (!/^(?:name$|system\.|flags\.)/.test(key)
        || /(?:^|\.)(?:__proto__|prototype|constructor)(?:\.|$)/.test(key)
        || key.startsWith(`flags.${SYSTEM_ID}.advancementPurchase`)
        || key.startsWith(`flags.${SYSTEM_ID}.chargenSpendXpManaged`)) throw new Error("Unsupported or reserved purchase field.");
  }
}

export function purchaseFieldSnapshot(source, paths) {
  return Object.fromEntries(paths.map(path => {
    const exists = foundry.utils.hasProperty(source, path);
    return [path, exists ? { exists: true, value: clonePurchaseData(foundry.utils.getProperty(source, path)) } : { exists: false }];
  }));
}

export function addPurchaseCreate(state, source, reference = null) {
  const data = sanitizeEmbeddedDocData("Item", clonePurchaseData(source));
  if (!data?.type || !data.name) throw new Error("A purchase Item must have a name and type.");
  if (data.flags?.[SYSTEM_ID]) {
    delete data.flags[SYSTEM_ID].advancementPurchase;
    delete data.flags[SYSTEM_ID].chargenSpendXpManaged;
  }
  // Native creation supports these dotted fields; projection uses the expanded shape.
  const expanded = foundry.utils.expandObject(data);
  const key = `step${state.steps.length}`;
  state.steps.push({ kind: "create", key, data: expanded });
  const item = { ...clonePurchaseData(expanded), id: `$${key}`, _purchaseRef: key };
  item.system ??= {};
  state.items.push(item);
  if (reference) state.refs.set(reference, item.id);
  return item;
}

export function addPurchaseUpdate(state, item, patch) {
  if (!item) throw new Error("The purchase Item is unavailable.");
  assertPurchasePatch(patch);
  const data = clonePurchaseData(patch);
  const step = { kind: "update", key: `step${state.steps.length}`, data,
    beforeFields: purchaseFieldSnapshot(item, Object.keys(data)),
    ...(item._purchaseRef ? { ref: item._purchaseRef } : { itemId: item.id }) };
  state.steps.push(step);
  for (const [path, value] of Object.entries(data)) foundry.utils.setProperty(item, path, clonePurchaseData(value));
  return step;
}

export function addPurchaseDelete(state, item) {
  if (!item || item._purchaseRef) throw new Error("The purchase deletion target is unavailable.");
  state.steps.push({ kind: "delete", key: `step${state.steps.length}`, itemId: item.id,
    beforeFields: purchaseFieldSnapshot(item, ["name", "type", "system"]) });
  state.items = state.items.filter(entry => entry.id !== item.id);
}

export function buildPurchaseAuditPatch(actor, intent, payload = {}) {
  const chargen = actor.getFlag(SYSTEM_ID, "chargen") ?? {};
  const log = Array.isArray(chargen.auditLog) ? clonePurchaseData(chargen.auditLog) : [];
  if (!log.some(row => row.payload?.operationId === intent.id)) log.push({ step: intent.workflow, action: "purchase",
    timestamp: new Date().toISOString(), payload: { operationId: intent.id, ...payload } });
  return { [`flags.${SYSTEM_ID}.chargen.auditLog`]: log };
}

export function finishPurchaseProjection(state, intent, { finalize = null, result = null, details = {} } = {}) {
  const actorPatch = { ...state.actorPatch };
  if (Number(state.actor.system.xp ?? 0) !== state.system.xp) actorPatch["system.xp"] = state.system.xp;
  if (Number(state.actor.system.wealth ?? 0) !== state.system.wealth) actorPatch["system.wealth"] = state.system.wealth;
  return { ok: true, xpCost: state.xpCost, wealthCost: state.wealthCost, steps: state.steps, actorPatch, details,
    finalize: async (actor, results) => ({ ...buildPurchaseAuditPatch(actor, intent, {
      xpCost: state.xpCost, wealthCost: state.wealthCost, waivedXp: state.waivedXp,
      administrativeReason: intent.choices?.administrativeReason ?? null, ...details,
    }), ...(finalize ? await finalize(actor, results) : {}) }), result };
}
