# Mass Warfare

Current supported runtime scope for Warfare Unit actors under the v2 rules pass.

## Supported

- profile-driven Warfare Unit derived data via `uesrpg-0_2`
- AppV2 Warfare Unit sheet with `Core`, `Actions`, `Implements`, and `Loadout`
- clash pending cards, clash resolution, ranged attacks, implement casting, and mixed warfare-humanoid opposed flows
- commander assignment, attach/detach, and commander token follow support
- actor-driven battle state tracking for `Hidden`, `Ambush Ready`, `Broken`, `Suppressed`, `Defeated`, `Frenzied`, and `Flyer`

## Compatibility Only

- `system.stats.condition.*` remains a mirror of Resolve for old worlds
- legacy warfare data lanes may still exist on actors, but the live sheet prefers the v2 fields
- encounter, campaign, siege, and battlefield helper modules may still exist in the repo, but they are not the supported rules surface for current Warfare Unit play

## Manual By Design

- token movement, facing, and contact-side positioning
- campaign geography, route tracking, and siege progression
- terrain adjudication beyond explicit actor/chat inputs
