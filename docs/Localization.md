# Localization

UESRPG uses Foundry's JSON localization dictionaries. English is the source language at `lang/en.json`.

## Adding or changing text

1. Add a namespaced key beneath `UESRPG` in `lang/en.json`.
2. Reference the key with `game.i18n.localize`, `game.i18n.format`, or the Handlebars `localize` helper.
3. Use `data-tooltip="UESRPG..."` for localization keys and `data-tooltip-text` only for dynamic text that is already localized.
4. Give icon-only controls an `aria-label` using the same localized key.
5. Run `npm run validate`. The release validator rejects missing static localization keys, unlabelled tooltip controls, invalid encoding, and broken local documentation links.

Do not add native HTML `title` attributes. The system uses Foundry-managed tooltips consistently across ApplicationV2 surfaces.

## Adding another language

Create a JSON dictionary under `lang`, then add it to the `languages` array in `system.json`. Keep the same key hierarchy as English. Missing translated keys fall back to English through Foundry's normal localization behavior.
