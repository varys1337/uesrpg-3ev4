# Changelog

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
