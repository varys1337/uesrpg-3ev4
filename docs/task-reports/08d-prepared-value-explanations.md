# Task 08D - Available prepared-value explanations

**Date:** 25 October 2026. **Scope:** current prepared fields; no calculation trace or persisted snapshot. **Native acceptance: NOT RUN.**

## Baseline and source behavior

The 08C checkpoint passed at 1,537 files / 360 tests. Verified originals and SHA-256 inventories are under ignored `release/backups/deferred-source-wave-20261025-182237/08d-prepared-values/`. Node v24.13.0; branch/commit remain unavailable.

The [pure projection](../../src/core/actors/prepare/derived-explanation.js) reads only seven selected prepared families: HP, magicka, stamina, luck points, speed, initiative and wound threshold. It copies existing base/bonus/max/value fields and optional entries from the already-prepared feature-mod grouping. It does not call a calculator, collect effects, scan Items or sum contributions. Invalid/missing fields stay Not recorded; explicit zero/negative numbers and numeric text remain available.

The projection deliberately does not assert base + bonus = final, and it never reconstructs effect/equipment attribution. Prepared feature records can differ from the final application/filtering order; the disclosure labels that limitation. It copies source display labels, selected field, recorded value and known mode only, excluding UUIDs/IDs, raw rule objects and arbitrary metadata. Existing encumbrance computation/dialog is untouched.

PC/NPC context includes the fresh projection only for the requested combat part and only for GM/owner after the existing limited-view early return. The new [shared partial](../../templates/partials/sheets/prepared-value-explanation.hbs) is preloaded by the existing template owner and placed in the existing combat scroll region. It adds no inputs, action listeners, form state, cache, queue or document write. The existing health refresh owner already requests sidebar+combat; other native/explicit part behavior is preserved.

Disclosure is closed by default with native summaries, semantic description lists, localized labels/modes, normal template escaping and scoped bounded scrolling/focus styling. No new full-sheet refresh mechanism is introduced.

## Validation

Observed **373 tests / 25 suites**, 0 failed; runner duration 594.9656 ms. Node v24.13.0.

| Check | Exit | Elapsed |
| --- | --- | --- |
| npm test | 0 | 1022.511 ms |
| npm run lint | 0 | 10370.531 ms |
| npm run syntax:check | 0 | 38284.162 ms |
| npm run schema:check | 0 | 567.942 ms |
| npm run data:check | 0 | 588.141 ms |
| npm run validate | 0 | 47216.508 ms |

The initial source check recorded 25 static binding coverage notices. Final source/documentation validation, exact hashes and the allowed change set are recorded separately in this checkpoint's validate-final.result.json and preservation-proof.json. Native execution and remote CI remain NOT RUN.

Direct-import tests cover inconsistent prepared fields, zero/negative/numeric text, invalid/missing inputs, no inferred equation, source privacy, explicit contribution inclusion, canonical Map/plain groups and unchanged input. No Foundry simulator, loader or dependency is added. Static ownership checks protect the projection. Model seeds, mechanics, migrations, settings and metadata remain unchanged.

## Native procedure - all NOT RUN

Use [Task 05 correctness cases](05-appv2-sheet-performance.md#future-benchmark-procedure---not-executed), [Task 12 accessibility cases](12-supportability-accessibility.md#future-native-procedure---every-case-not-run) and the [integration guide](../testing.md). Compare the displayed fields with actual prepared values during HP/resource, characteristic, rank, equipment and effect changes, full/partial renders and reload. Confirm missing sources stay unavailable, and existing ENC/TN controls retain their canonical behavior. Test GM/owner/observer/limited/non-owner, linked/unlinked tokens, read-only sheets, keyboard, screen reader, narrow/wide views, focus/scroll, rapid edits and submit/close. All remain **NOT RUN**.

## Rollback and gates

Restore this checkpoint's changed files and remove its new projection, partial, tests and report, retaining 12B/08B/08C. Source-only work needs no world restoration; later stateful acceptance requires coherent copied-world backups. No derived calculation, model/default, data format, dependency, version or compatibility declaration changes. Measured optimization, schema/typed-chat adoption, native acceptance and publishing remain gated.

