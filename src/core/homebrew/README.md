# Homebrew

`index.js` and `settings.js` remain the canonical public seams.

- `engagement-flanking/engagement-flanking.js` remains the runtime orchestrator.
- `engagement-flanking/constants.js` owns engagement tables and stable subsystem constants.
- `engagement-flanking/refresh-context.js` owns coalesced refresh context state and dirty-token aggregation.
- `reach-length/weapon.js` and `engagement-flanking/equipped-weapons.js` remain small standalone helpers.

The homebrew folder keeps behavior additive and compatibility-safe; extracted helpers should remove duplication without creating parallel runtimes.
