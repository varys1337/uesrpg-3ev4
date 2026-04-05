# src/utils Audit (2026-03-03)

## Top-level `src/utils/*.js`

| File | Category | Import Count | Action |
|---|---|---:|---|
| `ae-helpers.js` | runtime-foundry | 6 | keep (single source of truth for AE grouping) |
| `aoe-utils.js` | runtime-foundry | 5 | keep |
| `async-guard.js` | runtime-pure | 10 | keep |
| `authority-proxy.js` | runtime-foundry | 124 | keep (sanitize parity fixed) |
| `chat-message-socket.js` | runtime-foundry | 19 | keep |
| `clone.js` | runtime-pure | 11 | keep |
| `coerce.js` | runtime-pure | 21 | keep |
| `debug.js` | runtime-foundry | 43 | keep (SYSTEM_ID constant refactor) |
| `degree-roll-helper.js` | workflow | 38 | keep as compatibility wrapper |
| `dialog-v2-helper.js` | ui | 72 | keep |
| `dnd-debugger.js` | runtime-foundry | 5 | keep (SYSTEM_ID constant refactor) |
| `dnd-external-create.js` | runtime-foundry | 0 | keep (used through wrapper module) |
| `dnd-parse.js` | runtime-foundry | 0 | keep (used through wrapper module) |
| `drag-payload.js` | runtime-foundry | 4 | keep |
| `drop-data.js` | runtime-foundry | 7 | keep |
| `drop-item-create-data.js` | runtime-foundry | 3 | keep |
| `enrich-cache.js` | ui | 7 | keep |
| `permissions.js` | runtime-foundry | 13 | keep |
| `skillCalcHelper.js` | runtime-pure | 4 | keep |
| `stringHelpers.js` | runtime-pure | 1 | keep (now reused by birthsign dialog) |
| `uuid-cache.js` | runtime-pure | 2 | keep |

## `src/utils/dev/*.js`

Category for all files below: `dev/node-only`.

| File | Import Count | Action |
|---|---:|---|
| `actor-select-debug.js` | 2 | keep |
| `ae-keys-dump.js` | 1 | keep |
| `chapter4-audit.js` | 1 | keep |
| `chapter6-audit.js` | 1 | keep |
| `chapter6-spell-catalog.js` | 0 | keep |
| `chapter6-spell-remediation.js` | 1 | keep |
| `debug-settings.js` | 2 | keep |
| `enchanting-audit.js` | 0 | keep |
| `opposed-diagnostics.js` | 2 | keep |
| `skill-tn-debug.js` | 2 | keep |
| `spell-audit.js` | 2 | keep |
| `spell-profile-test.js` | 2 | keep |

## Structural notes

- `src/utils/degree/*` added for roll-core/workflow split.
- Node-only generator moved out of runtime tree:
  - from `src/utils/generate-item-defaults.js`
  - to `tools/generate-item-defaults.js`
