/**
 * src/core/combat/damage-resolver.js
 * UESRPG 3e v4 — Damage Resolution Façade
 *
 * This file now acts as a stable public API façade.
 * Implementation has been segmented into cohesive internal modules under src/core/combat/damage/resolver/.
 *
 * Export (unchanged):
 *  - applyDamageResolved(targetActor, payload) - Main damage resolution orchestrator
 *
 * Importers (4 files):
 *  - src/hooks/init.js
 *  - src/core/combat/chat-handlers/index.js
 *  - src/core/conditions/condition-automation.js
 *  - src/core/combat/opposed-rolls.js
 *
 * Internal modules:
 *  - resolver/normalize.js - Hit location & damage type normalization
 *  - resolver/traits.js - Trait value aggregation helpers
 *  - resolver/sources.js - Source classification (natural/silver/sunlight)
 *  - resolver/armor.js - Armor source listing for chat attribution
 *  - resolver/ae-mods.js - Active Effects modifier parsing
 *  - resolver/sneak-attack.js - Sneak attack consumption logic
 *  - resolver/context.js - Damage context building from payload
 *  - resolver/resolve.js - Main orchestration logic
 */

// Re-export from internal modules (stable public API)
export { applyDamageResolved } from "./damage/resolver/resolve.js";
