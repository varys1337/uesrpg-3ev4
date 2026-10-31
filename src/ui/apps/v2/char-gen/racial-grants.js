import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { findIndexEntryByNormalizedName, getDocumentById } from "../../../../core/compendium/access-service.js";
import { CORE_SKILLS_PACK_ID, stampCoreSkillSource } from "../../../../core/compendium/core-skills.js";
import { normalizeRank, SKILL_RANK_ORDER } from "../../../../core/advancement/skill-advancement.js";
import { SYSTEM_ID } from "../../../constants.js";
import { findRaceDefinition, getRaceGrantDefinitions } from "../../../sheets/racemenu/race-catalog.js";
import { t, tf } from "../../../../utils/i18n.js";
import { quoteXpPurchase, requestXpPurchase } from "../../../../core/advancement/purchase-service.js";
import { showXpPurchaseFailure } from "../../../advancement/purchase-review.js";
import { validateTalentLearning, TALENT_LEARNING_MODE } from "../../../../core/traits/talent-learning.js";
import {
  createPurchaseProjection, purchaseActorFacade, spendPurchaseResources,
  addPurchaseCreate, addPurchaseUpdate, addPurchaseDelete, finishPurchaseProjection,
} from "../../../../core/advancement/purchase-projection.js";

const TALENT_PACK_ID = `${SYSTEM_ID}.powers-talents-traits`;
const GRANT_SOURCE_FLAG = "chargenGrantSource";

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function deepClone(value) {
  return foundry.utils.deepClone(value ?? null);
}

function itemCollection(actor) {
  return Array.from(actor?.items ?? []);
}

function currentGrantRecords(actor) {
  const records = actor?.getFlag?.(SYSTEM_ID, "chargen")?.grants;
  return Array.isArray(records) ? deepClone(records) : [];
}

function activeRecord(records, raceKey, grantId) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record?.active !== true) continue;
    if (normalize(record?.raceKey) !== normalize(raceKey)) continue;
    if (String(record?.grantId ?? "") !== String(grantId ?? "")) continue;
    return { record, index };
  }
  return null;
}

function findEmbeddedItem(actor, operation) {
  const type = String(operation?.itemType ?? "");
  const wanted = new Set([
    operation?.itemName,
    ...(Array.isArray(operation?.aliases) ? operation.aliases : []),
  ].map(normalize).filter(Boolean));
  const wantedKey = normalize(operation?.itemKey);

  return itemCollection(actor).find((item) => {
    if (type && String(item?.type ?? "") !== type) return false;
    const keys = [item?.system?.key, item?.system?.slug, item?.system?.id].map(normalize).filter(Boolean);
    const identityMatches = (wantedKey && keys.includes(wantedKey)) || wanted.has(normalize(item?.name));
    if (!identityMatches) return false;
    for (const [key, expected] of Object.entries(operation?.system ?? {})) {
      const actual = item?.system?.[key];
      if (typeof expected === "string" && typeof actual === "string") {
        if (normalize(actual) !== normalize(expected)) return false;
      } else if (!valuesEqual(actual, expected)) return false;
    }
    return true;
  }) ?? null;
}

function itemSourceMatches(item, source) {
  if (!item || !source) return false;
  if (String(item.type ?? "") !== String(source.type ?? "")) return false;
  if (String(item.name ?? "") !== String(source.name ?? "")) return false;
  return JSON.stringify(item.toObject?.().system ?? item.system ?? {}) === JSON.stringify(source.system ?? {});
}

async function findCanonicalSource(operation) {
  const type = String(operation?.itemType ?? "");
  const packId = type === "talent" ? TALENT_PACK_ID : CORE_SKILLS_PACK_ID;
  const names = [operation?.itemName, ...(operation?.aliases ?? [])].map(String).filter(Boolean);
  for (const name of names) {
    const entry = await findIndexEntryByNormalizedName(packId, name, { fields: ["name", "type"] });
    if (!entry) continue;
    const document = await getDocumentById(packId, entry._id);
    if (!document || String(document.type ?? "") !== type) continue;
    let source = document.toObject();
    if (packId === CORE_SKILLS_PACK_ID) source = stampCoreSkillSource(source);
    source.flags = source.flags && typeof source.flags === "object" ? source.flags : {};
    source.flags[SYSTEM_ID] = source.flags[SYSTEM_ID] && typeof source.flags[SYSTEM_ID] === "object"
      ? source.flags[SYSTEM_ID]
      : {};
    source.flags[SYSTEM_ID][GRANT_SOURCE_FLAG] = true;
    return source;
  }
  return null;
}

