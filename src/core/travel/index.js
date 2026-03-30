import { createStarterEventTablesForGroup } from "./events.js";
import { resolveGroupActorForTravel } from "./group-resolution.js";
import { resetTravelPlannerState } from "./state.js";

export * from "./state.js";
export * from "./rules.js";
export * from "./rolls.js";
export * from "./events.js";

export function registerTravelApi() {
  if (!game.uesrpg) game.uesrpg = {};
  if (game.uesrpg.travel) return;

  game.uesrpg.travel = {
    openPlanner: async (opts = {}) => {
      const { openTravelPlanner } = await import("../../macros/travel-planner.js");
      return openTravelPlanner(opts);
    },
    createStarterEventTables: async (opts = {}) => {
      const group = await resolveGroupActorForTravel(opts);
      if (!group) return null;
      return createStarterEventTablesForGroup(group, { overwrite: Boolean(opts?.overwrite) });
    },
    resetPlannerState: async (opts = {}) => {
      const group = await resolveGroupActorForTravel(opts);
      if (!group) return null;
      return resetTravelPlannerState(group, { keepTables: opts?.keepTables !== false });
    },
  };
}
