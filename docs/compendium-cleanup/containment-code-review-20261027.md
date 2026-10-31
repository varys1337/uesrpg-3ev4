# Containment and ENC code checkpoint

This checkpoint changes runtime code only. Previous Foundry observations in `verification.json` predate these changes and do not verify them.

- Actor ENC and inventory visibility now use the same acyclic, existing-container chain check. Broken or cyclic links give no containment reduction, remain visible in the main inventory, and are identified in the ENC breakdown. Existing Item pointers are not automatically rewritten.
- Container capacity treats an unset quantity limit as unlimited and does not count uncontained inventory as contents of a container without an identity. Nonphysical entries are not counted as physical contents. The existing five-container nesting limit is checked by the shared Item operation preflight as well as the UI.
- Batch picker changes are checked against the complete proposed inventory, including removals, additions, ancestors and nested contents. Bulk moves rebuild snapshots of previous containers as well as the destination. Changes to a weapon's attack mode or qualities also trigger capacity preflight because they can change its material-adjusted ENC.
- Container deletion releases direct children and preserves their own nested contents. Deletion stops if unlinking is not confirmed. A deletion failure after unlinking is reported as a partial operation.
- Container copies made through the actor, NPC, group and container-drop interfaces derive contents from live Item pointers. External copies are projected with distinct temporary identities and checked for capacity, nesting and cycles before creation. Compatibility snapshots truncate recursive cycles; they are not treated as the authority for current actor contents.

Manual Foundry verification remains open for invalid and cyclic legacy links, capacity boundaries and simultaneous moves, full-container swaps, nested removal and copying, zero-ENC contents, material changes, and failed or interrupted document writes. The existing Item preflight is not a distributed transaction: simultaneous clients can still require review, and a copied container may remain in inventory if a later placement or child creation fails. Do not assume static checks establish cross-client behavior.

Pre-change runtime files are retained under `release/backups/containment-enc-20261027`; use an existing matched code-and-pack checkpoint for a full rollback. No automated tests were created or run.