function operationValueSnapshot(item, operation) {
  if (operation.kind === "setRank") {
    const extra = {};
    for (const key of Object.keys(operation.system ?? {})) extra[key] = deepClone(item?.system?.[key]);
    return { rank: normalizeRank(item?.system?.rank), system: extra };
  }
  if (operation.kind === "addCombatStyleEquipment") {
    return { trainedEquipment: deepClone(item?.system?.trainedEquipment ?? []) };
  }
  return { exists: Boolean(item) };
}

function valuesEqual(current, expected) {
  return JSON.stringify(current) === JSON.stringify(expected);
}

async function selectCombatStyleTarget(actor, operation) {
  const styles = itemCollection(actor).filter((item) => item.type === "combatStyle");
  const options = styles.map((item) => `<option value="${foundry.utils.escapeHTML(item.uuid)}">${foundry.utils.escapeHTML(item.name)}</option>`).join("");
  const allowsCreation = operation.kind === "setRank";
  const equipmentOptions = (operation.allowedEquipment ?? []).map((name) => `<option value="${foundry.utils.escapeHTML(name)}">${foundry.utils.escapeHTML(name)}</option>`).join("");
  const answer = await customDialog({
    layout: "workflow",
    title: t("UESRPG.DefectUpdate.SelectGrantTarget", "Select Grant Target"),
    classes: ["uesrpg-chargen-dialog"],
    content: `<div class="uesrpg-cg-dialog uesrpg-cg-stack">
      ${options ? `<label class="uesrpg-cg-field uesrpg-cg-field--stacked"><span>${t("UESRPG.DefectUpdate.CombatStyle")}</span><select data-role="grant-style-uuid">${options}</select></label>` : ""}
      ${allowsCreation ? `<label class="uesrpg-cg-field uesrpg-cg-field--stacked"><span>${t("UESRPG.DefectUpdate.CreateCombatStyle")}</span><input data-role="grant-style-name" type="text"></label>` : ""}
      ${equipmentOptions ? `<label class="uesrpg-cg-field uesrpg-cg-field--stacked"><span>${t("UESRPG.DefectUpdate.WeaponFamily")}</span><select data-role="grant-equipment">${equipmentOptions}</select></label>` : ""}
    </div>`,
    buttons: {
      apply: {
        label: t("UESRPG.UI.Apply", "Apply"),
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return {
            itemUuid: String(root?.querySelector('[data-role="grant-style-uuid"]')?.value ?? ""),
            itemName: String(root?.querySelector('[data-role="grant-style-name"]')?.value ?? "").trim(),
            equipment: String(root?.querySelector('[data-role="grant-equipment"]')?.value ?? "").trim(),
          };
        },
      },
      cancel: { label: t("UESRPG.UI.Cancel", "Cancel"), callback: () => null },
    },
    default: "apply",
  });
  if (!answer) return null;
  const item = answer.itemUuid ? await fromUuid(answer.itemUuid) : null;
  if (!item && !answer.itemName) return null;
  return { item, itemName: answer.itemName, equipment: answer.equipment };
}

