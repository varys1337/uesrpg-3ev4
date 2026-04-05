## Social

Canonical entrypoints:
- `social-data.js` owns normalized social-state derivation and display shaping.
- `social-choices.js` owns static choice catalogs.

Ownership:
- Keep raw catalog data separate from derived actor social state.
- Prefer local helpers here unless semantics are proven identical to an existing shared helper.

Rules:
- No document writes in this folder.
- Keep normalization and dedupe logic deterministic and side-effect free.
