import { systemRootPath } from "../core/constants.js";
import { renderDialogContent, alertDialog } from "../utils/dialog-v2-helper.js";

/**
 * Startup dialog (Foundry VTT v13.351, DialogV2).
 *
 * Goals:
 * - Use DialogV2 via the system's dialog-v2-helper.
 * - Do NOT set fixed height (let content determine height).
 * - Keep the existing Handlebars templates and context fields.
 */
export default async function startupHandler() {
  // The system setting is inverted: if it's false, show the dialog.
  if (game.settings.get("uesrpg-3ev4", "noStartUpDialog") !== false) return;

  const changelogTemplatePath = `${systemRootPath}/templates/v2/startup/changelog.hbs`;
  const startupDialogTemplatePath = `${systemRootPath}/templates/v2/startup/startup-dialog.hbs`;

  let changelogHtml = "";
  try {
    changelogHtml = await renderDialogContent(changelogTemplatePath, {});
  } catch (error) {
    const msg = (error && error.message) ? error.message : String(error);
    console.warn(`UESRPG | Startup dialog: Failed to load changelog template: ${msg}`);
    changelogHtml = `<div class="changelog-error"><p>Changelog unavailable</p></div>`;
  }

  const startupDialogHtml = await renderDialogContent(startupDialogTemplatePath, {
    discordInviteUrl: "https://discord.gg/pBRJwy3Ec5",
    githubUrl: "https://github.com/jamesjtb/uesrpg-3ev4",
    contentModLink: "https://github.com/95Gman/UESRPG-revised",
    changelogHtml
  });

  await alertDialog({
    title: "Welcome to the UESRPG Foundry System!",
    content: startupDialogHtml,
    buttonLabel: "Close",
    buttonIcon: "fas fa-times",
  });
}