async function materializeOperations(actor, option, { selections = null } = {}) {
  const operations = [];
  for (const [index, raw] of (option?.operations ?? []).entries()) {
    const operation = deepClone(raw);
    if (operation?.selectTarget) {
      const selected = selections?.find(entry => entry.index === index);
      const selection = selections ? {
        item: selected?.targetItemUuid ? await fromUuid(selected.targetItemUuid) : null,
        itemName: String(selected?.itemName ?? "").trim(), equipment: selected?.equipment,
      } : await selectCombatStyleTarget(actor, operation);
      if (!selection) return null;
      if (selections && !selection.item && (selected?.targetItemUuid || operation.kind !== "setRank" || !selection.itemName)) {
        throw new Error("Select an existing Combat Style or name a new style for the grant.");
      }
      operation.targetItemUuid = selection.item?.uuid ?? null;
      operation.itemName = selection.item?.name ?? selection.itemName;
      if (selection.equipment) operation.equipment = selection.equipment;
      if (operation.allowedEquipment?.length && !operation.allowedEquipment.includes(operation.equipment)) {
        throw new Error("Select one of the grant's allowed weapon families.");
      }
    }
    if (operation.kind !== "recordChoice") {
      const target = operation.targetItemUuid
        ? await fromUuid(operation.targetItemUuid)
        : findEmbeddedItem(actor, operation);
      if (operation.targetItemUuid && target && target.parent?.uuid !== actor.uuid) {
        throw new Error(`Grant target '${target.name}' is not embedded in ${actor.name}.`);
      }
      if (!target && operation.kind === "addCombatStyleEquipment") {
        throw new Error("Select an existing Combat Style for the additional weapon family.");
      }
      if (!target && operation.itemType !== "combatStyle") {
        operation.preparedSource = await findCanonicalSource(operation);
        if (!operation.preparedSource) {
          throw new Error(`Could not find canonical ${operation.itemType ?? "Item"} '${operation.itemName ?? ""}'.`);
        }
      }
    }
    operations.push(operation);
  }
  return operations;
}

function preflightRollback(actor, record) {
  const conflicts = [];
  for (const operation of record?.operations ?? []) {
    if (operation?.kind === "recordChoice") continue;
    const item = operation?.itemUuid ? fromUuidSync(operation.itemUuid) : null;
    if (!item) {
      if (!operation.created) conflicts.push(`${operation.itemName} is missing`);
      continue;
    }
    if (operation.created) {
      if (!itemSourceMatches(item, operation.createdSource)) conflicts.push(`${item.name} was modified after the grant`);
      continue;
    }
    const current = operationValueSnapshot(item, operation);
    if (!valuesEqual(current, operation.after)) conflicts.push(`${item.name} was modified after the grant`);
  }
  return conflicts;
}

export function isChargenCompleted(actor) {
  return Boolean(
    actor?.getFlag?.(SYSTEM_ID, "chargen")?.completed
    || actor?.flags?.uesrpg?.charGen?.completed
    || actor?.getFlag?.(SYSTEM_ID, "chargen")?.finalSummary?.postedAt
  );
}

export function getRacialGrantReview(actor) {
  const raceMatch = findRaceDefinition(actor?.system?.race);
  const grants = getRaceGrantDefinitions(raceMatch?.raceKey);
  const records = currentGrantRecords(actor);
  return grants.map((grant) => {
    const active = activeRecord(records, raceMatch?.raceKey, grant.id)?.record ?? null;
    return {
      id: grant.id,
      label: grant.label,
      applied: Boolean(active),
      optionId: active?.optionId ?? null,
      optionLabel: active?.optionLabel ?? null,
      conflict: Boolean(active?.conflicts?.length),
    };
  });
}

export async function promptAdministrativeCorrectionReason() {
  if (!game.user?.isGM) return null;
  const result = await customDialog({
    layout: "workflow",
    title: t("UESRPG.DefectUpdate.AdministrativeCorrection", "Administrative Correction"),
    classes: ["uesrpg-chargen-dialog"],
    content: `<div class="uesrpg-cg-dialog"><label class="uesrpg-cg-field uesrpg-cg-field--stacked"><span>${t("UESRPG.DefectUpdate.CorrectionReason", "Reason")}</span><input data-role="chargen-correction-reason" type="text" required minlength="3"></label></div>`,
    buttons: {
      apply: {
        label: t("UESRPG.UI.Apply", "Apply"),
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return String(root?.querySelector('[data-role="chargen-correction-reason"]')?.value ?? "").trim();
        },
      },
      cancel: { label: t("UESRPG.UI.Cancel", "Cancel"), callback: () => null },
    },
    default: "apply",
  });
  if (!result || String(result).trim().length < 3) {
    if (result) ui.notifications?.warn?.(t("UESRPG.DefectUpdate.CorrectionReasonRequired", "Enter a short correction reason."));
    return null;
  }
  return String(result).trim();
}

