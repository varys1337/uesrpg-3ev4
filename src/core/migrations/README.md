# Migrations

Canonical ownership in this folder:

- `runner.js` orchestrates migration order and in-flight locking.
- `actors.js`, `items.js`, and `combat-legacy.js` own migration passes for their document families.
- `state.js` is the single source of truth for migration version state.
- `../data-models/defaults.generated.js` is the canonical generated input for TypeDataModels and Item normalization.

Implementation rules:

- Keep passes additive, idempotent, and safe on repeated startup runs.
- Prefer named internal pass functions over one large imperative migration body.
- Preserve existing migration state keys, update ordering, and notification semantics.
