import { requestUpdateDocument } from "../../utils/authority-proxy.js";

const FLAG_SCOPE = "uesrpg-3ev4";
const FLAG_KEY = "travelPlanner";
const STATE_VERSION = 1;

function deepClone(value) {
  if (typeof foundry?.utils?.deepClone === "function") {
    return foundry.utils.deepClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeTableMappings(map = {}) {
  const normalized = {};
  for (const [terrainKey, raw] of Object.entries(map ?? {})) {
    if (Array.isArray(raw)) {
      normalized[terrainKey] = raw.map((v) => String(v || ""));
      continue;
    }
    const single = String(raw || "").trim();
    normalized[terrainKey] = single ? [single] : [];
  }
  return normalized;
}

export function createDefaultTravelPlannerState() {
  return {
    version: STATE_VERSION,
    ui: { activeTab: "planning" },
    session: {
      terrain: "lightWoodland",
      currentStage: 1,
      totalStages: 1,
      journeyEntries: [
        {
          id: "entry-default",
          terrain: "lightWoodland",
          currentStage: 1,
          totalStages: 1,
        },
      ],
      activeJourneyEntryId: "entry-default",
      navigateLostPenaltyActive: false,
      effectFlags: {
        doubleEventWorstNext: false,
      },
    },
    planning: {
      entries: [],
      totals: {
        dos: 0,
        dof: 0,
        benefits: 0,
        impairments: 0,
        spentBenefits: 0,
        spentImpairments: 0,
      },
      spends: [],
    },
    travel: {
      assignments: [],
      checks: [],
      resources: {
        foodDays: 0,
        cookedFoodDays: 0,
        waterDays: 0,
        fodderDays: 0,
      },
      shortfalls: {
        food: false,
        cookedFood: false,
        water: false,
        fodder: false,
      },
      eventTablesByTerrain: {},
    },
    camping: {
      assignments: [],
      checks: [],
      eventTablesByTerrain: {},
    },
    history: {
      stageSummaries: [],
      eventLog: [],
    },
  };
}

export function migrateTravelPlannerState(rawState) {
  const base = createDefaultTravelPlannerState();
  if (!rawState || typeof rawState !== "object") return base;
  const next = foundry.utils.mergeObject(base, deepClone(rawState), {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true,
  });
  if (!Array.isArray(next.session?.journeyEntries) || !next.session.journeyEntries.length) {
    next.session.journeyEntries = [
      {
        id: foundry.utils.randomID(),
        terrain: String(next.session?.terrain ?? "lightWoodland"),
        currentStage: Math.max(1, Number(next.session?.currentStage ?? 1)),
        totalStages: Math.max(1, Number(next.session?.totalStages ?? 1)),
      },
    ];
  }
  if (!next.session?.activeJourneyEntryId) {
    next.session.activeJourneyEntryId = String(next.session.journeyEntries[0]?.id ?? "");
  }
  next.travel.eventTablesByTerrain = normalizeTableMappings(next.travel.eventTablesByTerrain);
  next.camping.eventTablesByTerrain = normalizeTableMappings(next.camping.eventTablesByTerrain);
  next.version = STATE_VERSION;
  return next;
}

export function getTravelPlannerState(groupActor) {
  if (!groupActor) return createDefaultTravelPlannerState();
  const raw = groupActor.flags?.[FLAG_SCOPE]?.[FLAG_KEY] ?? null;
  return migrateTravelPlannerState(raw);
}

export async function updateTravelPlannerState(groupActor, updater) {
  if (!groupActor) throw new Error("Missing Group actor for travel planner update.");
  const current = getTravelPlannerState(groupActor);
  const next = typeof updater === "function"
    ? updater(deepClone(current))
    : foundry.utils.mergeObject(current, deepClone(updater ?? {}), {
      inplace: false,
      overwrite: true,
      insertKeys: true,
      insertValues: true,
    });
  const migrated = migrateTravelPlannerState(next);
  await requestUpdateDocument(groupActor, {
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}`]: migrated,
  });
  return migrated;
}

export async function resetTravelPlannerState(groupActor, { keepTables = true } = {}) {
  const existing = getTravelPlannerState(groupActor);
  const fresh = createDefaultTravelPlannerState();
  if (keepTables) {
    fresh.travel.eventTablesByTerrain = deepClone(existing.travel.eventTablesByTerrain ?? {});
    fresh.camping.eventTablesByTerrain = deepClone(existing.camping.eventTablesByTerrain ?? {});
  }
  await requestUpdateDocument(groupActor, {
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}`]: fresh,
  });
  return fresh;
}

export function getTravelPlannerFlagPath() {
  return `flags.${FLAG_SCOPE}.${FLAG_KEY}`;
}
