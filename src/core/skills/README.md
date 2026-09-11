## Skills

Canonical entrypoints:
- `skill-tn.js` owns deterministic TN calculation and breakdown shaping.
- `opposed-workflow/index.js` owns the public skill opposed facade.

Ownership:
- `opposed-workflow/core/*` owns shared workflow state, rendering, settings, and document resolution.
- `opposed-workflow/actions/*` owns attacker/defender action handling only.
- Mutation of chat-card state goes through `core/card-updater.js`.

Rules:
- Keep TN helpers pure.
- Keep per-action UUID resolution ephemeral.
- Do not add parallel card update or roll-mode helpers outside the existing `core/*` seams.
