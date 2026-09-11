# `src/config`

This folder is the external-facing compatibility barrel layer.

- `src/config/index.js` is kept stable for external integrations.
- Canonical config ownership lives under `src/core/config/*`.
- Internal system code should prefer `src/core/config/*` imports to avoid barrel-driven coupling.
