# Changelog

## v14.2.0

### Item data, migrations, and Soul Energy

- Persists Soul Energy configuration changes made from Item and Equipment sheets through the serialized ApplicationV2 form pipeline, canonicalizes `isSoulGem` as Boolean, and recovers configurations whose flag was previously stored as a true-like string or number.
- Resolves every Actor and Item template inheritance declaration into one canonical TypeDataModel seed set and removes the duplicate legacy Item-default source.
- Adds an active-GM, revision-gated cleanup migration for accidentally persisted `system.templates` directives while preserving document IDs and all other system data.
- Replaces private Roll total mutation with public maximized evaluation, formula modifiers, and zero-floor rolls without changing the `rollSpellDamage()` contract.
- Consolidates Actor, embedded Item, and Active Effect cache invalidation and replaces per-render inventory fingerprint scans with document-driven revision tokens.
- Centralizes migration revisions, adds deterministic schema and migration validation, and hardens CI and tag releases against mutable published assets.
- Repairs v14 Item subtype migrations by pairing each `type` change with a forced full `system` replacement while preserving the original world or embedded Item ID.
- Normalizes nullable Item defaults without recursing into `null`, including existing and legacy shield data.
- Advances legacy Item repair to revision 2, verifies every subtype conversion, and leaves failed passes pending instead of reporting a false migration success.
- Canonicalizes every scanned Active Effect through public v14 source snapshots using only `duration.value`, `duration.units`, `duration.expiry`, and native `start` data.
- Advances the Active Effect duration migration to revision 2, removes legacy duration/change compatibility reads, and preserves active-GM gating, retry behavior, and migration telemetry.
- Adds a release safeguard against deprecated Active Effect duration-property reads and verifies compatibility with Foundry VTT 14.368.
- Normalizes system-created Active Effect durations to Foundry v14 fields and adds an idempotent, version-gated world migration for legacy duration anchors.
- Removes runtime dependencies on private Foundry document storage, expands typed resource and structured Item schemas, and refreshes selected sheet controls with semantic accessible buttons.

### ApplicationV2 sheets and accessibility

- Restores the 14.1.1 PC/NPC portrait, Advancement, and characteristic presentation by preventing neutral semantic controls from inheriting the sidebar's legacy gray button chrome while retaining keyboard and screen-reader behavior.
- Preserves the original compact two-column Attack Options and horizontal Spell Options form geometry at scaled DPI by removing the over-eager application-width dialog collapse.
- Prevents Item-sheet close and action flushes from submitting presentation-only fields such as an empty portrait path, eliminating the reported `img` schema validation failure while retaining explicit portrait updates.
- Strengthens release validation so each broad sidebar button selector must exclude neutral controls and Item submit-on-close data must pass through a document-field allow-list.
- Restores the stable 14.1.1 Actor, NPC, and Item sheet geometry, row density, tab proportions, portrait sizes, compact action lanes, and parchment styling while retaining native ApplicationV2 controls and accessibility behavior.
- Separates the shared semantic-control marker from a fully neutral plain-control role so legacy-replacement buttons no longer inherit Foundry input chrome, stretch across rows, overlap portraits, or erase deliberately styled component rules.
- Preserves the scaling-safe resource sidebar, moves Item and Spell compact layouts below their standard sheet width, and adds release contracts for control roles, portrait sizes, compact rails, and broad-selector isolation.
- Repairs malformed PC and NPC Magic-tab markup that caused ApplicationV2 to reject the `magic` render part when opening character sheets.
- Corrects related tag-nesting defects in generic Item, equipment-header, and Invocation templates before they could cause equivalent render failures.
- Makes well-formed HTML nesting and the single-root ApplicationV2 part contract mandatory release-validation checks.
- Converts AppV2 actions and tabs to native controls with localized accessible names, visible keyboard focus, native disabled and toggle semantics, and instance-safe application and control identities.
- Adds one deterministic AppV2 edit queue across Actor, NPC, Group, Warfare Unit, and Item sheets so pending field changes flush before structural actions and close without stale or out-of-order document updates.
- Moves document hook registration into first-render lifecycle handling, guarantees matching cleanup, and preserves focus, scroll positions, active tabs, and disclosure state across targeted renders.
- Adds application-owned container-query layouts, bounded dense-table scrolling, high-contrast fallbacks, reduced-motion handling, and stable resizing from 100% through 200% scaling without changing the parchment theme or two-column Actor geometry.
- Localizes the remaining AppV2 interface text, escapes document-derived generated markup, and expands release validation for semantic controls, accessible names, fixed IDs, raw UI text, unsafe option interpolation, and form-lifecycle regressions.
- Restores the PC and NPC resource-control rail at 100–200% display scaling with fully reset 16×16 semantic buttons, bounded sidebar sections, and visible keyboard focus without changing the two-column sheet geometry.

