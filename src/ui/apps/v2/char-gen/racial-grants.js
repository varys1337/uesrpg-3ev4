import {
  requestCreateEmbeddedDocuments,
  requestDeleteEmbeddedDocuments,
  requestUpdateDocument,
} from "../../../../utils/authority-proxy.js";
import { customDialog } from "../../../../utils/dialog-v2-helper.js";
import { findIndexEntryByNormalizedName, getDocumentById } from "../../../../core/compendium/access-service.js";
import { CORE_SKILLS_PACK_ID, stampCoreSkillSource } from "../../../../core/compendium/core-skills.js";
import { normalizeRank, SKILL_RANK_ORDER } from "../../../../core/advancement/skill-advancement.js";
import { SYSTEM_ID } from "../../../constants.js";
import { findRaceDefinition, getRaceGrantDefinitions } from "../../../sheets/racemenu/race-catalog.js";
import { t, tf } from "../../../../utils/i18n.js";

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

async function createCanonicalItem(actor, operation) {
  if (operation?.itemType === "combatStyle") {
    const name = String(operation?.itemName ?? "").trim();
    if (!name) throw new Error("A Combat Style name is required.");
    const created = await requestCreateEmbeddedDocuments(actor, "Item", [{
      name,
      type: "combatStyle",
      system: { rank: "untrained" },
      flags: { [SYSTEM_ID]: { [GRANT_SOURCE_FLAG]: true } },
    }]);
    return created?.[0] ?? null;
  }

  const source = operation?.preparedSource
    ? deepClone(operation.preparedSource)
    : await findCanonicalSource(operation);
  if (!source) {
    throw new Error(`Could not find canonical ${operation?.itemType ?? "Item"} '${operation?.itemName ?? ""}'.`);
  }
  const created = await requestCreateEmbeddedDocuments(actor, "Item", [source]);
  return created?.[0] ?? null;
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
  const options = styles.map((item) => `<option value="${item.uuid}">${foundry.utils.escapeHTML(item.name)}</option>`).join("");
  const allowsCreation = operation.kind === "setRank";
  const equipmentOptions = (operation.allowedEquipment ?? []).map((name) => `<option value="${foundry.utils.escapeHTML(name)}">${foundry.utils.escapeHTML(name)}</option>`).join("");
  const answer = await customDialog({
    layout: "workflow",
    title: t("UESRPG.DefectUpdate.SelectGrantTarget", "Select Grant Target"),
    classes: ["uesrpg-chargen-dialog"],
    content: `<div class="uesrpg-cg-dialog uesrpg-cg-stack">
      ${options ? `<label class="uesrpg-cg-field uesrpg-cg-field--stacked"><span>Combat Style</span><select id="grantStyleUuid">${options}</select></label>` : ""}
      ${allowsCreation ? `<label class="uesrpg-cg-field uesrpg-cg-field--stacked"><span>Or create a Combat Style</span><input id="grantStyleName" type="text"></label>` : ""}
      ${equipmentOptions ? `<label class="uesrpg-cg-field uesrpg-cg-field--stacked"><span>Weapon family</span><select id="grantEquipment">${equipmentOptions}</select></label>` : ""}
    </div>`,
    buttons: {
      apply: {
        label: t("UESRPG.UI.Apply", "Apply"),
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return {
            itemUuid: String(root?.querySelector("#grantStyleUuid")?.value ?? ""),
            itemName: String(root?.querySelector("#grantStyleName")?.value ?? "").trim(),
            equipment: String(root?.querySelector("#grantEquipment")?.value ?? "").trim(),
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

async function materializeOperations(actor, option) {
  const operations = [];
  for (const raw of option?.operations ?? []) {
    const operation = deepClone(raw);
    if (operation?.selectTarget) {
      const selection = await selectCombatStyleTarget(actor, operation);
      if (!selection) return null;
      operation.targetItemUuid = selection.item?.uuid ?? null;
      operation.itemName = selection.item?.name ?? selection.itemName;
      if (selection.equipment) operation.equipment = selection.equipment;
    }
    if (operation.kind !== "recordChoice") {
      const target = operation.targetItemUuid
        ? await fromUuid(operation.targetItemUuid)
        : findEmbeddedItem(actor, operation);
      if (target && target.parent?.uuid !== actor.uuid) {
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

async function applyOperation(actor, operation) {
  if (operation.kind === "recordChoice") {
    return {
      kind: operation.kind,
      value: String(operation.value ?? ""),
      itemUuid: null,
      itemId: null,
      itemName: null,
      itemType: null,
      created: false,
      before: null,
      after: { value: String(operation.value ?? "") },
      createdSource: null,
    };
  }

  let item = operation.targetItemUuid ? await fromUuid(operation.targetItemUuid) : findEmbeddedItem(actor, operation);
  let created = false;
  if (!item) {
    item = await createCanonicalItem(actor, operation);
    created = Boolean(item);
  }
  if (!item || item.parent?.uuid !== actor.uuid) throw new Error(`Unable to resolve grant target '${operation.itemName ?? operation.kind}'.`);

  const before = operationValueSnapshot(item, operation);
  if (operation.kind === "setRank") {
    const currentRank = normalizeRank(item.system?.rank);
    const desiredRank = normalizeRank(operation.rank);
    const currentIndex = SKILL_RANK_ORDER.indexOf(currentRank);
    const desiredIndex = SKILL_RANK_ORDER.indexOf(desiredRank);
    const update = {};
    if (currentIndex < desiredIndex) update["system.rank"] = desiredRank;
    for (const [key, value] of Object.entries(operation.system ?? {})) {
      if (!valuesEqual(item.system?.[key], value)) update[`system.${key}`] = deepClone(value);
    }
    if (Object.keys(update).length) {
      const ok = await requestUpdateDocument(item, update);
      if (!ok) throw new Error(`Failed to update ${item.name}.`);
      item = (await fromUuid(item.uuid)) ?? item;
    }
  } else if (operation.kind === "addCombatStyleEquipment") {
    const equipment = String(operation.equipment ?? "").trim();
    if (!equipment) throw new Error("A weapon family is required.");
    const existing = Array.isArray(item.system?.trainedEquipment) ? [...item.system.trainedEquipment] : [];
    if (!existing.some((value) => normalize(value) === normalize(equipment))) {
      const empty = existing.findIndex((value) => !String(value ?? "").trim());
      if (empty >= 0) existing[empty] = equipment;
      else if (existing.length < 10) existing.push(equipment);
      else throw new Error(`${item.name} has no available trained-equipment slot.`);
      const ok = await requestUpdateDocument(item, { "system.trainedEquipment": existing });
      if (!ok) throw new Error(`Failed to update ${item.name}.`);
      item = (await fromUuid(item.uuid)) ?? item;
    }
  }

  const after = operationValueSnapshot(item, operation);
  return {
    kind: operation.kind,
    system: deepClone(operation.system ?? {}),
    itemUuid: item.uuid,
    itemId: item.id,
    itemName: item.name,
    itemType: item.type,
    created,
    before,
    after,
    createdSource: created ? { name: item.name, type: item.type, system: deepClone(item.toObject?.().system ?? item.system ?? {}) } : null,
  };
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

async function rollbackRecord(actor, record) {
  const conflicts = preflightRollback(actor, record);
  if (conflicts.length) return { ok: false, conflicts };

  for (const operation of [...(record?.operations ?? [])].reverse()) {
    if (operation?.kind === "recordChoice") continue;
    const item = operation?.itemUuid ? await fromUuid(operation.itemUuid) : null;
    if (!item) continue;
    if (operation.created) {
      const ok = await requestDeleteEmbeddedDocuments(actor, "Item", [item.id]);
      if (!ok) return { ok: false, conflicts: [`Failed to remove ${item.name}`] };
      continue;
    }
    if (operation.kind === "setRank") {
      const update = { "system.rank": operation.before?.rank ?? "untrained" };
      for (const [key, value] of Object.entries(operation.before?.system ?? {})) update[`system.${key}`] = deepClone(value);
      const ok = await requestUpdateDocument(item, update);
      if (!ok) return { ok: false, conflicts: [`Failed to restore ${item.name}`] };
    } else if (operation.kind === "addCombatStyleEquipment") {
      const ok = await requestUpdateDocument(item, { "system.trainedEquipment": deepClone(operation.before?.trainedEquipment ?? []) });
      if (!ok) return { ok: false, conflicts: [`Failed to restore ${item.name}`] };
    }
  }
  return { ok: true, conflicts: [] };
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
    content: `<div class="uesrpg-cg-dialog"><label class="uesrpg-cg-field uesrpg-cg-field--stacked"><span>${t("UESRPG.DefectUpdate.CorrectionReason", "Reason")}</span><input id="chargenCorrectionReason" type="text" required minlength="3"></label></div>`,
    buttons: {
      apply: {
        label: t("UESRPG.UI.Apply", "Apply"),
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html?.[0];
          return String(root?.querySelector("#chargenCorrectionReason")?.value ?? "").trim();
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
  const optionsHtml = grant.options.map((option) => `<option value="${option.id}">${foundry.utils.escapeHTML(option.label)}</option>`).join("");
  const optionId = grant.options.length === 1
    ? grant.options[0].id
    : await customDialog({
      layout: "workflow",
        title: grant.label,
        classes: ["uesrpg-chargen-dialog"],
        content: `<div class="uesrpg-cg-dialog"><label class="uesrpg-cg-field uesrpg-cg-field--stacked"><span>${t("UESRPG.DefectUpdate.GrantChoice", "Choose benefit")}</span><select id="racialGrantOption">${optionsHtml}</select></label></div>`,
        buttons: {
          apply: {
            label: t("UESRPG.UI.Apply", "Apply"),
            callback: (html) => {
              const root = html instanceof HTMLElement ? html : html?.[0];
              return String(root?.querySelector("#racialGrantOption")?.value ?? "");
            },
          },
          cancel: { label: t("UESRPG.UI.Cancel", "Cancel"), callback: () => null },
        },
        default: "apply",
      });
  if (!optionId) return { ok: false, cancelled: true };
  return applyRacialGrantOption(actor, { raceKey: raceMatch.raceKey, grantId, optionId, administrativeReason });
}

export async function promptAndApplyAllMissingRacialGrants(actor) {
  const review = getRacialGrantReview(actor);
  const results = [];
  for (const grant of review.filter((entry) => !entry.applied)) {
    const result = await promptAndApplyRacialGrant(actor, grant.id);
    results.push(result);
    if (result?.cancelled) break;
  }
  return results;
}

export async function applyRacialGrantOption(actor, {
  raceKey,
  grantId,
  optionId,
  administrativeReason = null,
} = {}) {
  if (!actor || !(game.user?.isGM || actor.isOwner)) return { ok: false, error: "Not authorized" };
  const raceMatch = findRaceDefinition(raceKey);
  if (!raceMatch || normalize(actor.system?.race) !== normalize(raceMatch.raceKey)) {
    return { ok: false, error: "The grant does not match the Actor's current race." };
  }
  const grant = getRaceGrantDefinitions(raceMatch.raceKey).find((entry) => entry.id === grantId);
  const option = grant?.options?.find((entry) => entry.id === optionId);
  if (!grant || !option) return { ok: false, error: "Grant option not found" };

  const records = currentGrantRecords(actor);
  const priorMatch = activeRecord(records, raceMatch.raceKey, grant.id);
  if (priorMatch?.record?.optionId === option.id) return { ok: true, changed: false, record: priorMatch.record };
  if (priorMatch && isChargenCompleted(actor)) {
    if (!game.user?.isGM || String(administrativeReason ?? "").trim().length < 3) {
      return { ok: false, error: "A GM Administrative Correction reason is required to change an applied grant." };
    }
  }

  const refundedXp = Math.max(0, asNumber(priorMatch?.record?.xpCharged, 0));
  const xpCost = Math.max(0, asNumber(option.xpCost, 0));
  const availableXp = Math.max(0, asNumber(actor.system?.xp, 0) + refundedXp);
  if (xpCost > availableXp) {
    return { ok: false, error: tf("UESRPG.Notifications.SpendXp.NotEnoughXp", { required: xpCost, available: availableXp }, `Not enough XP. Required ${xpCost}, available ${availableXp}.`) };
  }

  let operations;
  try {
    operations = await materializeOperations(actor, option);
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
  if (!operations) return { ok: false, cancelled: true };

  if (priorMatch) {
    const rollback = await rollbackRecord(actor, priorMatch.record);
    if (!rollback.ok) {
      records[priorMatch.index].conflicts = rollback.conflicts;
      await requestUpdateDocument(actor, { [`flags.${SYSTEM_ID}.chargen.grants`]: records });
      return { ok: false, conflict: true, error: rollback.conflicts.join("; ") };
    }
    records[priorMatch.index] = {
      ...records[priorMatch.index],
      active: false,
      status: "rolledBack",
      rolledBackAt: new Date().toISOString(),
      rolledBackBy: game.user?.id ?? null,
      rollbackReason: String(administrativeReason ?? "grant option changed"),
    };
  }

  const results = [];
  try {
    for (const operation of operations) results.push(await applyOperation(actor, operation));
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }

  const record = {
    raceKey: raceMatch.raceKey,
    grantId: grant.id,
    grantLabel: grant.label,
    optionId: option.id,
    optionLabel: option.label,
    affectedItemUuids: results.map((entry) => entry.itemUuid).filter(Boolean),
    operations: results,
    xpCharged: xpCost,
    appliedBy: game.user?.id ?? null,
    appliedAt: new Date().toISOString(),
    administrativeReason: String(administrativeReason ?? ""),
    active: true,
    status: "applied",
  };
  records.push(record);
  const ok = await requestUpdateDocument(actor, {
    "system.xp": Math.max(0, availableXp - xpCost),
    [`flags.${SYSTEM_ID}.chargen.grants`]: records,
  });
  if (!ok) return { ok: false, error: "Grant changes were applied but provenance could not be recorded; retry reconciliation." };
  return { ok: true, changed: true, record };
}

export async function rollbackTrackedRacialGrants(actor, raceKey, { reason = "race changed" } = {}) {
  const records = currentGrantRecords(actor);
  const indexes = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record?.active === true && normalize(record?.raceKey) === normalize(raceKey));
  if (!indexes.length) return { ok: true, changed: false };

  const conflicts = indexes.flatMap(({ record }) => preflightRollback(actor, record));
  if (conflicts.length) return { ok: false, conflict: true, error: conflicts.join("; ") };

  let refund = 0;
  for (const entry of [...indexes].reverse()) {
    const result = await rollbackRecord(actor, entry.record);
    if (!result.ok) return { ok: false, conflict: true, error: result.conflicts.join("; ") };
    refund += Math.max(0, asNumber(entry.record.xpCharged, 0));
    records[entry.index] = {
      ...entry.record,
      active: false,
      status: "rolledBack",
      rolledBackAt: new Date().toISOString(),
      rolledBackBy: game.user?.id ?? null,
      rollbackReason: String(reason),
    };
  }
  const ok = await requestUpdateDocument(actor, {
    "system.xp": Math.max(0, asNumber(actor.system?.xp, 0) + refund),
    [`flags.${SYSTEM_ID}.chargen.grants`]: records,
  });
  return { ok, changed: ok };
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
