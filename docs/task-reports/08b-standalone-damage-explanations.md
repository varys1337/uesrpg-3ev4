# Task 08B - Standalone recorded damage explanations

**Date:** 25 October 2026. **Scope:** presentation only, existing evidence. **Native acceptance: NOT RUN.**

## Baseline and ownership

The preceding 12B checkpoint passed at 1,531 complete inventoried files. Originals and SHA-256 inventory are preserved under ignored `release/backups/deferred-source-wave-20261025-182237/08b-standalone-damage/`. Branch/commit remain unavailable; Node v24.13.0, system 14.2.0 and compatibility declarations are unchanged.

The existing [damage projection owner](../../src/core/combat/damage/explanation.js) now projects recorded message Roll formula/total fields and validates standalone receipt identity. The GM formatter moved unchanged from the existing chat hook into [one shared formatter](../../src/ui/combat/damage-explanation.js), reused by opposed and standalone views. No second calculation or formatter is introduced.

The existing outcome service adds only presentation data/signatures/markup. It retains authority requests, queue/lock behavior, controls, resource writes, receipt persistence and application statuses. Calculation, application adapters, schemas, migrations and stored formats are unchanged.

## Provenance and visibility

Public disclosures contain only the native visible message's saved Roll formula/total, projected into plain allowed fields. They are labelled message rolls, not target application results. Rolls are attached only when the card has one unambiguous outcome; multiple outcomes and absent records display Not recorded. No roll is evaluated or associated by inference.

GM details require a unique outcome ID plus matching card target, message, expected receipt ID and receipt target. The receipt ID comes from the existing owner, and any synthetic Actor alias is supplied explicitly by the existing UUID resolver. Missing/inconsistent metadata displays Not recorded. A present incomplete or conflicting receipt is never supplemented from a historical report. A pruned receipt permits only the uniquely matched outcome's stored historical report, explicitly labelled as historical.

The native message/content visibility guards run before augmentation. GM HTML is assembled client-locally and never written into shared content. Public projection never reads payloads, mitigation, resources or receipts. Pending/processing/partial/failed states remain explicit. All new details are closed by default and reuse existing disclosure styles and scroll handling.

## Validation

Observed **344 tests / 23 suites**, 0 failed; runner duration 447.5109 ms. Node v24.13.0.

| Check | Exit | Elapsed |
| --- | --- | --- |
| npm test | 0 | 902.037 ms |
| npm run lint | 0 | 10393.906 ms |
| npm run syntax:check | 0 | 38499.497 ms |
| npm run schema:check | 0 | 677.879 ms |
| npm run data:check | 0 | 609.8 ms |
| npm run validate | 0 | 48121.162 ms |

The initial source check recorded 25 static binding coverage notices. Final source/documentation validation, exact hashes and the allowed change set are recorded separately in this checkpoint's validate-final.result.json and preservation-proof.json. Native execution and remote CI remain NOT RUN.

Directly imported production helpers cover zeros/negative/numeric strings, invalid Roll fields, receipt conflicts, stale targets, duplicate IDs, missing evidence, pruned receipts, synthetic aliases, partial state and unchanged inputs. Static ownership checks protect the shared formatter and pure projections. Existing static binding notices and module-type warning remain limitations, not runtime evidence.

## Native procedure - every case NOT RUN

Use [Task 08's native matrix](08-explainable-combat-calculations.md#native-acceptance-procedure---every-case-not-run) and the [canonical guide](../testing.md). Exercise standalone damage adapters with single/multiple outcomes and existing Rolls, receipt updates/pruning, partial/failed/processing results, wrong/deleted targets and linked/unlinked aliases. Compare owner/non-owner/GM, public/whisper/blind/content-hidden messages; inspect shared source for absence of injected GM HTML. Verify keyboard disclosure, localization, narrow panes, scroll restoration and unchanged write/render behavior. All are **NOT RUN**.

## Rollback and gates

Restore only this checkpoint's changed files and remove its new shared formatter/report, retaining 12B and prior tasks. Source rollback alone needs no world restore because no world was exercised. Later stateful tests require coherent copied-world restoration. Opposed-test/derived views and measurement coverage follow separately; native acceptance, optimization, model adoption, deployment and publication remain gated.

