# Actor Prepare

This folder owns actor derived-data preparation.

Ownership:
- `ensure-system-data.js` scaffolds missing runtime-safe system containers only.
- `humanoid-common.js` is the orchestration entrypoint for humanoid prepare.
- `shared/humanoid-*.js` contain stage-specific prepare logic split by behavior.
- Type wrappers like `character.js` and `npc.js` stay thin and only choose options.

Guidelines:
- Keep derived calculations staged and ordered.
- Keep schema backfills in `ensure-system-data.js`, not in the prepare stages.
- Preserve existing stored fields and world compatibility; derived refactors should be behavior-preserving.
