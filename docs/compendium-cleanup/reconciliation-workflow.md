# Core compendium authoring and verification workflow

This workflow covers the five core Item packs. It does not migrate imported world or actor Items. The immutable `baseline.json.gz` preserves all 1,715 starting records, including obsolete fields removed from current authoring sources. The field ledger records those removals separately from source-backed mechanical corrections. Entries without a verified Core counterpart retain their modeled profile and are explicitly identified for source review.

## Reconcile readable sources

Run `npm run compendium:reconcile` after changing the source transformations or verified reference data. This writes `packs/_source/*/pack.json`, the per-identity change ledger and readable audit. `npm run compendium:check` must then pass without changing sources.

`source-extracts/Chapter 3 - Skills.md` is the supplied chapter used for the governing-characteristics table. The other verified reference data is recorded in `core-reference.json` and `equipment-reference.json`. These are book reference data, not development instructions. Reconciliation does not depend on an untracked parent-folder chapter path.

The transformation uses the system's existing model seeds to exclude unsupported top-level system fields from shipped authoring data. It retains the original values in the baseline and ledger. Native validation and the compiled comparison remain required: a successful native constructor can normalize or discard an authored value, as the fractional-handedness discrepancy demonstrated.

Do not update `verification.json` to claim checks that were not performed. Native-persistence evidence is tied to each source file's SHA-256. Item-specific live evidence identifies the exact pack/ID and scenario; representative checks do not certify every entry or mechanical clause.

## Author through native Foundry operations

Use a disposable Foundry 14.368+ world and a separate system copy. Copy current runtime files and JSON authoring sources into that copy before launching it. Do not point the operation at a production world.

As GM in that disposable world, invoke the existing development authoring helper from a native Script Macro:

```js
const { rebuildCoreCompendia } = await import(
  "/systems/uesrpg-3ev4/src/utils/dev/core-compendium-authoring.js?revision=" + Date.now()
);
const result = await rebuildCoreCompendia({
  expectedWorldId: "uesrpg-core-authoring",
  dryRun: true
});
console.log(result);
```

Inspect the dry run, then use `dryRun: false`. The helper preflights the five packs, writes through pack-scoped Item document operations, preserves document and embedded IDs, performs necessary subtype replacements only in the authoring copy, restores the source ownership map for new entries, and verifies native readback. If an error occurs, retain its recovery backup and resolve it before copying any pack. Do not log the full backup into a chat card.

## Compare and copy complete databases

Run the read-only static comparison against the authoring system directory:

```powershell
node scripts/verify-core-compendia.js --root '<authoring-system-directory>' --write-report
```

Every authored field, document identity, embedded-effect identity/order and folder must match. The report lists native-added defaults and excludes only `_stats` bookkeeping. Extra or orphan database records fail the check. This reads database records; it never opens LevelDB for writing or edits its bytes.

Use **Return to Setup** to stop the authoring world cleanly. Confirm Setup is displayed. Before replacing bundled packs, confirm the source and destination paths resolve inside their intended directories and obtain exclusive read access to their existing database files, including `LOCK`. If a consumer still holds a pack open, stop that consumer before proceeding.

Retain each previous pack directory in a rollback checkpoint, then copy each complete native-authored directory to the path declared in `system.json`. Do not overlay selected LevelDB files or copy an open database. Run `node scripts/verify-core-compendia.js --write-report` against the workspace afterward.

## Static and live validation

Run the existing static tools, without running the automated test suite:

```powershell
npm run lint
npm run syntax:check
npm run schema:check
npm run data:check
npm run compendium:check
node scripts/verify-core-compendia.js --write-report
npm run validate
```

Perform the remaining scenarios recorded in `verification.json` through the isolated Foundry sheets, dialogs and authoritative outcome controls. Use a manually invoked native diagnostic to inspect actual document values when the sheet does not expose them. Record observations and limits, including cancellations, resource failures, expiry, stacking and permissions. Diagnostic declarations and source-text checks alone do not establish execution.

## Current checkpoint and rollback

`release/checkpoints/20261027-snare-verified-in-progress` is the latest in-progress snapshot of runtime, JSON sources, five compiled packs and audit artifacts. Earlier snapshots remain available at `release/checkpoints/20261027-snare-recovery-in-progress`, `release/checkpoints/20261027-snare-paths-in-progress`, `release/checkpoints/20261027-snare-in-progress`, `release/checkpoints/20261027-void-duration-in-progress`, `release/checkpoints/20261027-language-in-progress`, `release/checkpoints/20261027-summon-ritual-in-progress`, and `release/checkpoints/20261026-core-cleanup-in-progress`; the latter retains the original bundled pack directories under `previous-compiled`. Earlier per-file runtime backups and the original baseline packs remain under `release/backups/core-compendium-cleanup-20261026`.

This is an **in-progress checkpoint**, not completion of all five planned milestones. Feature/spell execution and several live failure scenarios remain outstanding. The current snapshot can be restored as a matched code/data set after closing database consumers. For pack rollback, retain the presently installed directory elsewhere in the workspace, then restore a complete saved directory; do not merge its database files. Earlier per-file backups are not a claimed full pre-task checkout.

Native API references: [Item document operations](https://foundryvtt.com/api/v14/classes/foundry.documents.Item.html), [database ID-preservation options](https://foundryvtt.com/api/v14/interfaces/foundry.abstract.types.DatabaseCreateOperation.html), [NumberField](https://foundryvtt.com/api/v14/classes/foundry.data.fields.NumberField.html), [DialogV2](https://foundryvtt.com/api/v14/classes/foundry.applications.api.DialogV2.html).
