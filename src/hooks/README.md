# `src/hooks`

This folder owns Foundry lifecycle registration and startup ordering.

- `init.js` is the canonical init orchestrator.
- `system.js` owns lifecycle ordering and lazy runtime registration.
- `registerOnce()` in `_internal/hook-registry.js` is the only hook dedupe seam.
- Subsystem runtime logic belongs in `src/core/*`; hooks should register and delegate, not re-own that logic.
