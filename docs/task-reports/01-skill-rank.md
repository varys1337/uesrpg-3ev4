# Task 01 - Preserve explicit skill ranks during creation

**Date:** 24 October 2026.  
**Result:** IMPLEMENTED; all five source checks PASS; live acceptance NOT RUN.  
**Scope:** Task 01 and its Task 00 source baseline. Later tasks remain separate.

## Baseline and evidence

| Field | Recorded value |
| --- | --- |
| Repository identified by the manifest | https://github.com/varys1337/uesrpg-3ev4 |
| Workspace | `C:/dev/uesrpg/uesrpg-3ev4-14.0.0` |
| Branch, baseline commit, final commit, PR | Unavailable. `git status --short` reports that this directory is not a Git repository. No repository was initialized, commit made, or PR created. |
| System and package version | `14.2.0` |
| Manifest compatibility | Minimum `14.368`, verified `14.368`, maximum `14`; unchanged |
| Implementation acceptance target | Foundry v14.369+ within v14; runtime compatibility has not been established by these source checks |
| Node | `v24.13.0`; package requires `>=24 <25` |
| Live Foundry build, browser, test world, world backup | Not supplied or exercised; source checks only were selected |
| Task-pack reference | Written against approximately `14.3.1`; reconciled against this workspace rather than assumed current |

**Source-confirmed before the change:** `SimpleItem._preCreate` awaited its superclass, respected cancellation, then unconditionally called `updateSource({ 'system.rank': 'untrained' })` for `skill`, `combatStyle`, and `magicSkill`. This overwrite was not reproduced in a running Foundry world.

**Source-confirmed after the change:** the method records incoming field presence before awaiting the superclass. The default is applied to those same three types only when the request omits `system.rank`. Explicit values are left to the existing document/model creation workflow. No live persistence or UI behavior is claimed as observed.

## Canonical owners and inspected paths

| Responsibility | Existing owner and relevant data flow |
| --- | --- |
| Item creation default | [SimpleItem](../../src/core/documents/item.js), `_preCreate`; the only production owner changed |
| Field-presence detection | Existing `hasChangedPath` in the same module: own dotted key check followed by `foundry.utils.hasProperty` for nested input; reused without a new helper |
| PC/NPC sheet creation | `PCActorSheetV2._onItemCreate` and `NpcSheetV2._onItemCreate` delegate to `onItemCreate` in `src/ui/sheets/shared/dialogs/equipment-dialogs.js`, then the existing embedded-document creation helper |
| Sheet duplication and external drops | PC/NPC duplication passes `item.toObject()` to `requestCreateEmbeddedDocuments`; external drops use `createExternalDroppedItem` and `buildDroppedItemCreateData` in `src/utils/dnd-external-create.js`. These routines do not assign a replacement skill rank. |
| Authorized embedded creation | `requestCreateEmbeddedDocuments` in `src/utils/authority-proxy.js` checks ownership, calls `sanitizeEmbeddedDocData`, and awaits `parent.createEmbeddedDocuments`. The sanitizer retains nested `system` data and dotted `system.*` keys. |
| Model defaults and cleaning | `src/core/data-models/registry.js` and `defaults.generated.js`, sourced from `template.json`. The three rank fields currently use a generated string default of `""`; this is not evidence that the caller explicitly supplied a rank. No rank-enumeration validator was added. |
| Actor skill population | `SimpleActor._preCreate` and `getCoreSkillSourcesSorted` in `src/core/compendium/core-skills.js`; inspected and unchanged |
| Character generation and advancement | Existing character-generation seeds, racial grants, rank planning and AppV2 item submission remain unchanged. Creation does not perform an advancement purchase or XP charge. |
| Registration | `src/system.js` invokes the init owner, which registers `SimpleItem`, TypeDataModels, authority helpers and the existing AppV2 sheets. No registration or listener was added. |

These are inspected source relationships. Runtime lifecycle behavior for every entry point still requires the acceptance cases below.

## API verification and production change

