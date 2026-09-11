# templates/v2/

This directory contains Handlebars templates for the ApplicationV2 migration.

Templates here are organized by surface type:
- `apps/` — Settings UIs and other ApplicationV2 apps
- `dialogs/` — DialogV2 content templates  
- `sheets/` — ActorSheetV2 / ItemSheetV2 templates
- `partials/` — Shared template partials for AppV2 surfaces

These templates use AppV2-native conventions (no jQuery dependency in template
structure, native form bindings, `data-action` attributes for event delegation).
