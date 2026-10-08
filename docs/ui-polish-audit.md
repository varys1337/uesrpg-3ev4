# Final UI consistency polish — Foundry VTT 14.368+

Implemented in the workspace on 8 October 2026. Production changes are limited to the existing stylesheet and one attack-choice wrapper. The parchment-and-wood palette, input names, actions, results, document-update handlers, schemas, editor rules, actor navigation, and AppV2 lifecycle remain intact.

Evidence below is **source-preview evidence**: workspace HTML/Handlebars markup with representative data, the installed Foundry **14.368.0** core CSS/fonts, and manual browser inspection with DOM geometry readings. Measurements are CSS pixels, not measurements of the scaled attachment. The preview supplies simple localization/option helpers and does not initialize Foundry documents, ProseMirror, hooks, or workflows. **Live-world acceptance remains pending.** Foundry was at setup; no world was launched and no installed-system files were changed. No test files or automated test suites were created or run. A JavaScript syntax check and file-hash verification were performed.

## Numbered corrections

| Marker | Location | Before | Workspace result |
| --- | --- | --- | --- |
| ① | Standalone/opposed spell casting → Casting Options | Restraint 38 px; Overload 30 px and 8 px lower | Both 30 px with equal widths and matching edges. Wrapped peers grow together. |
| ② | Character creation → combat-style option grid | Visible panels 30 / 47 px; conflicting centering/stretch | Both 47 px in the wrapped sample; top and bottom edges match. |
| ③ | Shared confirmation/cancellation footer | Wrapped confirmation 45.59375 px; Cancel 30 px | Both 45.59375 px; shared grid stretches each row. |
| ④ | Magicka/resource footer at 280 px window width | Clear Buffers has 4 px horizontal overflow; forced single row | Three 248 px wide, 30 px high stacked actions with zero text overflow. Button-count rules now respect the existing 20 rem content breakpoint. |
| ⑤ | Horizontal navigation on all item types | Spell 34 px / 15 px type; Weapon 30 px / 17 px type; inconsistent widths and borders | Shared 15 px type, 1.2 line height, 6 × 12 px padding, equal-width tabs, one-pixel borders and stable 600 weight. Baseline height is 32 px (18 px text + 12 px padding + 2 px border), with a 30 px minimum. |
| ⑥ | Attack/defense variants with a dependent dropdown | A dependent main bar stays 30 px while a wrapped peer becomes 42.796875 px | Both main bars become 42.796875 px; the dropdown occupies a separate row. Existing natural-height layout remains the fallback when subgrid is unavailable. |
| ⑦ | Gap-managed choice grids and alchemy/enchanting picker lists | Generic sibling margin adds to an existing gap; enchanting sample gap is 14 px | Enchanting sample uses its declared 6 px gap. Plain vertical invocation lists retain their existing sibling spacing. |
| ⑧ | Character creation → four-column choices in a narrow dialog | Browser-wide media query leaves four 55.5 px columns in a 280 px window | Dialog-width query gives two 117 px columns; peer heights are 64.5 / 64.5 px and 47 / 47 px in the sample. |
| ⑨ | Travel planner → short window | Header is 498 px and leaves the active tab body at 0 px in a 380 × 360 px window | Header is bounded and scrollable; body has approximately 87.8 px and its own scroll region. The header retains natural height when space permits. |

## Local evidence archive

Preview captures, snapshots, and rollback files remain in `release/backups/ui-polish-20261008-095209/` in the original development workspace. These local recovery artifacts are excluded from repository source and release bundles. The paths below identify archived evidence; they are not embedded images or links to files shipped with this report.

- Markers 1-4, choices and footers: `visuals/01-04-before-after.jpg`.
- Marker 5, shared item navigation: `visuals/05-tabs-before-after.jpg`.
- Markers 6-8, dependent inputs, picker spacing, and narrow character choices: `visuals/06-08-before-after.jpg`.

Marker 9, complete short-window source previews:

| Before: body has no usable height | After: header and body can scroll |
| --- | --- |
| `visuals/09-travel-before.jpg` | `visuals/09-travel-after.jpg` |

## Implementation and review coverage

The three batches are preserved independently in the local archive's `manifest.json`:

1. **Choice bars and dependent controls:** extend the existing margin reset to gap-managed containers, stretch character-choice panels, and use a supported CSS subgrid for attack/defense peer bars. The Normal Attack gains the same existing wrapper as its peers. No listeners or functions were introduced.
2. **Footers:** stretch shared grid rows, remove the resource footer's late nowrap/flex overrides, and resolve the narrow-breakpoint specificity conflict with button-count classes. Existing colors, disabled styling and focus rules remain.
3. **Item tabs and remaining review:** consolidate the primary item navigation rules around the existing shared partial, remove competing Spell/Invocation primary-tab rules, add the narrow character-choice container query, and bound the travel header. Secondary spell tabs and actor navigation keep their existing specialized styles.