No new Foundry API usage was introduced. Official v14 references consulted:

| API | Visibility and use |
| --- | --- |
| [Document._preCreate](https://foundryvtt.com/api/v14/classes/foundry.abstract.Document.html#_precreate) | Documented protected override; receives the initial creation request data. Preserve the awaited superclass call and `false` cancellation. |
| [Item.updateSource](https://foundryvtt.com/api/v14/classes/foundry.documents.Item.html#updatesource) | Public; the documented way to modify the pending document during creation. Its existing default assignment is now conditional. |
| [foundry.utils.hasProperty](https://foundryvtt.com/api/v14/functions/foundry.utils.hasProperty.html) | Public nested-property presence utility; already used by `hasChangedPath` |
| [Item.create](https://foundryvtt.com/api/v14/classes/foundry.documents.Item.html#create), [createEmbeddedDocuments](https://foundryvtt.com/api/v14/classes/foundry.documents.Item.html#createembeddeddocuments), [toObject](https://foundryvtt.com/api/v14/classes/foundry.documents.Item.html#toobject) | Public creation and serialization methods used by existing entry points and the manual verification procedure |

The production patch consists of one presence check, an explanatory comment, and a guard around the existing default assignment. It does not read prepared `this.system.rank` to infer caller intent. The superclass return value, cancellation path, NPC armor initialization, and other item types retain their existing code.

**Persistence:** only defaulting of `system.rank` on new Items is affected. Existing Items are not rewritten. No schema, generated defaults, migration revision, flag, permission route, hook, public export, form handler, or package metadata changed. Existing model cleaning/validation continues to determine how malformed explicit values are handled.

## Source validation ledger

All baseline commands passed before the production patch. Post-patch results:

| Command or check | Baseline | After patch | Evidence |
| --- | --- | --- | --- |
| `npm run lint` | PASS | PASS | Exit 0 |
| `npm run syntax:check` | PASS | PASS | Exit 0; 783 JavaScript files checked |
| `npm run schema:check` | PASS | PASS | Exit 0; generated TypeDataModel seeds match `template.json` |
| `npm run data:check` | PASS | PASS | Exit 0; 30 spell effects and 13 strike enchantments match their catalogs |
| `npm run validate` | PASS | PASS | Exit 0; 783 JavaScript files, 105 templates, 17 Markdown files, and 6,993 import/export bindings validated |
| Protected-path comparison | Not applicable | PASS | SHA-256 values unchanged for 18 inspected model, manifest, actor, import, character-generation and sheet files |
| Narrow production diff | Not applicable | PASS | Original-file comparison shows only the presence capture/comment and guarded default assignment |
| `npm ci` | NOT RUN | NOT RUN | Existing installed development dependencies were used; no dependency changes required |

The baseline and post-patch release validators report the same static coverage limits for dynamic-import promises, namespaces passed beyond direct access, and computed namespace members. Affected areas include chat-outcome executors, runtime API registration, macros, and an actor-sheet computed member. These notices are coverage limitations, not validation failures or runtime compatibility evidence. No new validation notices or failures were introduced.

No dedicated regression harness is present. No test files or testing infrastructure were added. These commands validate source contracts; they do not execute Foundry document creation, permission checks, or AppV2 interactions.

## Reproducible live acceptance - all NOT RUN

Use a backed-up, disposable Foundry v14.369+ world with the exact build recorded. Disable external modules initially. Prepare two sanitized actors, an NPC, a trained compendium Item, an owner player, a non-owner player, and linked/unlinked token variants where Item creation is supported. Record source exports before each case and after reloading. Do not run these steps in a live campaign.

For direct world-Item creation, the following are individual manual examples, not an installed test harness:

```js
// Rank omitted: expect stored rank "untrained".
await Item.implementation.create({ name: "Task 01 rankless skill", type: "skill" });

// Nested input: expect stored rank "expert".
await Item.implementation.create({
  name: "Task 01 nested expert", type: "skill", system: { rank: "expert" }
});

// Dotted input: verify the existing creation pipeline accepts this form
// and retains "expert"; platform acceptance has not been exercised here.
await Item.implementation.create({
  name: "Task 01 dotted expert", type: "skill", "system.rank": "expert"
});
```

Inspect the resulting Item sheet and its source export or `toObject().system.rank`. Repeat across the following matrix:

| Case | Procedure and expected observation | Status |
| --- | --- | --- |
| 01-A | Create each of `skill`, `combatStyle`, and `magicSkill` without a rank, directly and with the PC/NPC sheet add controls. Expect stored `untrained`. | NOT RUN |
| 01-B/C | For each of the three types, create an Item with each canonical rank: `untrained`, `novice`, `apprentice`, `journeyman`, `adept`, `expert`, `master`. Expect the exact supplied rank after creation and reload. | NOT RUN |
| 01-PATH | Repeat trained creation with nested and dotted input through the existing creation helper. Record platform acceptance and the persisted rank; the patch adds no new input-expansion mechanism. | NOT RUN |
| 01-D | Copy a trained skill between the two actors and duplicate it using the existing sheet action. Expect the destination rank to match the source; source Item unchanged. | NOT RUN |
| 01-E | Import a trained compendium Item into the world and onto an actor. Compare the stored rank with the source. | NOT RUN |
| 01-F | Create representative unrelated equipment and NPC armor. Compare with baseline behavior, including automatic category coverage and existing manual coverage. | NOT RUN |
| 01-G | Reopen the Item and Actor sheets, reload the client, export the actor, and reimport into the disposable world. Compare stored ranks and visible selections. | NOT RUN |
| 01-H | Supply an empty string, `null`, an unknown string, and a non-string rank in separate creations. Record existing model acceptance, cleaning or rejection. The Item override must not add an unconditional `untrained` replacement for an explicitly supplied field. | NOT RUN |
| 01-CANCEL | Using a supported controlled cancellation in the test environment, confirm a rejected creation produces no persisted Item or post-cancellation default write. | NOT RUN |
| 01-PERM | Repeat a trained and a rankless case as GM and owner player; verify a non-owner cannot bypass existing creation permissions. Where supported, repeat on a linked actor and an unlinked token actor and verify only the intended inventory changes. | NOT RUN |
| 01-WARN | Across these cases, record console errors/deprecations, unexpected document writes, and disagreement between source exports and AppV2 inputs. | NOT RUN |

For each result record the case, Foundry build, user role, actor/token identity, input, expected and observed source rank, PASS/FAIL, and export/console evidence. Existing model coercion must be distinguished from the removed unconditional default. A source check or mock is not a substitute for this evidence.

## Rollback, limitations, and handoff

Before editing, the production file was copied byte-for-byte to the workspace-only, ignored directory `release/backups/task-01-skill-rank-20261024/src/core/documents/item.js`. The original checksum is also stored in `item.js.sha256`; `unchanged-paths.sha256.json` records the 18 protected paths. These local recovery files are not part of a release artifact.

- Original production SHA-256: `657e93dd69d7ed122e6f565c54060d94941774448752c98a68f957e92963cddd`.
- Patched production SHA-256: `4a02accce7ec728e1a7ab959dc3c6069d752c6cb820e22c69f763e30fe12f12d`.
- To roll back this task, stop the test instance, preserve any newer work, verify the backup checksum, and copy that original file back to `src/core/documents/item.js`. Recheck its hash and run the same five source checks. Revert or update this report to reflect the restored source.
- Source rollback does not alter Items created during subsequent acceptance testing. If those stateful tests need to be reversed, restore their matching copied-world backup rather than resetting ranks by inference. No world data was changed during this implementation.

Task 00's source investigation is recorded here, but its full architecture inventory, runtime fixtures, deprecation capture, performance measurements, and world-restoration acceptance remain incomplete. No release build, deployment, version/compatibility bump, migration, live test, or later task was performed. Live acceptance is required before claiming this fix has been validated on Foundry v14.369+.
