## `src/ui`

- `sheets/v2/` is the canonical direction for migrated surfaces.
- Large sheet files should orchestrate AppV2 lifecycle and delegate reusable behavior to `sheets/shared/*` and `sheets/v2/shared/*`.
- Legacy `ui/apps/*.js` files should stay thin compatibility wrappers when a V2 implementation already exists.
- Shared listeners own reusable behavior; sheet classes should not re-implement the same roll, combat, inventory, or dialog flows locally.
