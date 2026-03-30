import { createStarterEventTablesForGroup } from "../core/travel/events.js";
import { resetTravelPlannerState, updateTravelPlannerState } from "../core/travel/state.js";
import { resolveGroupActorForTravel } from "../core/travel/group-resolution.js";
import { findOpenAppInstance, focusOpenApp } from "./shared.js";

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
  if (!opts.forceNew && opts?.reuseOpenWindow !== false) {
    const existing = findOpenAppInstance(
      TravelPlannerAppV2,
      (w) => String(w._groupUuid) === String(group.uuid),
    );
    if (existing) {
      if (opts?.tab && typeof existing.setActiveTab === "function") {
        await existing.setActiveTab(String(opts.tab));
      }
      return focusOpenApp(existing);
    }
  }

  const app = new TravelPlannerAppV2({
    groupUuid: group.uuid,
    tab: opts?.tab ?? "planning",
  });
  await app.render(true);
  return app;
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