| Surface family | Review performed | Result / limit |
| --- | --- | --- |
| Four actor sheets | Player Character, NPC, Group and Warfare Unit PARTS, templates, selectors and representative contexts | Actor navigation and sheet/editor rules receive no production edits. Full live document population and bookmark behavior remain pending. |
| Sixteen item types | ammunition, armor, shield, combatStyle, container, equipment, item, invocation, magicSkill, power, scroll, skill, spell, talent, trait, weapon; source templates rendered with the shared navigation partial | At 560 px default preview width every primary tab is 32 px high; maximum peer width difference is 0.0078125 px. No horizontal content overflow was measured. Local inventory capture: `visuals/all-sixteen-item-sheets.jpg`. |
| Settings | Interface, Combat, Homebrew, Talents, Reach Visualizer, Debug and Migration | Source/selector review and representative contexts. Narrow Interface settings keep the Save action outside the bounded scrolling body. |
| Character creation and advancement | Wizard, race/birthsign menus, spend-XP and spell-learning menus; casting/choice consumers | Shared choice alignment applies; narrow four-column sample corrected. Selection/grant/purchase flows are unchanged and await live acceptance. |
| Resource and workflow dialogs | Magicka/Barrier, HP/Temp HP, Stamina, Burn Luck, Piety, condition choices, special actions, standalone/opposed casting | Shared footer/choice rules reviewed. Actual roll execution, refunds, spending and callbacks were not invoked. |
| Social, crafting, religion and campaign applications | Language/faction selectors, Alchemy/Enchanting workshops and pickers, Worship Manager, Travel Planner, Army Campaign and Warfare Encounter | All twenty application templates were rendered with representative or empty contexts and statically reviewed. Representative narrow/short layouts were inspected. No live crafting, encounter, campaign or religious state was changed. |
| Enabled system-styled journals | Installed v14 sidebar/pages/text templates and the system's opt-in journal selectors | Representative source layout and static review only; native journal navigation/editing remains a live-world check. |

Manual presentation checks covered default dialog/item widths (440 / 560 px), narrow windows (280 / 340 / 380 px), an enlarged item window (920 px), and short dialog/item/tool windows. Both light and dark body classes were inspected. Comfortable, compact and ultra item density previews all retained equal 32 px tab heights and width differences below 0.01 px.

The font stress previews explicitly override the preview's font variables to exercise **Cyrodiil, Magic-Cyr, Dorovar Carolus, Futura Condensed Medium, Kingthings Petrock, Morris Roman Black and Morris Roman Black Alternate**. Choice peers share heights even when text wraps, and all tab peers share widths/heights. This is a CSS stress check; it does not verify the live font-setting reload path.

Local supported-font stress capture: `visuals/fonts-wrapped-controls.jpg`.

Single-option casting, two options, optional full-width talent controls, longer refund text, selected/incompatible choices and native keyboard focus were inspected. The source preview shows no size changes caused by selection/focus; the disabled choice retains its geometry and visible dimming. Narrow stacked rows can have different heights according to their own labels; peers within the same row remain equal.

Local dark-theme state and keyboard-focus capture: `visuals/states-dark-and-focus.jpg`.

Long-description source previews remain bounded, with scrolling available in short item windows. Native ProseMirror preview/edit/save behavior was not initialized; its existing containment, padding and submit/update code was preserved byte-for-byte. Local density and short-window capture: `visuals/density-short-items.jpg`.

## Files and reversible delivery

- [Shared stylesheet](../styles/uesrpg.css#L10288): choices, footers, primary item tabs and travel header.
- [Attack markup wrapper](../src/core/combat/opposed/dialogs/attacker.js#L123): two added wrapper lines; names and handlers unchanged.
- Local `workspace.patch`, per-batch snapshots/diffs, raw measurements, native JPEG captures, and rollback files are kept in the backup directory.
- Local `rollback.ps1` is in that directory. The rollback ZIP is `release/ui-polish-20261008-095209.zip` in the original development workspace.

A 1,136-file baseline was hashed before edits. Only the stylesheet and attacker wrapper changed among those files; no baseline files were removed. Schemas, packs, localization, version metadata, all other JavaScript and templates remain identical to that baseline. The new audit report is recorded separately in the rollback manifest. The two installed-system counterparts were re-hashed and remained unchanged.

Every batch has its before snapshot and SHA-256 hashes. Full rollback checks every backup, destination and introduced-file hash before making any write. It refuses to overwrite later edits, restores the two original source files, removes this report only when its delivered hash still matches, and retains the backup/visual artifacts.

PowerShell validation (no writes):

```powershell
& 'C:/dev/uesrpg/uesrpg-3ev4-14.0.0/release/backups/ui-polish-20261008-095209/rollback.ps1' -CheckOnly
```

To restore this milestone, run the same script without `-CheckOnly`. The delivery check passed before packaging; rollback itself was not executed.

Existing surfaces remain on their supported [ApplicationV2](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html) / [DialogV2](https://foundryvtt.com/api/v14/classes/foundry.applications.api.DialogV2.html) architecture. No Foundry API or lifecycle change was introduced by this polish.

## Pending live-world acceptance

In an authorized loaded world on Foundry 14.368+, verify native casting/attack/defense dialogs with real talents, refunds, disabled options and dependent dropdown changes; keyboard navigation and tooltips; document-derived values and submissions; all sheet tabs with populated inventories; long ProseMirror descriptions in preview/edit modes; live settings/density/font application; journal editing; and crafting/travel/warfare/religion workflows. Resize representative windows to confirm controls remain reachable.

Chat cards and Foundry sidebar styling remain outside this patch. Installed-system deployment is separate and was not performed.
