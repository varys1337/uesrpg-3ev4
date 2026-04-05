# `src/api`

`src/api/index.js` is the public static-import barrel for downstream consumers.

- External modules and macros may import from this folder.
- Internal `src/core/*` code should import canonical source modules directly.
- Runtime `game.uesrpg.*` registration is centralized through `src/api/runtime-registration.js` and startup hooks, not through this barrel.
