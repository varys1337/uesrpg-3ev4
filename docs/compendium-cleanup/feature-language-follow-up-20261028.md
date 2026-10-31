# Feature, spell and language follow-up

This checkpoint contains runtime and interface changes only. The Core Item
authoring sources and compiled packs have not been changed. The pre-change
checkpoint is `release/checkpoints/20261028-features-language-before/manifest.json`;
it identifies the matching earlier compiled-pack snapshot. Existing world and
actor Items were not rewritten.

## Implemented in this checkpoint

- A feature configured as disabled is blocked before activation costs or uses
  are spent. Its passive contributions are excluded from the system's derived
  feature and magic lookups and its transferred effects use Foundry's v14
  `isSuppressed` accessor. This affects derived results of existing Items.
- A GM-only confirmation cannot be bypassed by activating from a player client.
  The current workflow cannot collect both a GM and an owner confirmation, so
  that routing is blocked with an explanation. `Never` remains an explicit
  choice to suppress a prompt.
- Timed feature transfers use the finite duration on each source Active Effect
  when no legacy activation duration is present. Missing durations block the
  activation before uses or costs are spent instead of creating a permanent
  effect. Expiry-event-only durations require further design and verification.
- Short rests restore configured short-rest feature uses. Long rests restore
  both short- and long-rest uses. Legacy counters are handled on their existing
  paths, and a failed per-Item write makes the rest report partial completion.
  Day and encounter resets are manual; the feature sheet says so. An enabled
  use counter with no configured uses blocks activation instead of silently
  granting an unlimited use. Resource availability is checked before a use is
  consumed and checked again when the cost is written.
- Feature sheets expose Free, Secondary and Special action categories and show
  the authoritative legacy or current use counter. Existing unknown values are
  retained in the selectors.
- Activation cards explicitly identify outcomes that have no built-in handler as
  manual, including uses or costs already spent. Bend Reality, Flow of Magicka
  and Healer provide specific manual steps instead of creating an unused primed
  state; Control and Overcharge point to their existing triggering workflows.
- Language and faction save failures leave the dialog open. Language aliases are
  compared without rewriting saved names. The optional Polyglot provider reads
  spoken and written selections independently, uses Cyrodilic by default, and
  checks both configured and legacy-named Illiterate traits. Polyglot's own
  custom-language settings remain in use; actor-only custom languages may need
  the matching language added in Polyglot's settings.

The per-Item rest resets use the existing document authority helpers and rest
aftermath reporting. They are not a distributed transaction or a durable rest
receipt. If a rest is reported partial, inspect the listed Items and actor state
before taking any corrective action. Concurrent clients and interruptions are
not yet verified.

## Confirmed source and implementation gaps

The following pack changes remain pending in the current matching packs. A
separate completion staging copy has corrected authoring data, but it must be
rebuilt through the native isolated Foundry workflow before it can be used:

| Pack / ID | Finding |
| --- | --- |
| `powers-talents-traits.Ww7rr26aXuLzr8bV` War Cry | The description includes unrelated Chapter 3 skill text and the Primary Action lacks its 1 AP cost. Both are corrected in the staged authoring source; Panic tests and immunity remain manual. |
| `powers-talents-traits.6fMqxbAYgrajQFCL` Dragonskin | The source describes a Free Action; `system.activation.actionType` is `passive`. |
| `powers-talents-traits.DHdkDCCguwiTDVLW` Eye of Fear | The source describes a Free Action; the configured action type is `passive`. Its target Panic outcome also remains manual. |
| `powers-talents-traits.FrMBvu2WVLEvHhF0` Malacath's Fury | The source describes a Free Action; the configured action type is `passive`. |
| `powers-talents-traits.HVKf22nMGAtacGLe` Inspire Heroism | The source describes a Free Action; the configured action type is `passive`. A separate page quotation is also included in the description. |
| `powers-talents-traits.mxoaAwBJcysTRfAE` Ancestor's Protection | The source describes a Free Action; the configured action type is `passive`. Its Sanctuary spell procedure needs source-backed automation. |
| `powers-talents-traits.rYvFH2FV4UUPshZD` Controlled Anger | The once-per-short-rest Frenzied removal is a Free Action; the configured action type is `passive`. |
| `powers-talents-traits.sbcOPLJMM61v3a0E` Histskin | The once-per-short-rest healing is a Free Action; the configured action type is `passive`. |
| `powers-talents-traits.BfWJnlMiKly0UAf7`, `GEcPz5K1B9qjnBFf`, `JXmmoHj9R7Q0kA5C`, `NxnRdAULVCkG2rwU`, `O00VOKv5Kuyb5ZKj`, `rJefaGZFsTrCJuX3` Weakness variants | The descriptions include unrelated Chapter 5 text after the source trait rules. |
| `powers-talents-traits.xrpzc0xhIVs8ohVJ` Highborn | Cast Magic is a 1 AP Primary Action; the current Item does not configure that cost. |
| `powers-talents-traits.Iw7kDoxEeQaFB6o6` Blending and `9nYtHje0hcLgKIGB` Meticulous Planning | Separate page quotations are included after the talent descriptions. |

