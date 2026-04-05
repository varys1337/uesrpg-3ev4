## Stamina

Canonical entrypoints:
- `stamina-dialog.js` owns the user-facing spend dialog.
- `stamina-effects.js` owns stamina effect lookup and consumption.
- `stamina-integration-hooks.js` owns workflow integrations that apply or consume stamina effects.

Ownership:
- `stamina-options.js` owns the stamina option catalog and icons.
- `stamina-spend.js` owns resource spending, effect creation, and result chat output.

Rules:
- Keep dialog/UI code separate from mutation edges.
- Reuse `stamina-effects.js` for effect-state queries instead of scanning actor effects ad hoc.
