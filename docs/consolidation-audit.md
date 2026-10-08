# Consolidation audit — Foundry v14.368+

Source implementation record, completed September 26, 2026. Package version remains **14.2.0**. The compatibility floor is **14.368** and the existing manifest `verified` value remains 14.368. This record does not certify the changed source against a running Foundry world. Complete the [live acceptance checklist](consolidation-acceptance.md) before deployment.

## Scope and reference boundaries

The approved work consolidates duplicate execution and persistence paths while retaining UESRPG rules, document fields, public entry points, visibility policies, and the restored 14.1.1 sheet geometry. Existing ApplicationV2 surfaces retain their native lifecycle and serialized form handling. This update introduces no schema migration, changes no document type, and removes no existing data field.

Only the [official Foundry v14 API](https://foundryvtt.com/api/v14/index.html) establishes API behavior. In particular:

- [Actor](https://foundryvtt.com/api/v14/classes/foundry.documents.Actor.html) supplies document update and synthetic Actor contracts. Update helpers now distinguish a returned document from a rejected or cancelled write.
- [preUpdateDocument](https://foundryvtt.com/api/v14/functions/hookEvents.preUpdateDocument.html) permits changes to differential update data; [updateDocument](https://foundryvtt.com/api/v14/functions/hookEvents.updateDocument.html) follows a confirmed update. Soul Trap records its transition in the former and performs capture in the latter.
- [DocumentSheetV2](https://foundryvtt.com/api/v14/classes/foundry.applications.api.DocumentSheetV2.html) and [ActiveEffect](https://foundryvtt.com/api/v14/classes/foundry.documents.ActiveEffect.html) remain the UI and effect reference points. No legacy application surface or duration format is reintroduced.
- [mergeObject](https://foundryvtt.com/api/v14/functions/foundry.utils.mergeObject.html), [diffObject](https://foundryvtt.com/api/v14/functions/foundry.utils.diffObject.html), and [escapeHTML](https://foundryvtt.com/api/v14/functions/foundry.utils.escapeHTML.html) support the shared state and rendering helpers. Defender protection is explicit and does not depend on an undocumented array merge policy.

The following pinned implementations informed the separation of preparation, validation, execution, and reporting. Their mechanics and schemas were not imported, and their use of an API is not evidence of v14 support:

| Reference inspected | Pattern used in this update |
| --- | --- |
| [dnd5e activity mixin, 6.0.x at ed87b71](https://github.com/foundryvtt/dnd5e/blob/ed87b71c1f6ab8b0aa6351cb6a3f7ba017aa0cb2/module/documents/activity/mixin.mjs) | One execution entry with shared preflight and cost reporting. |
| [pf2e roll context, v14-dev at f35cd8b](https://github.com/foundryvtt/pf2e/blob/f35cd8b6dd1b16bdbe5d3948b5d51beaa1940030/src/module/actor/roll-context/base.ts) | Domain-specific calculation context remains separate from persistence. |
| [Crucible action model at f63f314](https://github.com/foundryvtt/crucible/blob/f63f3147a26eab9303f4e48a8a7418c152767a16/module/models/action.mjs) | Explicit action preparation and feedback through a defined owner. |

These are audit snapshots, not a promise that the upstream default branches remain at those revisions.

## Completed source work

| Stage | Canonical owner | Result |
| --- | --- | --- |
| 1. Confirm writes | `src/utils/authority-proxy.js`; damage post-application helpers | Failed document writes stop the HP success path. Apply markers and receipts follow confirmed writes. Results distinguish failure before commitment from partial completion afterward. |
| 2. Damage and healing | [ApplyDamageService](../src/application/combat/apply-damage-service.js) | Public damage/healing facades, chat, spells, alchemy, and ongoing damage reach one application service. It owns Actor resolution, local serialization, receipts, and commit outcomes. Raw calculators retain their distinct rules. |
| 3. Feature activation | [activation-executor](../src/core/system/activation/activation-executor.js); [feature-dispatcher](../src/core/traits/features/feature-dispatcher.js) | One policy/preflight path and the actual existing talent/power handlers replace no-op dispatch and fallback execution. Confirmation, row information, and spending share a cost preview. Handler failures cannot silently run a second implementation. |
| 4. Opposed persistence | [card-persistence](../src/core/opposed/shared/card-persistence.js) | Combat, magic, skill, and characteristic adapters share queueing, fresh reads, mutation, revision metadata, rendering, and confirmed writes. Retargeting uses an explicit revision-checked replacement. Attacker commits preserve unrelated defender choices and results. |
| 5. Time and effects | [combat-boundary-orchestrator](../src/core/time/combat-boundary-orchestrator.js); spell tick engine; Soul Trap service | Internal combat consumers execute in a defined, awaited order. The alternative legacy listeners and dormant upkeep scanner are removed. Spell ticks use captured boundary data. Soul Trap capture runs after a confirmed HP transition and checks an embedded Item capture identifier before creating another gem. |
| 6. Shared helpers and AppV2 | Existing document, effect, opposed, and sheet helpers; `src/utils` | Duplicate dice/range parsing, location normalization, recipient selection, escaping, prompts, card rendering, effect cast levels, and sheet actions use shared owners. Soul Energy normalization, submit/close flushing, portrait behavior, and layout dimensions remain intact. |
| 7. Action feedback | Chat apply handler, activation executor, shared resource arithmetic | Damage cards persist pending/applied/partial/failed state. Recovering a pending card uses the same receipt. Activation, drain, restoration, and effect-transfer failures provide feedback instead of a false success. Special-action handling has one owner for attacker and defender paths. |
| 8. Maintenance | [consolidation-checks](../scripts/consolidation-checks.js); [generate-data-catalogs](../scripts/generate-data-catalogs.js); release validator | Static checks reject raw damage bypasses, retired boundary listeners and execution functions, and exact copies of selected canonical helpers. Unused-code checks cover consolidated owners. Generated option escaping covers core dialogs as well as UI modules. Catalog JSON is generated from canonical JavaScript literals. |

The combat consumer order is conditions (100), spells and OverTime (190), spell expiry (200), fear (225), wounds (250), activation flags (300), surprise (325), attack tracking (350), and opposed effects (450). Public observation hooks follow internal dispatch; they are not a transaction or an awaited extension API.

## Duplicate inventory and preserved distinctions

The final comparison uses the same AST/token scan on both trees: JavaScript function bodies spanning at least eight lines, with whitespace and comments excluded and tokens otherwise unchanged. The saved baseline has **46 repeated-body groups / 109 occurrences** across **751 modules**. The updated tree has **6 groups / 13 occurrences** across **758 modules**. The earlier exploratory count of 43/101 used a different inventory and is superseded by this like-for-like comparison. These counts measure exact bodies, not semantic equivalence or bugs.

The six retained groups are small callbacks for inline Dice So Nice display, per-sheet combat signature caching, policy-local GM selection, contextual weapon lookup, HUD observation, and per-instance form queue cleanup. They do not run a second damage, activation, or combat-time engine. Keeping a callback near its owning instance or policy avoids inventing a new execution layer solely to reduce a text metric.

The following differences are intentional:

- Simple and opposed damage calculators retain their own mitigation inputs. Spell damage retains layered typed and magic resistance, absorption, and typed components. Warfare remains behind its feature gate.
- Resource costs and drains are not healing. Healing retains its Bleeding interaction; current-pool restoration and transfers share arithmetic while keeping their existing source-specific effects.
- Spell, generic effect, and wound expiration retain domain-specific eligibility under ordered dispatch. A phase callback registered by an extension is adapted into the composite spell boundary; it does not select a legacy engine.
- Strict numeric validation, permissive legacy parsing, and the broader hit-location parser remain distinct from the shared armor display-key normalizer.
- Already supported AppV2 surfaces are maintained rather than converted again. PC/NPC 910×890 and Item 640×620 baseline geometry, bounded scrolling, and document-derived inputs are preserved.

The static export comparison found **no removed ES module export names** in existing modules, including re-exported names. Existing `game.uesrpg` and `window.Uesrpg3e` aliases remain; window registration now occurs in the init API owner instead of import-time side effects. Hidden historical rollout settings are retained for stored-world compatibility, while their compatibility queries select the canonical implementations. Rolling back requires restoring source, not toggling an old setting.

## Commit and recovery limits

These are implementation boundaries to verify in a real world:

- Damage/healing HP data and its receipt are written together on the target Actor. The last **50 receipts** are retained. An old chat card whose receipt has been evicted does not have an indefinite replay guarantee; inspect the Actor before attempting recovery of old cards.
- Chat application uses the existing active-GM authority intent and per-operation locks. Module-local queues serialize this client's work; they do not provide distributed transactions for arbitrary simultaneous macro calls from different clients.
- Actor HP, embedded effects or equipment, feature uses, resource transfers, and chat messages are separate documents or writes. A failure after commitment is partial completion. Do not reset a partial card and repeat damage to repair an effect. Inspect committed state and repair only the missing operation.
- Magic follow-up work is claimed on the card before execution. A lost reply or interrupted follow-up is conservatively reported as partial because an HP receipt cannot prove every effect completed. Absorption decisions, including failed rolls, and typed damage components have their own receipts.
- External damage hooks and some existing domain observers remain best-effort notifications. Their completion is not represented by the core damage receipt. NPC death-overlay and other observer behavior still require live checks.
- Boundary progress and locks are in memory. Non-retry-safe consumers are not blindly repeated after partial failure. Persisted effect tick markers remain, but this update does not promise exactly-once behavior across a GM disconnect, browser reload, or server crash.
- Soul Trap preserves the existing HP-to-zero trigger and creation of a new filled gem. It does not redefine death rules or require an empty gem. A capture with no active GM or a failed receipt/effect cleanup requires inspection of the pending transition and caster inventory; no background recovery timer is added.

## Rules-dependent work left manual

Strike Soul Trap's marker has no canonical consumer matching spell Soul Trap. Connecting the two, changing the HP-zero trigger, or consuming an existing empty gem requires a rules decision. Marker-only enchantment conditions, dispel, and disintegrate stubs also remain manual. This consolidation does not invent missing mechanics or claim to automate them.

## Validation and release gate

Static checks only were authorized. Required commands are `npm run lint`, `npm run schema:check`, `npm run data:check`, and `npm run validate`. The validator also parses JavaScript, checks imports and reachability, verifies native AppV2 and v14 contracts, and checks package metadata, templates, localization, and local documentation links. Catalog validation covers **30 spell effects** and **13 strike enchantments** without executing runtime modules.

Final static results are recorded with the local checkpoint. No runtime test suite, test framework, release build, deployment, or world migration was run for this consolidation. Live acceptance remains **unperformed**; record its result in the [acceptance checklist](consolidation-acceptance.md). Follow the [release guide](Release.md) after acceptance.

## Review and rollback

Local recovery material is under `release/backups/consolidation-20260925/`, which is excluded from release artifacts. `baseline/` is the pre-consolidation source; numbered directories are complete source checkpoints. Each checkpoint has a binary-capable patch and SHA-256 change manifest. `latest.txt` identifies the final checkpoint. Static duplicate and export inventories are retained beside them. Installed dependencies and generated release folders are excluded from these snapshots.

Restore a complete checkpoint as a unit; do not mix old raw damage callers with new persistence code. Stop Foundry first, retain a copy of the current system and affected worlds, restore the chosen source tree, install its locked development dependencies, validate, and build an installable folder using the release guide. Restore a world backup only if world data itself must be reverted: source rollback does not undo HP, costs, Items, or effects already committed during play. Consolidation's additional receipt/transition flags do not replace existing schema fields.
