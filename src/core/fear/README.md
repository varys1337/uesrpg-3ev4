# Fear

`index.js` is the public API surface for fear tests and registration.

- `effects-and-restrictions.js` owns fear Active Effect state, restriction aggregation, and encounter cleanup helpers.
- `panic-horror-tables.js` owns the table-driven panic and horror outcomes.
- `fear-dialogs.js` owns the fear test configuration dialog.
- `snap-out.js` owns Snap Out rolls and turn-start prompting.
- `combat-boundary.js` owns combat-time hook registration and turn-boundary orchestration.

The goal is to keep rules and effect mutation helpers separate from registration and prompt entrypoints.