export async function promptAndApplyRacialGrant(actor, grantId, { administrativeReason = null } = {}) {
  const raceMatch = findRaceDefinition(actor?.system?.race);
  const grant = getRaceGrantDefinitions(raceMatch?.raceKey).find((entry) => entry.id === grantId);
  if (!grant) return { ok: false, error: "Grant definition not found" };
  const optionsHtml = grant.options.map((option) => `<option value="${foundry.utils.escapeHTML(option.id)}">${foundry.utils.escapeHTML(option.label)}</option>`).join("");
  const optionId = grant.options.length === 1
    ? grant.options[0].id
    : await customDialog({
      layout: "workflow",
        title: grant.label,
        classes: ["uesrpg-chargen-dialog"],
        content: `<div class="uesrpg-cg-dialog"><label class="uesrpg-cg-field uesrpg-cg-field--stacked"><span>${t("UESRPG.DefectUpdate.GrantChoice", "Choose benefit")}</span><select data-role="racial-grant-option">${optionsHtml}</select></label></div>`,
        buttons: {
          apply: {
            label: t("UESRPG.UI.Apply", "Apply"),
            callback: (html) => {
              const root = html instanceof HTMLElement ? html : html?.[0];
              return String(root?.querySelector('[data-role="racial-grant-option"]')?.value ?? "");
            },
          },
          cancel: { label: t("UESRPG.UI.Cancel", "Cancel"), callback: () => null },
        },
        default: "apply",
      });
  if (!optionId) return { ok: false, cancelled: true };
  const result = await applyRacialGrantOption(actor, { raceKey: raceMatch.raceKey, grantId, optionId, administrativeReason });
  if (["processing", "needsReview"].includes(result.status)) await showXpPurchaseFailure(actor, result);
  return result;
}

export async function promptAndApplyAllMissingRacialGrants(actor) {
  const review = getRacialGrantReview(actor);
  const results = [];
  for (const grant of review.filter((entry) => !entry.applied)) {
    const result = await promptAndApplyRacialGrant(actor, grant.id);
    results.push(result);
    if (!result?.ok) break;
  }
  return results;
}

export async function applyRacialGrantOption(actor, input = {}) {
  if (!actor || !(game.user?.isGM || actor.isOwner)) return { ok: false, error: "Not authorized" };
  const race = findRaceDefinition(input.raceKey);
  const grant = getRaceGrantDefinitions(race?.raceKey).find(entry => entry.id === input.grantId);
  const option = grant?.options?.find(entry => entry.id === input.optionId);
  if (!option) return { ok: false, error: "Grant option not found" };
  const prior = activeRecord(currentGrantRecords(actor), race.raceKey, grant.id);
  if (prior?.record.optionId === option.id) return { ok: true, changed: false, record: prior.record };
  let operations;
  try { operations = await materializeOperations(actor, option); }
  catch (error) { return { ok: false, status: "rejected", reason: error.message, error: error.message }; }
  if (!operations) return { ok: false, cancelled: true };
  const selections = operations.flatMap((entry, index) => entry.selectTarget
    ? [{ index, targetItemUuid: entry.targetItemUuid, itemName: entry.itemName, equipment: entry.equipment }] : []);
  const choices = { ...input, selections };
  const quote = await quoteXpPurchase(actor, "racialGrant", choices);
  if (!quote.ok) return { ...quote, error: quote.reason };
  if (quote.xpCost > 0 || quote.details.refund > 0) {
    const accepted = await customDialog({
      title: t("UESRPG.Purchases.RacialQuoteTitle"), layout: "workflow",
      content: '<p>' + foundry.utils.escapeHTML(tf("UESRPG.Purchases.RacialQuote", {
        option: quote.details.optionXp, talents: quote.details.talentXp, refund: quote.details.refund, total: quote.xpCost,
      })) + '</p>',
      buttons: { apply: { label: t("UESRPG.UI.Apply"), callback: () => true }, cancel: { label: t("UESRPG.UI.Cancel"), callback: () => false } },
      default: "cancel",
    });
    if (!accepted) return { ok: false, cancelled: true };
  }
  const result = await requestXpPurchase(actor, "racialGrant", choices, { quote });
  return { ...result, error: result.reason };
}

