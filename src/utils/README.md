# `src/utils`

Canonical low-level utilities live here.

- Keep shared seams such as `uuid-cache.js`, `clone.js`, `coerce.js`, `chat-roll-mode.js`, and `compat.js` small and stable.
- Keep compatibility wrappers such as `degree-roll-helper.js`, `drop-data.js`, and `drop-item-create-data.js` as wrappers when they preserve existing import surfaces.
- Put broad multi-user mutation behavior behind `authority-proxy.js`; keep embedded-document helpers and payload sanitization in its internal helpers instead of duplicating them elsewhere.
- Put shared DialogV2 behavior behind `dialog-v2-helper.js`; keep keyboard/window enhancements in its internal helpers, not in callers.
- Put perf/debug tooling behind explicit gates. Do not add new global runtime lanes unless an existing registrar already owns them.
- Before adding a new utility, search for an existing canonical owner first.
