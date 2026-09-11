# Migrations

Canonical ownership in this folder:

- `runner.js` orchestrates migration order and in-flight locking.
- `actors.js`, `items.js`, and `combat-legacy.js` own migration passes for their document families.
- `state.js` is the single source of truth for migration version state.
- `item-defaults.generated.js` is generated input and should stay standalone.

Implementation rules:

- Keep passes additive, idempotent, and safe on repeated startup runs.
- Prefer named internal pass functions over one large imperative migration body.
- Preserve existing migration state keys, update ordering, and notification semantics.
