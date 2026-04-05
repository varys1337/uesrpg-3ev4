# Active Effects

This folder is the shared Active Effect evaluation layer for the system.

Ownership:
- `collect.js` decides which actor and transfer effects are currently applicable.
- `evaluate.js` resolves numeric modifier keys and detailed breakdowns.
- `capability-flags.js` resolves boolean capability flags.
- `reducers.js` is the shared ADD/OVERRIDE reduction helper layer used by the evaluators and actor prepare.
- `modifier-registry.js` is the canonical catalog of supported modifier keys for authoring and validation.

Guidelines:
- Keep generic AE mode semantics here, not duplicated in actor-specific prepare code.
- Preserve actor cache behavior (`_aeApplicableCache`, `_aeTotalsMap`) when changing evaluation flows.
- Treat undocumented Foundry AE behavior as unknown and keep system-side resolution explicit.
