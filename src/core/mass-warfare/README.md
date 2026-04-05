# Mass Warfare

Current runtime scope for the Warfare Unit subsystem.

## Automated Now

- profile-driven Warfare Unit derived data via `uesrpg-0_2`
- AppV2 Warfare Unit sheet with `Core`, `Actions`, `Magic`, and `Items`
- clash pending cards, stance commit, auto-roll, and clash resolution
- battlefield geometry helpers for charge-path validation, terrain sampling, and clash grouping support
- commander assignment and commander token attachment/follow state
- warfare sheet actions for rally, ambush, scout, join-fray, ranged attack, spell effects, and related one-round effects
- scene-backed encounter tracker with charge, strategic, and clash phase rotation
- Group-backed army campaign state and AppV2 army campaign utility surface
- scene-backed siege state plus Region-backed fortification and deployable feature flags

## Still Manual

- exact token movement and charge placement on the scene
- campaign geography, route graphs, and structured regional movement
- many campaign and siege outcomes still rely on GM judgement and note-backed resolution
- non-warfare generic Active Effect expiration policy

## Encounter Ownership

The encounter controller owns:

- round/phase rotation
- alternating strategic side sequencing
- scene-backed retreat-edge state
- cleanup of warfare-owned one-round bonuses and effects

Warfare actors remain authoritative for charges, strategic actions, commander actions, deployable placement decisions, and clash initiation. Facing and contact sides are table-tracked manually where needed, and the existing clash chat workflow remains authoritative for each clash result.

## Campaign and Siege Ownership

The army layer owns:

- `Group.flags.uesrpg-3ev4.massWarfareArmy`
- campaign turn, army action tracking, supply reserve/capacity, and siege scene linkage
- manual campaign utilities such as March, Scout, Forage/Requisition, Raid, Reinforce/Muster, Besiege, and Special Operation

The siege layer owns:

- `Scene.flags.uesrpg-3ev4.warfareSiege`
- `Region.flags.uesrpg-3ev4.warfareFeature`
- fortification HP, blockade/sap/repair progress, and Region-backed deployable/fortification metadata

The encounter app remains phase-only. It does not regain charge dialogs, strategic activation buttons, or clash queues.
