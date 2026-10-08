# Item-sheet spacing and typography follow-up

Implemented the four screenshot follow-ups in `styles/uesrpg.css` for the workspace build. No JavaScript, templates, document data, compendium packs, world data, or version metadata were changed. Nothing was copied to the installed system.

- **Single spell editor frame:** the outer editor section no longer adds its own border, padding, background, or inset shadow. The native editor owns the visible frame. Overview wrappers no longer add successive padding layers. This also applies to Invocation's matching Overview layout.
- **Balanced description space:** Description/Overview panes stop reserving scrollbar gutters at the window, body, tab, and text-container levels. Long text retains its internal scrollbar. The existing minimum editor area and short-window outer-scroll fallback remain available.
- **Description text padding:** preview and editing text surfaces receive 10 px vertical and 12 px horizontal padding. Padding is applied once when an editor-content wrapper contains ProseMirror, so editing does not acquire a second inset.
- **Equipment and Item labels:** Soul Energy, Alchemy, Wearable Item, and Equipped share the 15 px body-font style and 600 weight. The Wearable/Equipped rule targets their existing field names; other attribute rows are unaffected.
- **Ammunition typography:** section headings share a 17 px body-font style. Header stat labels, Damage Type, quality labels, configuration prose, and attribute controls use the 15 px body scale. Item names, window titles, navigation, values, and selection/save behavior are retained.

**Completed inspection**

- Inspected the CSS diff against the pre-edit backup. The stylesheet is the only existing source file changed; the follow-up report is the only new workspace file outside the backup directory.
- Rendered the existing templates with workspace CSS and Foundry 14 core styles/fonts in a temporary local source preview. All 54 relevant Handlebars templates compiled. The preview represented editor DOM and an expanded toolbar for layout inspection; it did not load a Foundry world or perform document saves.
- Inspected 270 Description/Overview layouts: 15 item types, three sheet sizes (460 × 520, 640 × 620, 1024 × 960), preview/editing modes, and empty/short/long content. Editor frames remained bounded, with no horizontal overflow or viewport-height cap. Every text surface had `10px 12px` padding. All long-content cases scrolled internally. Non-fallback editor frames had equal left/right gaps; short-window fallback retains only the space used by an actual outer scrollbar.
- At 1024 × 960, the spell editor's outer gaps changed from 52/82 px to 22/22 px. Its frame grew from 890 to 980 px wide and from approximately 669 to 715 px high in the inspected editing layout. The outer section's border measured zero; the editor retained its own single border.
- Inspected 87 attribute layouts across narrow/normal/enlarged widths and comfortable/compact/ultra density settings. No horizontal overflow was found. All four Equipment/Item peer labels measured 15 px with the same font and weight; ammunition labels measured 15 px and section headings 17 px with the same font family.
- Preserved all pre-existing workspace pack files and version metadata by hash comparison. The installed stylesheet was checked without changing it. Foundry had some installed pack `LOCK` files open exclusively; they were left untouched.
- The hash-gated rollback check passed without restoring files. No test files were created or automated test suites run.

**Pending live acceptance**

On a validation instance using the workspace build and Foundry 14.368+, resize Spell and Invocation Overviews and other item descriptions. Check preview/edit transitions, the full native toolbar, single-frame appearance, text insets, narrow/short windows, internal scrolling, journal navigation, and save/reopen persistence. Inspect Equipment/Item labels and ammunition headings/controls under each density setting, including empty and legacy damage types.

This patch changes presentation only and retains the existing [native ProseMirror element and save flow](https://foundryvtt.com/api/v14/classes/foundry.applications.elements.HTMLProseMirrorElement.html).

**Backup and rollback**

Backup: `C:/dev/uesrpg/uesrpg-3ev4-14.0.0/release/backups/item-sheet-spacing-20261007-170237`.

It contains the original stylesheet, original/delivered SHA-256 hashes, layout inspection JSON, before/after screenshots, and `rollback.ps1`. The rollback script checks every affected target before writing, restores the stylesheet, and removes this new report. It refuses to overwrite subsequent edits.

```powershell
& '.\release\backups\item-sheet-spacing-20261007-170237\rollback.ps1' -CheckOnly
```

Omit `-CheckOnly` to restore. To roll back the earlier item-sheet milestone as well, restore this follow-up first, then use the milestone's rollback script. Both original backup sets remain intact.
