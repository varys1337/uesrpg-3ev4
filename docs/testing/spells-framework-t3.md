# Spells Framework T3 — Data Standardization + UX Parity + Dispel

## Scope
T3 completes four sub-tasks:
- **T3-A** — Modifier Registry (single source of truth for AE change keys)
- **T3-B** — Spell Sheet UX Hardening (rune/summon/zone UI, solid bindings)
- **T3-C** — Actor Spell Effects Breakdown UI (Origin AE summaries)
- **T3-D** — Dispel Service (RAW-compliant spell removal)

## Files Modified / Created

| File | Status | Notes |
|------|--------|-------|
| `src/core/active-effects/modifier-registry.js` | **New** | Canonical registry of all AE modifier keys, validation helpers |
| `src/core/magic/spell-effects.js` | Modified | Registry validation on spell AE creation (dev-mode warnings) |
| `src/core/magic/dispel-service.js` | **New** | RAW spell dispel with Origin AE teardown, selection dialog |
| `src/ui/sheets/shared/spell-effects-breakdown.js` | **New** | Prepares Origin AE summary data for actor sheet |
| `src/ui/sheets/actor-sheet.js` | Modified | Added breakdown data to getData(), cancel-spell listener |
| `templates/actor-sheet.html` | Modified | Collapsible Spell Effects Breakdown section in Magic tab |
| `templates/spell-sheet.html` | Modified | Rune/Summon/Zone checkboxes + rune trigger config |
| `src/system.js` | Modified | Exposed dispel, modifier registry APIs on game.uesrpg |

## Validation
All 8 files pass static analysis with zero errors.

---

## Manual Test Plan

### T3-A: Modifier Registry

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | Registry loads | `game.uesrpg.modifierRegistry.getAllKeys()` in console | Array of ~100+ entries with key/label/category |
| 2 | Known key check | `game.uesrpg.modifierRegistry.isKnown("system.modifiers.combat.attackTN")` | `true` |
| 3 | Unknown key check | `game.uesrpg.modifierRegistry.isKnown("system.foo.bar")` | `false` |
| 4 | Dynamic skill keys | `game.uesrpg.modifierRegistry.isKnown("system.modifiers.skills.athletics")` | `true` (dynamic pattern) |
| 5 | Validate spell AE changes | Enable spellCastingDebug, cast a spell with effects | Console shows validation messages for any unknown keys |
| 6 | No false positives | Cast a spell with standard modifier keys (e.g., speed bonus) | No warnings in console |

### T3-B: Spell Sheet UX

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | Rune checkbox persists | Open spell sheet → check "Rune/Trap" → save → reopen | Checkbox still checked |
| 2 | Rune trigger config visible | Check "Rune/Trap" → attributes tab | Trigger type dropdown, radius, delay inputs appear |
| 3 | Summon checkbox persists | Check "Summon" → save → reopen | Checkbox still checked |
| 4 | Zone checkbox persists | Check "Persistent Zone" → save → reopen | Checkbox still checked |
| 5 | Rune config hidden when unchecked | Uncheck "Rune/Trap" | Trigger/radius/delay fields disappear |
| 6 | Inline scaling still works | Edit scaling levels → change values | Saves without rerender thrashing, `preventRender: true` active |
| 7 | All existing fields intact | Open various spells → check all tabs | No missing bindings, all fields functional |

### T3-C: Actor Spell Effects Breakdown

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | Section appears when active | Cast a spell on self → open actor sheet → Magic tab | "Spell Effects Breakdown" section visible below Effects |
| 2 | Section hidden when empty | Actor with no Origin AEs | Section does not appear |
| 3 | Correct spell info shown | Cast a buff spell | Shows spell name, school, duration, cost, modifier keys |
| 4 | Duration updates | Advance combat rounds | Duration label updates (e.g., "3 rounds remaining") |
| 5 | Upkeep badge shown | Cast an upkeep spell, refresh once | "Upkeep ×1" badge visible |
| 6 | Cancel button works | Click ✕ on a self-cast spell | Confirmation dialog → spell ends → effects removed |
| 7 | Cancel hidden for non-self | Another caster's spell effect on this actor | No cancel button shown |
| 8 | Modified keys displayed | Spell with AE changes (e.g., +10 speed) | Key/value badges visible |
| 9 | Collapsible | Click "Spell Effects Breakdown" header | Section collapses/expands |

### T3-D: Dispel Service

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | Enumerate effects | `game.uesrpg.magic.enumerateDispellable(actor)` | Array of DispellableEffect objects |
| 2 | SS filter works | `enumerateDispellable(actor, {maxSpellLevel: 2})` | Only effects with spellLevel ≤ 2 returned |
| 3 | Dispel dialog shows | `game.uesrpg.magic.showDispelDialog(actor, {spellStrength: 3})` | Dialog with checkboxes for qualifying effects |
| 4 | Selective dispel | Uncheck some effects → click "Dispel" | Only checked effects removed |
| 5 | Dispel All | Click "Dispel All" | All qualifying effects removed at once |
| 6 | Origin AE teardown route | Dispel a spell that has an Origin AE | Origin AE deleted → linked entities cleaned up |
| 7 | Orphan AE cleanup | Dispel a legacy spell effect (no Origin AE) | AEs deleted directly from target |
| 8 | Chat message | After successful dispel | Chat shows "Dispel: X dispels Y from Z" |
| 9 | `uesrpg.spell.dispelled` hook | Register listener before dispel | Hook fires with correct payload |
| 10 | Empty target notification | Dispel target with no spell effects | "No dispellable spell effects" notification |

### Integration

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1 | System loads without errors | Launch Foundry, open world | Console clean, no import errors |
| 2 | All APIs exposed | Check `game.uesrpg.magic.dispel`, `game.uesrpg.modifierRegistry` | Function references returned |
| 3 | NPC sheet unaffected | Open NPC sheet | No errors, effects section unchanged |

---

## Architecture Notes

### Modifier Registry Design
- All keys from `docs/Active Effect Wiki.md` are represented
- Dynamic patterns for per-skill (`system.modifiers.skills.<key>`) and per-location AR keys
- Validation is opt-in (dev-mode warnings) to avoid breaking existing content
- Spell-relevant keys flagged for future spell-effect builder UX

### Dispel Architecture
- Three-tier fallback: Origin AE teardown → caster Origin AE lookup → direct AE deletion
- RAW: Spell Strength determines max dispellable Spell Level
- Selection UI allows per-effect granularity or "Dispel All"
- All routes use authority-proxy for permission safety
