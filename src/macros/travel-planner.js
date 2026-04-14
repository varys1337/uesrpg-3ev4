import { createStarterEventTablesForGroup } from "../core/travel/events.js";
import { resetTravelPlannerState, updateTravelPlannerState } from "../core/travel/state.js";
import { resolveGroupActorForTravel } from "../core/travel/group-resolution.js";

export async function openTravelPlanner(opts = {}) {
  const group = await resolveGroupActorForTravel(opts);
  if (!group) return null;

  try {
    await updateTravelPlannerState(group, (next) => {
      next.ui.lastOpenedAt = Date.now();
      next.ui.lastOpenedBy = String(game.user?.id ?? "");
      return next;
    });
  } catch (_e) {
    // Non-blocking metadata stamp.
  }

  const { TravelPlannerAppV2 } = await import("../ui/apps/v2/travel-planner-app.js");
  return TravelPlannerAppV2.prompt({
    groupUuid: group.uuid,
    tab: opts?.tab ?? "planning",
    forceNew: Boolean(opts.forceNew || opts?.reuseOpenWindow === false),
  });
}

export async function createStarterTravelEventTables(opts = {}) {
  const group = await resolveGroupActorForTravel(opts);
  if (!group) return null;
  return createStarterEventTablesForGroup(group, { overwrite: Boolean(opts?.overwrite) });
}

export async function resetTravelPlanner(opts = {}) {
  const group = await resolveGroupActorForTravel(opts);
  if (!group) return null;
  return resetTravelPlannerState(group, { keepTables: opts?.keepTables !== false });
}