### Automation and release safety

- Replaces generic cross-client document mutation sockets with requester-bound, idempotent authority intents and fail-closed native permission handling.
- Makes combat automation active-GM single-writer and moves action-point and initiative side effects to post-commit hooks with bounded deduplication.
- Adds Node 24 ESLint checks, dynamic import reachability validation, modern runtime safety contracts, Markdown validation, CI pull-request checks, and SHA-256 deployment verification.

## v14.1.1

- Repairs PC, NPC, Group, and Warfare Unit sheet part selection so normal and limited layouts are mutually exclusive while valid partial renders remain targeted.
- Filters Warfare Unit from Foundry's Actor creation dialog while Warfare is disabled, preventing cancelled creation from reaching the missing document sheet path; direct programmatic creation remains defensively blocked.
- Completes the Warfare feature boundary across unit actions, clashes, mixed combat, campaigns, encounters, battlefield automation, chat interactions, and commander attachment while preserving existing Warfare data for editing and recovery.
- Refreshes Warfare controls and sheets immediately when Enable Warfare changes, closes open Warfare applications on disable, and restores interfaces without a world reload.

## v14.1.0

- Completes partial-render and limited-view handling for PC and Warfare Unit sheets so restricted viewers do not receive private sheet parts and targeted renders avoid unrelated preparation.
- Coalesces Warfare Encounter and Army Campaign refreshes, scopes their hooks to open applications, removes duplicate chat-triggered encounter renders, and refreshes campaigns for linked member and Item changes.
- Loads the memory monitor only for enabled diagnostics, resolves Army Campaign context concurrently, and caches linked Warfare Unit commanders with targeted invalidation.
- Expands the migration settings view to every registered revision and localizes migration notices, missing-document states, and remaining Warfare Unit controls.
- Completes English-source encoding and template image-alternative audits, corrects the startup repository link, and removes a stale unused startup changelog template.
- Removes verified unreachable compatibility modules and inert AppV2 rollout settings without changing document schemas or production APIs.
- Establishes the shipped CSS file as the canonical stylesheet, removes its dangling source-map/Sass build claims, and strengthens release validation for imports, partials, localization, accessibility, encoding, and legacy UI patterns.

## v14.0.9

- Converts all Item types to genuine ApplicationV2 header, tabs, and body render parts, eliminating whole-template DOM splitting and skipping body preparation for header- or tab-only renders.
- Splits the Travel Planner into targeted render parts, prepares only its active phase, resolves ordered Group members concurrently with lifecycle-safe caching, and coalesces linked-document refreshes.
- Adds a shared, accessible, non-persistent search filter to PC/NPC equipment and magic lists, Group inventory, and the Faction selector without changing item ordering or document data.
- Restores bounded, state-preserving sheet scrolling to every Item type, removes the unhelpful Item-sheet Administrative Correction shortcut, and tightens dense spell, skill, and weapon layouts without changing their visual style.
- Localizes the touched Item and Travel Planner controls and chat labels, and improves portrait, tracker, and icon-control accessibility.

## v14.0.8

- Uses one complete item-preparation path at every inventory size, preserving profession, ammunition, trait, spell-school, NPC magic-rank, and worship data for actors with 100 or more owned Items.
- Makes Group sheets honor ApplicationV2 partial renders, coalesces linked-member refreshes, resolves members concurrently, and avoids unrelated context work while preserving the existing layout and theme.
- Uses Foundry v14's cached Handlebars renderer for template-backed dialogs instead of maintaining a parallel template cache.
- Removes unused memoization, canvas monitoring, and legacy optimization infrastructure while retaining direct live-canvas token resolution for combat workflows.
- Localizes remaining Worship and Warfare action labels and improves accessible text on Group sheet portraits and icon controls.

## v14.0.7

- Keeps Defense and No Defense as a compact equal-width row in narrow opposed-card lanes without changing either workflow action.
- Removes the redundant hard-coded TN disclosure arrow and relies on the native accessible details marker.
- Places earned Advantage as smaller secondary text inside Roll Damage and counter-damage buttons, reducing empty card height while preserving the same value and action payload.

## v14.0.6

