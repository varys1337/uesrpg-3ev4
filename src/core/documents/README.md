## Documents

This folder owns the public Foundry document classes for the system.

Ownership:
- document classes orchestrate lifecycle hooks and delegate
- `actor/`, `combat/`, and `item-prepare/` helpers own pure or narrowly-scoped computation
- document writes stay at lifecycle edges, never inside prepare-only helpers

Rules:
- keep `SimpleActor`, `SimpleItem`, and `SystemCombat` stable
- prefer cached prepare snapshots over repeated collection scans
- extract additive helpers under this folder instead of creating parallel utility layers elsewhere
