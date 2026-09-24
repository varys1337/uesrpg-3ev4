# `src/utils` audit (2026-09-18)

## Result

All runtime utility modules are either reachable from `src/system.js` through a static or literal dynamic import, or intentionally exposed through one of the five documented public barrel entry points. Release validation now fails when a new unreachable runtime module is introduced.

The previous generic cross-client mutation transport has been removed. The current authority boundary is split between:

- `authority-intents.js`: requester-backed, active-GM, versioned command intents with expiring receipts and per-request locking.
- `authority-proxy.js`: native-permission direct writes plus the sealed chat-transition command. Arbitrary cross-owner document payloads are rejected.
- `chat-message-socket.js`: compatibility facade retained for existing imports; it no longer registers a raw socket listener.
- `authority-proxy/`: payload validation, embedded-document deletion, locking, and diagnostics shared by the direct and intent paths.

## Top-level organization

- Foundry integration: authority, permissions, settings, document resolution, UUID cache, chat roll mode, and compatibility helpers.
- UI support: DialogV2, tooltips/enrichment, canvas location selection, drag/drop, and delegated guards.
- Pure/runtime helpers: cloning, coercion, numeric expressions, degree calculations, user selection, and deferred loading.
- Diagnostics: debug, performance tracking, memory monitoring, and the `dev/` console-only tools.
- Focused submodules: `authority-proxy/`, `canvas/`, `chat/`, `degree/`, `dialog-v2/`, and `maps/`.

## Enforcement

`npm run validate` checks literal dynamic imports as well as static imports, permits only the explicit public-barrel allowlist, rejects raw system socket mutation listeners outside the sealed authority service, and rejects private Foundry document storage access. `npm run lint` provides the complementary JavaScript correctness pass.

No utility file was deleted in this tranche because every non-barrel module is reachable and the compatibility facades still have live importers.
