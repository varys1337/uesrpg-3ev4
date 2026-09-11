# Luck

`luck-workflow.js` is the public facade for Luck spending and Burn Luck UX.

- `message-classification.js` owns card classification and normalized side/result extraction.
- `actor-resolution.js` owns actor lookup, permission checks, whisper recipients, and UUID-cache reuse.
- `result-reresolution/` owns per-card mutation adapters and shared persistence guards.
- `roll-mode.js` owns roll-mode fallback for Luck-posted reroll messages.

Document and chat mutations stay at the workflow and re-resolution edges; helper modules stay read-oriented.