Additional confirmed manual mechanics include ordinary Adrenaline Rush's
encounter-limited Stamina branch,
Highborn when its Item lacks the staged cost configuration, and the Weapon Echo
placement, attack, movement and timing rules. Adrenaline Burst queues healing
and, for an actor in the active combat, wound-penalty suppression. Its 2 SP and
their encounter expiry remain manual because temporary SP are not attributed
to individual sources. Outside a tracked combat wound suppression is also
manual. The old handler applied 2 SP as a persistent value modifier; spending
could reapply that modifier. Review effects created before this correction and
remove the old Adrenaline Rush effect when its encounter ends. The revised
handler has not been exercised in Foundry. The remaining summon, spell and ritual workflows require further
source-to-execution review. A generic activation card does not itself resolve
the ability described on that card.

When Highborn has the staged 1 AP and daily-use configuration, its activation
now queues a 20 Magicka recovery outcome and blocks a combat use outside the
actor's turn. That path has not been exercised in Foundry. Daily reset remains
manual; the current compiled Item retains its previous configuration.

When ordinary Adrenaline Rush is activated while fatigued, the current workspace
now queues one Fatigue reduction through the existing outcome receipt and
restoration service. If Fatigue is gone before application, it stops for review
instead of restoring permanent Stamina. This runtime batch is not live verified
and postdates the pinned staging revision used for the pack rebuild.

Inspire Heroism now records the combat ID with its round, so a later combat
that starts at the same round does not inherit the previous limit. A legacy
round record without a combat ID is blocked for GM review when it matches the
current round. The execution rechecks the combat and usage after the Command
dialog; concurrent clients still require live verification. Its existing
one-round effect expiry is not established by the source, which specifies the
next combat test. Do not treat the effect lifetime as reconciled until all
consumption paths have been reviewed.

Selected source-to-workflow traces are in `clause-traces.json` and the per-ID
ledger. They do not constitute a complete review of all 340 features or 169
spells. The 55 entries lacking a verified exact Core counterpart remain
preserved for review. Other previously identified discrepancies and manual
clauses remain open until individually resolved.

## Verification still required

No isolated Foundry session was exercised for this checkpoint. The earlier
Foundry observations in `verification.json` predate these changes. Verify:

1. Feature enable/disable and removal, native transferred Active Effects,
   finite timed effects and expiry, missing-duration preflight, passive stacking,
   combat transitions, action costs, all confirmation modes, cancellation,
   missing targets and failed permissions.
2. Both counter formats and both rest types, already-full counters, multiple
   features, partial writes, interruption and simultaneous clients. Check daily
   and encounter uses are identified as manual.
3. Manual activation reporting, both spell casting paths, the recorded
   Bladecaller and Spell Sword clauses, remaining summon and ritual scenarios,
   and no duplicate outcomes when actions are repeated.
4. Ta’Agra and Reach-tongue save/reopen; aliases, an enabled and disabled
   Illiterate trait, and separate spoken/readable languages with Polyglot
   installed, including module custom languages and existing font settings.
5. Sheet/dialog behavior and Foundry v14 deprecation logs.

Run the static validation commands in `reconciliation-workflow.md`. Do not infer
successful live behavior from those checks, and do not run automated tests for
this task. Preserve the prior pack set until a native rebuild, parity comparison,
clean shutdown and exclusive-access checks have all succeeded.
