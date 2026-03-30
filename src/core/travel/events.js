import { getTravelPlannerState, updateTravelPlannerState } from "./state.js";
import { STARTER_EVENT_TABLES } from "./data/starter-event-tables.js";
import {
  drawOnce,
  drawWorstOfTwo,
  ensureWorldTable,
  getMappedTableUuids,
  labelForPhase,
  labelForTerrain,
  postStageEventCheckChat,
  resolveMappedTableUuid,
  resolveMappedTableUuidByIndex,
  updateTableUuidList,
} from "./event-helpers.js";

export async function rollStageEventCheck() {
  const roll = await new Roll("2d10").evaluate();
  return {
    roll,
    total: Number(roll.total ?? 0),
    triggered: Number(roll.total ?? 0) >= 11,
  };
}

export { getMappedTableUuids } from "./event-helpers.js";

export async function resolveMappedTable(groupActor, phase, terrainKey) {
  const state = getTravelPlannerState(groupActor);
  const uuid = resolveMappedTableUuid(state, phase, terrainKey);
  if (!uuid) return null;
  const table = await fromUuid(uuid);
  if (!table || table.documentName !== "RollTable") return null;
  return table;
}

export async function resolveMappedTableByIndex(groupActor, phase, terrainKey, index = 0) {
  const state = getTravelPlannerState(groupActor);
  const uuid = resolveMappedTableUuidByIndex(state, phase, terrainKey, index);
  if (!uuid) return null;
  const table = await fromUuid(uuid);
  if (!table || table.documentName !== "RollTable") return null;
  return table;
}

export async function setMappedTable(groupActor, phase, terrainKey, tableUuid, { index = 0 } = {}) {
  await updateTravelPlannerState(groupActor, (next) => {
    const list = getMappedTableUuids(next, phase, terrainKey);
    const idx = Math.max(0, Number(index || 0));
    while (list.length <= idx) list.push("");
    list[idx] = String(tableUuid || "");
    updateTableUuidList(next, phase, terrainKey, list);
    return next;
  });
}

export async function addMappedTableEntry(groupActor, phase, terrainKey) {
  await updateTravelPlannerState(groupActor, (next) => {
    const list = getMappedTableUuids(next, phase, terrainKey);
    list.push("");
    updateTableUuidList(next, phase, terrainKey, list);
    return next;
  });
}

export async function removeMappedTableEntry(groupActor, phase, terrainKey, index = 0) {
  await updateTravelPlannerState(groupActor, (next) => {
    const list = getMappedTableUuids(next, phase, terrainKey);
    const idx = Math.max(0, Number(index || 0));
    if (idx < list.length) list.splice(idx, 1);
    updateTableUuidList(next, phase, terrainKey, list);
    return next;
  });
}

export async function rollMappedEvent({
  groupActor,
  phase,
  terrainKey,
  force = false,
  doubleWorst = false,
  tableUuid = "",
} = {}) {
  let table = null;
  if (tableUuid) {
    const direct = await fromUuid(String(tableUuid));
    if (direct?.documentName === "RollTable") table = direct;
  }
  if (!table) table = await resolveMappedTable(groupActor, phase, terrainKey);
  if (!table) {
    return {
      ok: false,
      reason: `No ${labelForPhase(phase)} event table linked for ${labelForTerrain(terrainKey)}.`,
    };
  }

  const check = force ? null : await rollStageEventCheck();
  if (check) {
    await postStageEventCheckChat({ groupActor, phase, terrainKey, check });
  }
  if (check && !check.triggered) {
    return {
      ok: true,
      check,
      triggered: false,
      table,
      eventText: "",
    };
  }

  const draw = doubleWorst
    ? await drawWorstOfTwo(table)
    : await drawOnce(table, { displayChat: true });

  return {
    ok: true,
    check,
    triggered: true,
    table,
    eventText: draw?.text ?? "",
  };
}

export async function createStarterEventTablesForGroup(groupActor, { overwrite = false } = {}) {
  if (!groupActor) throw new Error("Missing Group actor.");
  const updates = { travel: {}, camping: {} };

  for (const [terrainKey, phases] of Object.entries(STARTER_EVENT_TABLES)) {
    for (const phase of ["travel", "camping"]) {
      const entries = phases?.[phase];
      if (!Array.isArray(entries) || !entries.length) continue;
      const tableName = `UESRPG ${labelForPhase(phase)} Events - ${labelForTerrain(terrainKey)}`;
      const table = await ensureWorldTable(tableName, entries, { overwrite });
      if (phase === "camping") updates.camping[terrainKey] = table.uuid;
      else updates.travel[terrainKey] = table.uuid;
    }
  }

  await updateTravelPlannerState(groupActor, (next) => {
    next.travel.eventTablesByTerrain = {
      ...(next.travel.eventTablesByTerrain ?? {}),
      ...Object.fromEntries(Object.entries(updates.travel).map(([k, v]) => [k, v ? [v] : []])),
    };
    next.camping.eventTablesByTerrain = {
      ...(next.camping.eventTablesByTerrain ?? {}),
      ...Object.fromEntries(Object.entries(updates.camping).map(([k, v]) => [k, v ? [v] : []])),
    };
    return next;
  });

  return updates;
}
