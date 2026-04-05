# `src/data`

This folder owns static runtime datasets and compatibility artifacts.

- JS catalog modules are the canonical runtime source of truth.
- `spell-effects.json` and `strike-enchantments.json` are generated compatibility artifacts.
- Regenerate those JSON files with `npm run data:sync`; do not hand-edit them.
- Condition rules text and Token HUD metadata live in `conditions/conditions-data.js`.
