# Item-sheet layout and interaction milestone

Implemented in the workspace for Foundry VTT 14.368+. Delivery contains nine modified source files, one shared partial, this report, and a rollback backup. No version, schema, migration, or game-mechanics changes were made.

**Changes delivered**

- Description and Overview editors use a bounded flex layout through the active tab, wrappers, and native editor. Item sheets override the previous viewport-height cap. Preview and editing content scroll internally while the editor frame grows with the sheet. The prior spell visibility fix is preserved. Very short windows retain a usable minimum editor area and use the existing outer scroll lane when the header consumes the available height.
- Ammunition uses the existing damage-type catalog in a dropdown, with an empty option and the exact selected custom value retained as a legacy option. Preparing the options does not update the document. Existing submit normalization and field bindings are retained.
- Structured Qualities, weapon Qualities, and Spellcasting Configuration share a compact 17 px heading token instead of viewport-dependent title sizing.
- Armor coverage checkboxes save their captured boolean values in order through the existing form-update queue and document-update helper. Each queued operation compares against the current document and patches only its location. Updates use `render: false` to retain unrelated unsaved form fields. Failed writes use the queue's existing notification and resynchronize the affected checkbox after pending changes finish. The Apply Category Coverage button, action, handler, and three unused localization keys were removed.
- Coverage changes use the existing Item lifecycle to mark manual coverage, including clearing all six locations. They do not require an armor category. Creation/migration category defaults, update hooks, combat consumers, and coverage displays are retained without modification.
- Characteristics and Resistances on Equipment, Item, Trait, Talent, and Power sheets use responsive grids, readable body text, tighter rows, and 52 × 26 px numeric controls. Existing bindings are preserved, including equipment's `prcChaBonus` and the feature partial's `prChaBonus`.
- Equipment and Item share a registered Alchemy partial. Its heading, existing enable/remove actions, and ingredient/product configuration sit inside a rounded panel matching Soul Energy. Existing flags, permissions, slot controls, and drop selectors are preserved.
- Weapon Min/Max Reach retain their bounded 44 px width and use the 26 px small control-height token. Quality and trait checkbox boxes and native glyphs both use 16 px; boxes cannot shrink, and trait rows and labels can wrap.

**Modified files**

| File | Change |
| --- | --- |
| `styles/uesrpg.css` | Editor containment, compact headings/stats/reach, Alchemy panel, checkbox sizing |
| `src/ui/sheets/v2/item-sheet.js` | Queued per-location coverage updates; obsolete button action removed |
| `src/ui/sheets/item/prepare.js` | Ammunition dropdown options, retaining empty and legacy values |
| `src/hooks/init/register-templates.js` | Shared Alchemy partial registration |
| `templates/v2/sheets/ammunition-sheet.hbs` | Damage-type dropdown |
| `templates/v2/sheets/armor-sheet.hbs` | Coverage confirmation button removed |
| `templates/v2/sheets/equipment-sheet.hbs` | Shared Alchemy partial |
| `templates/v2/sheets/item-sheet.hbs` | Shared Alchemy partial |
| `lang/en.json` | Three unreferenced button-only localization entries removed |
| `templates/partials/sheets/alchemy-panel.hbs` (new) | Consolidated Alchemy markup |

**Completed inspections**

- JavaScript syntax checks and the repository's targeted ESLint correctness checks passed for the three modified JavaScript files.
- All 54 relevant Handlebars templates compiled: 22 shared sheet partials and 32 item header/body templates. The new partial's registration, references, localization, actions, and drop selectors were inspected.
- Input-name comparisons against the backup matched exactly after expanding the shared partial: Ammunition 6, Armor 21, Equipment 32, Item 32. Locale comparison found only the three intended removals. No references to the removed action or localization keys remain in source/templates/locales.
- A browser layout inspection used the workspace templates/styles and the installed Foundry 14 core stylesheet/fonts in a temporary local preview. It did not load a world or perform document writes. Native editor DOM was represented for layout inspection; this is not confirmation of native editor behavior.
- The description inspection covered 270 combinations: 15 item types with existing editors, 460 × 520 / 640 × 620 / 1024 × 960 sheet sizes, preview/editing layouts, and empty/short/long content. Editor heights ranged from 182 to 786 px, with no item viewport cap or horizontal overflow. Long content remained inside a scrollable content area. Short-window outer scrolling retained access to editors instead of collapsing them. Container has no active description editor and was not given one.
- The attribute inspection covered 87 layouts across normal/narrow/enlarged widths and comfortable/compact/ultra density settings, including Alchemy off/ingredient/product states. No horizontal tab or panel overflow was found. Stats measured 52 × 26 px at the 15 px body token, checkbox boxes/glyphs 16 px, shared headings 17 px, and reach controls 44 × 26 px. A custom ammunition option remained selected in the preview.
- Hash comparison found exactly the nine intended existing workspace files changed, with no unexpected changes or deletions. All 192 workspace pack files and version metadata remained unchanged. All 1,340 pre-existing installed-system files matched the baseline. An additional installed-system runtime `.lock` file appeared during this work and was left untouched; this repair did not write to the installed system or world data.
- No test files were created and no automated test suites were run. Layout measurements and screenshots are inspection artifacts in the backup directory.

**Pending manual acceptance on Foundry 14.368+**

Load the workspace build in a separate validation instance before checking these runtime behaviors. The installed system has not received this milestone.

- Resize Ammunition, Armor, Shield, Combat Style, Equipment, Item, Invocation, Magic Skill, Power, Scroll, Skill, Spell, Talent, Trait, and Weapon editors at normal/enlarged/narrow widths. Check empty/short/long descriptions, preview/edit transitions, full native toolbar visibility, internal scrolling, journal-link navigation, and save/reopen persistence.
- Save/reopen ammunition with empty, catalog, and legacy custom damage types. Save unrelated fields while a legacy value is selected. Confirm both section headings remain consistent.
- Toggle each armor location on/off, clear all six, and make rapid changes. Confirm persistence, existing combat/coverage displays, armor without categories, embedded PC/NPC armor, ownership restrictions, failed-save recovery, and retention of unrelated unsaved fields.
- Inspect all shared stats panels, Alchemy off/ingredient/product states, spell drops and slot permissions, reach inputs, and checked trait pills under each density setting. Check keyboard focus, wrapped labels, and narrow controls.

The ItemSheetV2 and native ProseMirror flows are retained. API references: [ApplicationV2 form-change lifecycle](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html#_onChangeForm), [HTMLProseMirrorElement](https://foundryvtt.com/api/v14/classes/foundry.applications.elements.HTMLProseMirrorElement.html), and [document update render option](https://foundryvtt.com/api/v14/interfaces/foundry.abstract.types.DatabaseUpdateOperation.html#render).

**Backup and rollback**

Backup: `C:/dev/uesrpg/uesrpg-3ev4-14.0.0/release/backups/item-sheet-milestone-20261007-154720`.

`original-files/` contains the nine originals. `manifest.json` records original and delivered SHA-256 hashes and the baseline inventory. `rollback.ps1` checks every target and backup hash before writing, restores the originals, and removes the newly introduced partial and this report. It refuses to overwrite subsequent edits. Reapplying rollback to the already-restored state is a no-op.

From the workspace in PowerShell, inspect rollback without restoring:

```powershell
& '.\release\backups\item-sheet-milestone-20261007-154720\rollback.ps1' -CheckOnly
```

Omit `-CheckOnly` to restore. The script never targets the installed system, packs, worlds, or version metadata.
