# Magic

Canonical ownership in this folder:

- `index.js` is the stable public barrel for callers outside `src/core/magic`.
- Workflow facades own orchestration only. Local `opposed/`, `effects/`, `ticks/`, `services/`, and conjuration modules own staged implementation details.
- Pure spell/config/profile/range helpers should stay mutation-free.
- Document writes, chat posting, and hook registration belong at explicit runtime edges.

Implementation rules:

- Reuse the shared UUID cache helpers instead of calling `fromUuidSync()` directly in hot paths.
- Reuse `settings.js`, `opposed/cast-source.js`, and `opposed/subrolls.js` for repeated settings, cast-source, and sub-roll behavior.
- Keep Foundry v13.351 behavior stable. Do not repurpose spell flags, chat payloads, or effect schema here without a dedicated migration.
