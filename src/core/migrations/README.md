# Migrations

Canonical ownership in this folder:

- `runner.js` owns one local coordinator for startup maintenance and full manual runs; `execution.js` supplies its callback sequencing.
- `actors.js`, `items.js`, and `combat-legacy.js` own migration passes for their document families.
- `state.js` is the single source of truth for revision completion. Positive failure counts keep a record pending without rewriting it; `reviewRequired` alone does not.
- `revisions.js` retains all revision numbers and startup pending-notice membership. `worldDataVersion` is informational.
- `../../utils/authority-proxy/shared.js` owns native write acknowledgement checks; migration payloads still use their existing native APIs, including forced subtype replacements.
- `../data-models/defaults.generated.js` is the canonical generated input for TypeDataModels and Item normalization.

Implementation rules:

- Keep transformations and payloads idempotent. Startup runs only existing settings and NPC armor maintenance; historical failures wait for explicit manual retry.
- Prefer named internal pass functions over one large imperative migration body.
- Preserve state keys and update ordering. Reject known failures and missing/partial acknowledgements before completion, then re-read persisted revisions before aggregate success.
- Check the existing active-GM helper before passes and completion writes. Local coordination does not provide a cross-client transaction or a gameplay readiness barrier.

See [Task 06](../../../docs/task-reports/06-migration-readiness.md) for source evidence, runtime acceptance and coherent rollback.
