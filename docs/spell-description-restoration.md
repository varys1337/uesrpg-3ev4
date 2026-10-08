# Spells Revised description restoration

Implemented on 7 October 2026 in the 14.2.0 workspace. This is a source compendium repair for Foundry VTT 14.368+.

The data repair changes exactly 23 Item `system.description` values. All other document data, including spell settings, flags, IDs, folder membership, and embedded Active Effects, is preserved. System version metadata is unchanged. A subsequent spell Overview styling correction is recorded below.

## Follow-up: blank spell Overview

The screenshots of Armor and Fire Bite revealed a display problem after the data restoration. Both the workspace pack and installed pack contain all 162 descriptions, including Armor (1,547 characters) and Fire Bite (1,261 characters). Those two descriptions were already present and were not rewritten.

Foundry 14.368 positions ProseMirror's content absolutely. The spell Overview used a natural-height body but overrode the editor minimum height to zero. Its absolutely positioned content contributed no height, so the editor collapsed and clipped the existing description.

The correction in `styles/uesrpg.css` gives the spell description editor a 180px minimum height and keeps the closed preview in normal flow. The active editor retains Foundry's existing layout. The existing height limit and scrolling contain long descriptions. This changes no templates, JavaScript, document values, journal references, or form submission behavior; the existing ApplicationV2 sheet and documented [TextEditor enrichment flow](https://foundryvtt.com/api/v14/classes/foundry.applications.ux.TextEditor.html) remain in use.

An isolated browser layout inspection used the actual pack descriptions, the post-initialization editor markup, and the installed Foundry 14.368 stylesheet. It reproduced a 0px editor height with the original CSS. The corrected preview measured approximately 374px for Armor and 362px for Fire Bite at a 720px viewport height, showing their prose, references, and seven-row scaling tables. Blind's recovered description also rendered with its four references and current scaling. This was a static layout inspection, not an authenticated Foundry session; it does not establish journal navigation or editor persistence in the live game. No test files or automated test suites were created or run.

The styling rollback backup is `release/backups/spell-sheet-description-display-20261007-142138/original-files/styles/uesrpg.css`. Its manifest records the original stylesheet and protected workspace hashes. Before/after Fire Bite screenshots and the corrected Armor screenshot are retained beside that manifest. The original compendium backup below remains available separately.

After explicit user approval, the same corrected stylesheet was copied to `C:/Users/Varys/AppData/Local/FoundryVTT/Data/systems/uesrpg-3ev4/styles/uesrpg.css`. Its original copy is retained in the styling backup under `original-installed-files/styles/uesrpg.css`; `deployment.json` records authorization and before/after hashes. The installed stylesheet matches the workspace correction exactly. No installed compendium or world data was modified. Foundry had closed before HTTP readback, so that server check was unavailable.

For manual acceptance in Foundry 14.368+, launch Foundry or hard-refresh an existing game browser (Ctrl+F5), then reopen Armor, Fire Bite, and Blind from the locked Spells Revised pack. Inspect the complete descriptions and scroll through their tables, follow a journal link, switch Casting/Automation/Overview tabs, and reopen the sheets. On an editable copy, confirm editing and saving a description persists after reopening. These in-game checks remain pending.

## Recovery and authoring

The attached `uesrpg-3ev4 (1).zip` contains the same active spell and journal pack files as the pre-repair workspace. Its superseded `packs/rules-compendium/spells-revised/004002.ldb` table still contains the 14 erased Illusion descriptions, matched by their original Item IDs. Those descriptions supplied the recovered flavor text, explanations, condition references, and counter-spell notes.

Displayed costs, strengths, durations, ranges, and attribute lists follow the current spell documents. Recovery does not restore older casting settings. Blind's text now uses Perception and a one-minute duration; Silence and Paralyze use Endurance; Invisibility describes the configured target within 50m. Original flavor text and counter-spell notes are preserved.

The three beams use their existing geometry and scaling, with references to the Beam form and applicable spell attributes. The four resistance variants use the existing Resistance trait explanation while preserving their current configuration. Spell Absorption uses its existing spell and trait journals, including the d10 absorption rule, and the current 4–22 cost table. Rite of Textual Inscription retains its explanation and gains Touch-form and ritual references.

### Affected spells

