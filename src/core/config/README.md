## Config

This folder owns canonical registries, label catalogs, and hot-path setting cache helpers.

Use direct imports from `src/core/config/*` inside core modules. Keep `src/config/index.js` as the external/UI barrel.

Rules:
- labels live in `label-catalog.js`
- special action registry lives in `special-actions.js`
- cached world-setting access lives in `settings-cache.js`
- do not move progression or business rules into this folder