export async function rollbackTrackedRacialGrants(actor, raceKey, { reason = "race changed" } = {}) {
  if (!currentGrantRecords(actor).some(record => record.active && normalize(record.raceKey) === normalize(raceKey))) return { ok: true, changed: false };
  const result = await requestXpPurchase(actor, "racialRefund", { raceKey, reason });
  return { ...result, error: result.reason };
}

export function buildAdministrativeCorrectionAudit(reason, details = {}) {
  return {
    step: "administrativeCorrection",
    action: "apply",
    payload: {
      reason: String(reason ?? ""),
      userId: game.user?.id ?? null,
      ...deepClone(details),
    },
  };
}

/** Authority-side racial purchase planner; no prompts or document writes. */
export async function buildRacialGrantPurchasePlan(actor, intent, { requester } = {}) {
  try {
    const input = intent.choices ?? {};
    const state = createPurchaseProjection(actor);
    const records = currentGrantRecords(actor);
    let refund = 0;
    const rollback = record => {
      const conflicts = preflightRollback(actor, record);
      if (conflicts.length) throw new Error(conflicts.join("; "));
      for (const operation of [...record.operations].reverse()) {
        if (operation.kind === "recordChoice") continue;
        const item = state.items.find(entry => entry.id === operation.itemId);
        if (!item) continue;
        if (operation.created) addPurchaseDelete(state, item);
        else if (operation.kind === "setRank") {
          const patch = { "system.rank": operation.before?.rank ?? "untrained" };
          for (const [key, value] of Object.entries(operation.before?.system ?? {})) patch[`system.${key}`] = deepClone(value);
          addPurchaseUpdate(state, item, patch);
        } else if (operation.kind === "addCombatStyleEquipment") addPurchaseUpdate(state, item, { "system.trainedEquipment": deepClone(operation.before?.trainedEquipment ?? []) });
      }
      refund += Math.max(0, asNumber(record.xpCharged, 0));
      record.active = false;
      record.status = "rolledBack";
      record.rolledBackAt = new Date().toISOString();
      record.rolledBackBy = requester.id;
      record.rollbackReason = String(input.administrativeReason ?? input.reason ?? "racial grant changed");
    };
    if (intent.workflow === "racialRefund") {
      for (const record of [...records].reverse()) if (record.active && normalize(record.raceKey) === normalize(input.raceKey)) rollback(record);
      state.system.xp = asNumber(state.system.xp, 0) + refund;
      return finishPurchaseProjection(state, intent, { details: { refund },
        finalize: () => ({ [`flags.${SYSTEM_ID}.chargen.grants`]: records }), result: () => ({ changed: refund > 0 || state.steps.length > 0 }) });
    }
    const race = findRaceDefinition(input.raceKey);
    if (!race || normalize(actor.system?.race) !== normalize(race.raceKey)) throw new Error("The grant does not match the Actor's current race.");
    const grant = getRaceGrantDefinitions(race.raceKey).find(entry => entry.id === input.grantId);
    const option = grant?.options?.find(entry => entry.id === input.optionId);
    if (!option) throw new Error("Grant option not found.");
    const prior = activeRecord(records, race.raceKey, grant.id);
    if (prior?.record.optionId === option.id) return finishPurchaseProjection(state, intent, { result: () => ({ changed: false, record: prior.record }) });
    if (prior && isChargenCompleted(actor) && (!requester.isGM || String(input.administrativeReason ?? "").trim().length < 3)) {
      throw new Error("A GM Administrative Correction reason is required to change an applied grant.");
    }
    if (prior) rollback(prior.record);
    state.system.xp = asNumber(state.system.xp, 0) + refund;
    const optionXp = Math.max(0, asNumber(option.xpCost, 0));
    spendPurchaseResources(state, optionXp);
    const operations = await materializeOperations(purchaseActorFacade(state), option, { selections: input.selections ?? [] });
    const planned = [];
    let talentXp = 0;
    for (const operation of operations) {
      if (operation.kind === "recordChoice") {
        planned.push({ kind: operation.kind, value: String(operation.value ?? ""), itemUuid: null, itemId: null,
          itemName: null, itemType: null, created: false, before: null, after: { value: String(operation.value ?? "") }, createdSource: null });
        continue;
      }
      const target = operation.targetItemUuid ? await fromUuid(operation.targetItemUuid) : null;
      let item = target ? state.items.find(entry => entry.id === target.id) : findEmbeddedItem(purchaseActorFacade(state), operation);
      let created = false;
      if (!item) {
        if (operation.kind === "addCombatStyleEquipment") throw new Error("The selected grant target is unavailable after rollback.");
        const source = operation.itemType === "combatStyle" ? { name: operation.itemName, type: "combatStyle", system: { rank: "untrained" }, flags: { [SYSTEM_ID]: { [GRANT_SOURCE_FLAG]: true } } }
          : operation.preparedSource;
        if (!source) throw new Error("Canonical grant source is unavailable.");
        if (source.type === "talent") {
          const validation = validateTalentLearning(purchaseActorFacade(state), source, { source: "racial-grant" });
          if (validation.mode === TALENT_LEARNING_MODE.ENFORCE) {
            if (!validation.rulesOk) throw new Error([...validation.reasons, ...validation.guidance].join(" "));
            const cost = Math.max(0, asNumber(validation.xpCost, 0));
            spendPurchaseResources(state, cost);
            talentXp += cost;
          }
        }
        item = addPurchaseCreate(state, source);
        created = true;
      }
      const before = operationValueSnapshot(item, operation);
      if (operation.kind === "setRank") {
        const patch = {};
        if (SKILL_RANK_ORDER.indexOf(normalizeRank(item.system.rank)) < SKILL_RANK_ORDER.indexOf(normalizeRank(operation.rank))) patch["system.rank"] = normalizeRank(operation.rank);
        for (const [key, value] of Object.entries(operation.system ?? {})) if (!valuesEqual(item.system[key], value)) patch[`system.${key}`] = deepClone(value);
        if (Object.keys(patch).length) addPurchaseUpdate(state, item, patch);
      } else if (operation.kind === "addCombatStyleEquipment") {
        const equipment = String(operation.equipment ?? "").trim();
        if (!equipment) throw new Error("A weapon family is required.");
        const entries = Array.isArray(item.system.trainedEquipment) ? [...item.system.trainedEquipment] : [];
        if (!entries.some(value => normalize(value) === normalize(equipment))) {
          const empty = entries.findIndex(value => !String(value ?? "").trim());
          if (empty >= 0) entries[empty] = equipment;
          else if (entries.length < 10) entries.push(equipment);
          else throw new Error("The Combat Style has no available trained-equipment slot.");
          addPurchaseUpdate(state, item, { "system.trainedEquipment": entries });
        }
      }
      planned.push({ kind: operation.kind, system: deepClone(operation.system ?? {}), itemId: item.id,
        itemName: item.name, itemType: item.type, created, before, after: operationValueSnapshot(item, operation), createRef: item._purchaseRef ?? null });
    }
    const grantRecord = { raceKey: race.raceKey, grantId: grant.id, grantLabel: grant.label, optionId: option.id, optionLabel: option.label,
      xpCharged: optionXp + talentXp, xpBreakdown: { option: optionXp, talentLearning: talentXp }, appliedBy: requester.id,
      appliedAt: new Date().toISOString(), administrativeReason: String(input.administrativeReason ?? ""), active: true, status: "applied" };
    const resolveRecord = results => {
      const rows = planned.map(operation => {
        if (operation.kind === "recordChoice") return operation;
        const { createRef, ...row } = operation;
        const item = createRef ? results[createRef] : actor.items.get(operation.itemId);
        return { ...row, itemId: item.id, itemUuid: item.uuid,
          createdSource: row.created ? { name: item.name, type: item.type, system: deepClone(item.toObject(true).system) } : null };
      });
      return { ...grantRecord, operations: rows, affectedItemUuids: rows.map(row => row.itemUuid).filter(Boolean) };
    };
    return finishPurchaseProjection(state, intent, { details: { optionXp, talentXp, refund },
      finalize: (_live, results) => ({ [`flags.${SYSTEM_ID}.chargen.grants`]: [...records, resolveRecord(results)] }),
      result: results => ({ changed: true, record: resolveRecord(results) }) });
  } catch (error) { return { ok: false, reason: String(error?.message ?? error) }; }
}
