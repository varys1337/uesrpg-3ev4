# Snare and Bash code checkpoint

This checkpoint changes runtime code only; it does not rebuild or change the five Core Item packs. The earlier selected Foundry observations in `verification.json` predate these changes and do not verify them.

- The Snare range prompt compares meter ranges with meter scenes or converts recognized feet units. Unknown scene units, an unavailable measurement, or a distance beyond the listed weapon range require an explicit GM decision; the Core Snare rule does not specify a maximum. The player-facing confirmation records the player's assertion that the GM allowed it, not a remote GM approval.
- A Snare card retains the weapon and a snapshot of both token positions, scene scale, measurement mode, and weapon range. Roll and outcome paths reject a changed or unavailable snapshot. Earlier unresolved Snare cards lack this evidence and must be started again; resolved cards and other Special Actions are not migrated.
- The snapshot is checked before and after interactive roll dialogs, at outcome application, and before the relevant action-cost, follow-up and condition stages. A change after a cost or another consequence has committed requires review; no automatic refund or replay is assumed.
- Conflicting flat and nested Special Action receipt stages are marked for review rather than silently choosing one representation. The existing outcome authority, document locks, receipt and reconciliation workflows continue to own application and recovery.
- Bash still requires manual one-meter knockback. The Acrobatics success and failure paths exist in code, but successful Acrobatics, attack-to-advantage behavior, action costs across all paths, permission failures, cross-client races, interrupted stages and duplicate attempts have not been manually verified after this checkpoint.

The pre-change runtime files are retained under `release/backups/snare-stale-range-20261027`. Use the existing matched compendium checkpoint for a full code-and-pack rollback. No automated tests were created or run.