- Normalizes UESRPG chat-card typography, spacing, result lanes, details, status badges, tables, and responsive action rows while preserving every workflow flag and action selector.
- Replaces the literal Unicode escape shown by resolved Advantage markers with an accessible check icon, associates markers with their participant lane, and deduplicates unmatched legacy markers into one neutral status row.
- Replaces the geometry-consuming chat border with a thinner pointer-transparent wood overlay that preserves the parchment appearance while recovering card width.
- Makes DialogV2 footer tracks shrink safely at high UI scales and refines Advancement option titles, values, wrapping, and bounded dimensions.
- Restores compact, bounded AppV2 layouts for every Enchanting and Alchemy workshop mode, including responsive fields, styled drop zones and summaries, body scrolling, and sticky action footers.
- Removes persistent pointer-focus frames from inventory collapse controls while retaining keyboard focus, and consolidates Reaction help onto one Foundry-managed tooltip with reversible teardown.

## v14.0.5

- Compacts the Character Generation Wizard into a responsive two-pane layout with a smaller stage rail, bounded scrolling, centered player guidance, and stable Back, Next, and Cancel controls.
- Replaces implementation-oriented character-generation wording with concise player-facing instructions while preserving costs, limits, permissions, saved progress, provenance, and audit behavior.
- Unifies race, birthsign, characteristics, resources, Combat Style, racial-grant, Spend XP, Spell Learning, and Advancement surfaces around shared character-generation form, summary, choice, status, and action components.
- Rebuilds the Advancement picker as a consistent responsive option grid and tightens its XP information/editor presentation without changing advancement rules.
- Corrects DialogV2 footer and single-choice sizing so action buttons, known special actions, and lone spell options remain compact and centered instead of stretching across unused space.

## v14.0.4

- Reattaches the PC, NPC, and Group bookmark rail to the outer sheet edge after the geometry-neutral frame change.
- Keeps Actor, Item, DialogV2, resource, and custom journal content fully contained during ApplicationV2 minimize and maximize transitions, with less aggressive compact-title truncation.
- Adds deterministic message, form, choices, workflow, table, and document layouts to the central DialogV2 helper, including responsive fields, compact choice cards, viewport-safe scrolling, accessible focus states, and button-count-aware footers.
- Tightens spell, attack, defense, damage, advancement, containment, resource, startup, and other system dialog surfaces without changing their submitted values or mechanics.
- Replaces duplicated PC/NPC reaction cards with one compact, tooltip-driven partial while preserving Attack of Opportunity and Grapple actions.
- Makes inventory group rows dedicated collapse controls and confines Item creation to a focusable plus button across PC, NPC, and Group sheets.

## v14.0.3

- Adds stable machine-readable racial grant definitions for every race or variant with a character-creation choice, including free and explicitly paid combinations.
- Reconciles racial grants idempotently against canonical embedded Items, never downgrades higher ranks, charges paid choices once, and records provenance under namespaced Actor flags.
- Opens completed characters in Actor-derived review mode, where owners can reconcile missing benefits and GMs can safely change tracked choices with conflict-aware rollback.
- Adds explicit, reasoned GM Administrative Correction actions to skill, magic-skill, Combat Style, and Spend XP advancement while preserving rank, prerequisite, domain, and Drakes validation.
- Audits post-completion race, birthsign, characteristic, Combat Style, advancement, and racial-choice corrections without deleting or downgrading untracked legacy Items.

## v14.0.2

- Preserves sanitized embedded ActiveEffects when Items are shared between Actors, including authority-proxied and container drops.
- Supports nonnegative decimal ENC values across Item schemas, forms, and encumbrance presentation.
- Registers critical document classes, TypeDataModels, settings, helpers, and ApplicationV2 sheets synchronously during `init`.
- Makes decorative application frames geometry-neutral and reliably restores persistent assistants before focusing them.
- Resolves direct multi-target spells as one cast transaction, preventing repeated AP and magicka payments and duplicate rapid submissions.
- Improves Bash NPC skill resolution and damage-card terminology without changing damage calculations.
- Applies category-derived NPC armor coverage with manual-edit provenance, an idempotent world migration, and an explicit repair action.
- Exposes typed PC/NPC HP and magicka resources to token tracked-attribute discovery and configures sensible defaults for new PC prototype tokens.

## v14.0.1

- Targets Foundry VTT v14.363+ and is verified against v14.367.
- Removes global Handlebars and ContextMenu prototype overrides.
- Preserves customized automation settings during profile-removal migration.
- Keeps Warfare Unit data models available while gating only new unit creation.
- Uses documented ApplicationV2 sheet and ChatLog configuration paths.
- Restores a single release validator for source and archive integrity checks.

## v14.0.0

- Targets Foundry VTT v14.359+.
- Adds v14 manifest compatibility metadata and release packaging validation.
- Restores release validation scripts for manifest/package checks and Active Effect integrity checks.
- Stages release builds through `npm run build:release`.
