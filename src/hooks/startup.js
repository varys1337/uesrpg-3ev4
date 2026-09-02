import { systemRootPath } from "../core/constants.js";
import { renderDialogContent, customDialog } from "../utils/dialog-v2-helper.js";
import { t } from "../utils/i18n.js";

/**
 * Startup dialog (Foundry VTT v14.359+, DialogV2 helper).
 *
 * Goals:
 * - Use DialogV2 via the system's dialog-v2-helper.
 * - Do NOT set fixed height (let content determine height).
 * - Keep the existing Handlebars templates and context fields.
 */
export default async function startupHandler() {
  // The system setting is inverted: if it's false, show the dialog.
  if (game.settings.get("uesrpg-3ev4", "noStartUpDialog") !== false) return;

  const startupDialogTemplatePath = `${systemRootPath}/templates/v2/startup/startup-dialog.hbs`;

  const startupDialogHtml = await renderDialogContent(startupDialogTemplatePath, {
    discordInviteUrl: "https://discord.gg/pBRJwy3Ec5",
    githubUrl: "https://github.com/jamesjtb/uesrpg-3ev4",
    contentModLink: "https://github.com/95Gman/UESRPG-revised",
  });

  await customDialog({
    layout: "document",
    title: t("UESRPG.Dialogs.Startup.Title"),
    content: startupDialogHtml,
    classes: ["uesrpg-dialog", "uesrpg-startup-dialog"],
    width: 860,
    buttons: {
      close: {
        label: t("UESRPG.UI.Close", "Close"),
        icon: "fas fa-times",
      },
    },
    defaultButton: "close",
  });
}
