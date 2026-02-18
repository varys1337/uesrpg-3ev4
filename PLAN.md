## Resolve Combat-Style Truncation and Eliminate PC/NPC Close-Lag (AppV2)

### Summary
This pass addresses two confirmed issues:

1. **Combat Style row still overflows** because current CSS truncation guardrails are too broad/competing and the combat table is still effectively using auto layout behavior.
2. **PC/NPC close lag** persists due heavier render/listener/observer behavior than Group sheet. Group performs better because it has far fewer per-render listener attachments, no auto-resize observer path, and less render-time DOM work.

This plan fixes truncation deterministically and performs a deeper performance hardening pass with measurable close-time targets.

---

### Important API / Interface Changes
- No schema or registration changes.
- Optional internal debug setting (client-scoped) for perf tracing:
  - `uesrpg-3ev4.sheetPerfTrace` (Boolean, default `false`)
- Internal refactor only:
  - actor/npc listener binding model shifts from many per-node listeners to delegated listeners with one-time install guards.
  - auto-resize lifecycle gets explicit reopen-safe re-init semantics and stricter teardown guarantees.

---

## Phase 1: Grounded diagnosis and measurable baseline

### 1.1 Add low-noise sheet perf markers (gated)
Files:
- `src/ui/sheets/v2/actor-sheet.js`
- `src/ui/sheets/v2/npc-sheet.js`
- `src/ui/sheets/v2/group-sheet.js`
- `src/hooks/init.js`

Actions:
- Register `sheetPerfTrace` setting.
- In each sheet:
  - Wrap `_prepareContext`, `_onRender`, `_attachPartListeners`, `_onClose` with `performance.now()` markers when enabled.
  - Log one-line structured timings with actor/sheet id and tab.
- Add warning threshold logs:
  - `_onClose` > 24ms
  - `_onRender` > 32ms
  - `_prepareContext` > 40ms

Outcome:
- You get side-by-side evidence of why Group is faster and where PC/NPC spend time.

### 1.2 Baseline scenarios
- Open/close PC 10x, NPC 10x, Group 10x.
- Record median + p95 close duration per sheet type.
- Capture which phase dominates (context prep vs listener binding vs close).

---

## Phase 2: Combat Style truncation (deterministic CSS/table constraints)

### 2.1 Isolate combat-style name layout from generic table rules
File:
- `styles/main.css`

Actions:
- Add combat-table-specific structure rules (higher specificity than generic `.item-name-cell`):
  - `.worldbuilding.sheet.actor:not(.group) .combat-style-table { table-layout: fixed; width: 100%; }`
  - Combat column widths:
    - Name `74%`
    - `%` `10%`
    - Rank `10%`
    - Trash `6%`
- Ensure row cell/container allow shrink:
  - `.combat-style-table td.item-name-cell { min-width: 0; }`
  - `.combat-style-table td.item-name-cell > .flex-container { display:flex; align-items:center; width:100%; min-width:0; gap:6px; }`
- Ensure only label truncates:
  - `.combat-style-table .item-name { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }`
  - `.combat-style-table :is(.combat-roll, .item-img, .item-control, .item-delete) { flex:0 0 auto; }`

### 2.2 Neutralize conflicting generic width rules
File:
- `styles/main.css`

Actions:
- Keep generic `.worldbuilding table .item-name-cell { width: 60%; }` for legacy tables, but explicitly override it for `.combat-style-table .item-name-cell` so combat rows are not constrained by legacy default.
- Keep tooltip behavior unchanged (already provided by actor/npc `.item-name` title binding).

Acceptance:
- Long combat style names truncate at name-column boundary in both PC and NPC combat tabs.
- `%/Rank/Delete` columns remain visible and aligned.

---

## Phase 3: Close-lag remediation (PC/NPC parity with Group-level responsiveness)

### 3.1 Replace per-node listener loops with delegated handlers
Files:
- `src/ui/sheets/v2/actor-sheet.js`
- `src/ui/sheets/v2/npc-sheet.js`

Actions:
- In `_attachPartListeners`, install one delegated listener set per part root using a guard attribute (e.g. `data-uesrpg-listeners="1"`).
- Replace repetitive loops over `.magic-roll`, `.item-name`, `.skill-roll-target`, `.minusQty`, `.uesrpg-attack-input`, etc. with delegated `click/contextmenu/change/keydown/input` handlers.
- Keep behavior exactly equivalent.
- Ensure search input uses one debounced handler per sheet instance and no duplicate attachment.

Why this matters:
- Current loop-based binding scales with row count and render count; delegated binding is O(1) per part and dramatically reduces teardown/GC pressure on close.

### 3.2 Reduce redundant render-time work in `_onRender`
Files:
- `src/ui/sheets/v2/actor-sheet.js`
- `src/ui/sheets/v2/npc-sheet.js`

Actions:
- Gate `changeTab(..., { force: true })` so it is only called when current tab state mismatches expected tab.
- Run `applyCollapsedGroups(el)` only when part contains collapse groups and only once per render cycle.
- Avoid unnecessary repeated class/title assignment scans when part unchanged (use part-level guard).

### 3.3 Auto-resize lifecycle hardening for reopen and close
File:
- `src/ui/sheets/v2/shared/auto-resize.js`

Actions:
- Fix reopen semantics:
  - If prior state is destroyed/closed, reinitialize state instead of early-returning on `installed`.
- Keep close teardown idempotent:
  - cancel RAF
  - disconnect observers
  - clear references
- Ensure no post-close `setPosition` calls occur:
  - guard with `isClosing || destroyed || !isConnected`.
- Keep observer scope narrow (active scroller only), not full app root.

### 3.4 Clean pending async/debounced work on close
Files:
- `src/ui/sheets/v2/actor-sheet.js`
- `src/ui/sheets/v2/npc-sheet.js`

Actions:
- On `_onClose`:
  - call auto-resize teardown first
  - cancel pending debounced search if available (`.cancel?.()` if supported)
  - null transient closures/refs that can hold DOM.
- Preserve existing tooltip cleanup.

---

## Phase 4: Comparative validation and acceptance gates

### 4.1 Functional tests
1. **Combat style truncation (PC + NPC)**
- Create extremely long names.
- Verify ellipsis in name cell with stable `%/Rank/Delete` visibility.

2. **No regression in other name columns**
- Magic and Items tabs still truncate by column width.
- Tooltips still expose full names.

### 4.2 Performance tests
1. **Close latency benchmark**
- Repeated open/close:
  - PC (large inventory/magic/combat data)
  - NPC (large profession/combat data)
  - Group (control)
- Target:
  - PC/NPC close median within 20% of Group close median.
  - No p95 close spikes > 2x Group p95.

2. **Observer/listener leak check**
- Open/close same sheet 20x.
- With perf trace enabled, verify stable timing trend (no upward drift).
- Verify no lingering resize logs after close.

### 4.3 Manual stress case
- Keep sheet open, perform many add/remove actions, tab switches, inline edits.
- Close sheet.
- Expected: no visible freeze/stall and no delayed post-close console activity.

---

## Assumptions and defaults
1. Target Foundry remains `v13.351`.
2. Truncation policy remains CSS width-based ellipsis only.
3. Scope includes AppV2 PC/NPC for performance fix; Group used as performance baseline and remains behaviorally unchanged except styling/text already requested.
4. No schema migration, no registration flow change, no legacy sheet removal.
