import { customDialog } from "../../utils/dialog-v2-helper.js";
import { getCoreRollMode } from "../../utils/chat-roll-mode.js";

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function labelForTerrain(terrainKey) {
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

export function labelForPhase(phase) {
  return phase === "camping" ? "Camping" : "Travel";
}

function asTableUuidList(raw) {
  if (Array.isArray(raw)) return raw.map((v) => String(v || ""));
  const single = String(raw || "").trim();
  return single ? [single] : [];
}

export function getMappedTableUuids(state, phase, terrainKey) {
  const source = phase === "camping"
    ? state?.camping?.eventTablesByTerrain?.[terrainKey]
    : state?.travel?.eventTablesByTerrain?.[terrainKey];
  return asTableUuidList(source);
}

export function resolveMappedTableUuid(state, phase, terrainKey) {
  return String(getMappedTableUuids(state, phase, terrainKey).find((v) => String(v || "").trim()) ?? "");
}

export function resolveMappedTableUuidByIndex(state, phase, terrainKey, index = 0) {
  const list = getMappedTableUuids(state, phase, terrainKey);
  const idx = Math.max(0, Number(index || 0));
  return String(list[idx] ?? "");
}

export function updateTableUuidList(next, phase, terrainKey, list) {
  if (phase === "camping") {
    next.camping.eventTablesByTerrain[terrainKey] = list;
  } else {
    next.travel.eventTablesByTerrain[terrainKey] = list;
  }
}

export async function postStageEventCheckChat({ groupActor, phase, terrainKey, check }) {
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
    { rollMode: getCoreRollMode() },
  );
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

export async function drawOnce(table, { displayChat = true } = {}) {
  const draw = await table.draw({ displayChat });
  return {
    draw,
    text: drawResultText(draw),
  };
}

export async function drawWorstOfTwo(table) {
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
    layout: "workflow",
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

export async function ensureWorldTable(name, entries, { overwrite = false } = {}) {
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
