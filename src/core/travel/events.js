import { customDialog } from "../../utils/dialog-v2-helper.js";
import { getTravelPlannerState, updateTravelPlannerState } from "./state.js";
import { STARTER_EVENT_TABLES } from "./data/starter-event-tables.js";

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function labelForTerrain(terrainKey) {
  switch (String(terrainKey ?? "")) {
    case "lightWoodland": return "Light Woodland";
    case "hills": return "Hills";
    case "deepForest": return "Deep Forest";
    case "temperatePlains": return "Temperate Plains";
    case "wetland": return "Wetland";
    case "mountains": return "Mountains";
    default: return "Unknown Terrain";
  }
}

function labelForPhase(phase) {
  return phase === "camping" ? "Camping" : "Travel";
}

function asTableUuidList(raw) {
  if (Array.isArray(raw)) return raw.map((v) => String(v || ""));
  const single = String(raw || "").trim();
  return single ? [single] : [];
}

export async function rollStageEventCheck() {
  const roll = await new Roll("2d10").evaluate();
  return {
    roll,
    total: Number(roll.total ?? 0),
    triggered: Number(roll.total ?? 0) >= 11,
  };
}

async function postStageEventCheckChat({ groupActor, phase, terrainKey, check }) {
  const roll = check?.roll ?? null;
  if (!roll?.toMessage) return;
  const triggered = Boolean(check?.triggered);
  await roll.toMessage(
    {
      speaker: ChatMessage.getSpeaker({ actor: groupActor }),
      flavor: `
        <div class="uesrpg-travel-roll-card">
          <h3>${esc(labelForPhase(phase))} Event Check</h3>
          <p><b>Terrain:</b> ${esc(labelForTerrain(terrainKey))}</p>
          <p><b>Rule:</b> Trigger on 11+ (2d10)</p>
          <p><b>Outcome:</b> ${triggered ? "Event Triggered" : "No Event"}</p>
        </div>
      `,
    },
    { rollMode: game.settings.get("core", "rollMode") },
  );
}

function resolveMappedTableUuid(state, phase, terrainKey) {
  const source = phase === "camping"
    ? state?.camping?.eventTablesByTerrain?.[terrainKey]
    : state?.travel?.eventTablesByTerrain?.[terrainKey];
  const list = asTableUuidList(source);
  return String(list.find((v) => String(v || "").trim()) ?? "");
}

export function getMappedTableUuids(state, phase, terrainKey) {
  const source = phase === "camping"
    ? state?.camping?.eventTablesByTerrain?.[terrainKey]
    : state?.travel?.eventTablesByTerrain?.[terrainKey];
  return asTableUuidList(source);
}

function resolveMappedTableUuidByIndex(state, phase, terrainKey, index = 0) {
  const list = getMappedTableUuids(state, phase, terrainKey);
  const idx = Math.max(0, Number(index || 0));
  return String(list[idx] ?? "");
}

function updateTableUuidList(next, phase, terrainKey, list) {
  if (phase === "camping") {
    next.camping.eventTablesByTerrain[terrainKey] = list;
  } else {
    next.travel.eventTablesByTerrain[terrainKey] = list;
  }
}

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

function drawResultText(draw) {
  const result = draw?.results?.[0] ?? null;
  if (!result) return "No result.";
  if (result.text) return String(result.text);
  if (result.documentCollection && result.documentId) {
    return `${result.documentCollection}: ${result.documentId}`;
  }
  return "Result rolled.";
}

async function drawOnce(table, { displayChat = true } = {}) {
  const draw = await table.draw({ displayChat });
  return {
    draw,
    text: drawResultText(draw),
  };
}

async function drawWorstOfTwo(table) {
  const a = await drawOnce(table, { displayChat: false });
  const b = await drawOnce(table, { displayChat: false });

  const content = `
    <div>
      <p><b>Pick the worse event result</b></p>
      <p><b>Result A:</b> ${esc(a.text)}</p>
      <p><b>Result B:</b> ${esc(b.text)}</p>
    </div>
  `;

  const picked = await customDialog({
    title: "Select Worse Event Result",
    content,
    buttons: {
      first: { label: "Use Result A", callback: () => "first" },
      second: { label: "Use Result B", callback: () => "second" },
    },
    default: "second",
    width: 420,
  });

  const selected = picked === "first" ? a : b;
  await ChatMessage.create({
    user: game.user.id,
    speaker: { alias: "Travel Planner" },
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    content: `
      <div class="uesrpg-travel-event">
        <h3>Event (Worst Result Applied)</h3>
        <p><b>Result A:</b> ${esc(a.text)}</p>
        <p><b>Result B:</b> ${esc(b.text)}</p>
        <p><b>Applied:</b> ${esc(selected.text)}</p>
      </div>
    `,
  });
  return selected;
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

function buildTableResults(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  return rows.map((text, idx) => ({
    type: CONST.TABLE_RESULT_TYPES.TEXT,
    text: String(text),
    weight: 1,
    range: [idx + 1, idx + 1],
    drawn: false,
  }));
}

async function ensureWorldTable(name, entries, { overwrite = false } = {}) {
  const existing = game.tables.find((t) => String(t.name) === String(name)) ?? null;
  if (existing && !overwrite) return existing;
  if (existing && overwrite) {
    await existing.update({
      formula: `1d${entries.length}`,
      replacement: true,
      displayRoll: true,
      results: buildTableResults(entries),
    });
    return existing;
  }
  return RollTable.create({
    name,
    formula: `1d${entries.length}`,
    replacement: true,
    displayRoll: true,
    results: buildTableResults(entries),
  });
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
