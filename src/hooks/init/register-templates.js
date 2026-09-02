/**
 * Preload Handlebars partials used by system sheets.
 *
 * Foundry requires partial templates to be loaded before they can be referenced via {{> }}.
 */
export async function preloadHandlebarsTemplates() {
  const templatePaths = [
    "systems/uesrpg-3ev4/templates/partials/sheets/fixed-header.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/combat-reactions.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/equipment-group-name-header.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/feature-inspector.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/effects-tab.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/item-spellcasting-config.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/feature-config-tab.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/automation-tab.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/feature-stat-sections.hbs",
    "systems/uesrpg-3ev4/templates/partials/sheets/feature-activation.hbs",
    // Enchanting Workshop (macro-launched AppV2)
    "systems/uesrpg-3ev4/templates/v2/apps/enchanting-workshop.hbs",
    // Alchemy Workshop (macro-launched AppV2)
    "systems/uesrpg-3ev4/templates/v2/apps/alchemy-workshop.hbs",
  ];

  try {
    // Foundry v14: use the namespaced template loader.
    // Avoid touching the deprecated global loadTemplates to keep the console clean.
    const loader = foundry?.applications?.handlebars?.loadTemplates;
    if (typeof loader !== "function") {
      throw new Error("foundry.applications.handlebars.loadTemplates is not available");
    }
    await loader(templatePaths);
  } catch (err) {
    console.error("UESRPG | Failed to preload Handlebars templates", err);
  }
}