| Spell | Item ID | Description update |
| --- | --- | --- |
| Blind | `4Y8h5ow9T1mIt1dI` | Recovered prose and links; current defense, duration, costs, and attributes. |
| Calm | `Yjw9YMbaMMy7fRW9` | Recovered prose, Frenzy reference, and current values. |
| Chameleon | `2aNHextYgLHvZ30b` | Recovered condition link and current attributes. |
| Charm | `RXDX8JBmeaPQZRI4` | Recovered skill links; current 8–20 cost table. |
| Courage | `49j18EvgZ8eWXejC` | Recovered Fear and Willpower references; current area and caster exclusion. |
| Frenzy | `TqoNckJX6Dg0JYk3` | Recovered condition and Calm links; current duration and 11–29 costs. |
| Horror | `eYgNwUNsq46Zj7NJ` | Recovered Horror reference; current 9–27 costs and attributes. |
| Invisibility | `ZXEJqQDpYxaPaF5w` | Recovered condition and cancellation text; current ranged target and level-5 table. |
| Light | `e2uUGM4cW1ONIz6n` | Recovered explanation and current attributes. |
| Muffle | `vOH2AiZI8gcUFMY6` | Recovered condition link and current attributes. |
| Night Eye | `z1a2fO1xKqa2o2Ea` | Recovered explanation and current attributes. |
| Paralyze | `i9uBicMHhqRFfdG6` | Recovered condition link; current Endurance defense and attributes. |
| Sanctuary | `7v24RFvfbJ95GCbg` | Recovered defense, AoE, and Evade references; current attributes. |
| Silence | `cqZvfvozOq55W77q` | Recovered condition link; current Endurance defense and attributes. |
| Fire Beam | `PagjpZNqJ2bmO69O` | Linked beam description, 30m × 1m geometry, and scaling table. |
| Frost Beam | `MW8QZZVsPmCFUcSI` | Linked beam description, 30m × 1m geometry, and scaling table. |
| Shock Beam | `0nKV4Csg5HN2T6eo` | Linked beam description, 30m × 1m geometry, and scaling table. |
| Spell Resistance (Fire) | `Erd56kUDPhnJlOkH` | Linked Resistance explanation and current scaling. |
| Spell Resistance (Frost) | `4DxouGoBhX6fkKyQ` | Linked Resistance explanation and current scaling. |
| Spell Resistance (Shock) | `Pw37J1WC0mO9n5Qj` | Linked Resistance explanation and current scaling. |
| Spell Resistance (Poison) | `VAeaUIled5vKCckB` | Linked Resistance explanation and current scaling. |
| Spell Absorption | `LoqQCmYhLl3mHpvH` | Replaced obsolete summary with existing journal rules and current costs. |
| Rite of Textual Inscription | `9XvdaQYguk7PddrB` | Added Touch-form and original ritual-page references. |

## Data inspection

Authoring used the installed official Foundry CLI 3.0.3 to unpack an isolated copy, repack all documents, and re-export a copy of the promoted pack. No automated test suites or test files were used.

| Inspection | Result |
| --- | --- |
| Spell Items | 162 preserved |
| Compendium folders | 9 preserved |
| Embedded Active Effects | 120 preserved |
| Changed descriptions | 23 |
| Other spells | 139 unchanged |
| Non-description record changes | 0 |
| Empty descriptions | 0 |
| Spells with journal links | 162 |
| Journal references | 676, across 82 unique page UUIDs |
| Invalid paths or missing targets | 0 |
| Introduced journal anchors | 0 |
| Repaired scaling tables and attribute lists | Match current spell data |
| Reapplying the authoring repair | 0 further updates |
| Pre-existing files outside the spell pack | 1,451 SHA-256 hashes unchanged |
| Official CLI readback after promotion | Matches the authored documents exactly |
| Rollback readback in an isolated copy | All 291 records match the complete original baseline |

The workspace pack now selects `MANIFEST-000002` through `CURRENT`, with active records in `000005.ldb`. The execution policy blocked a directory-swap command before it ran, so promotion copied the rebuilt database files in place and switched `CURRENT` last. Original inactive database files were retained. This retained file set also permits rollback without deleting files.

Rules Reference journals, existing world items, the installed Foundry system, runtime source, templates, styles, and system version metadata are unchanged. No installable ZIP or automatic world migration was produced.

## Backup and rollback

The complete original pack, including all 20 original files, is retained at:

`C:/dev/uesrpg/uesrpg-3ev4-14.0.0/release/backups/spell-descriptions-20261007-131434/original-pack`

The repair folder also contains:

- `repair-manifest.json`: original pack hashes, protected-file hashes, expected IDs, and archive provenance.
- `recovered-descriptions.json`: the 14 recovered descriptions.
- `description-patch.json`: all 23 before/after descriptions and their SHA-256 hashes.
- `data-inspection.json`: final record, link, table, preservation, and readback results.
- `repair-descriptions.mjs`: gated staging authoring utility; default inspection, `--apply` authoring, and idempotent replay.
- `rollback.ps1`: verifies that the pack has not changed since promotion, then restores the original database manifest. It deletes no files and refuses to overwrite later edits.

To roll back this repair, ensure Foundry is not using this workspace pack and run the saved `rollback.ps1` in PowerShell. If the pack has changed since the repair, preserve those later changes before restoring the complete `original-pack` backup manually.

## Manual acceptance checks for Foundry 14.368+

These runtime checks have not been performed:

- Open the repaired spells through the existing ApplicationV2 sheet. Inspect prose, attributes, and tables for readable layout and stable scrolling, including Blind, Invisibility, a beam, a resistance variant, Spell Absorption, and the ritual.
- Follow characteristic, condition, counter-spell, trait, and spell-form links. Confirm the intended journal page opens.
- In a disposable world, import a repaired spell, edit and save its description, change an unrelated casting control, and close/reopen the sheet. Confirm the stored description and links persist.

Keep the existing verified Foundry build until runtime acceptance is completed.
