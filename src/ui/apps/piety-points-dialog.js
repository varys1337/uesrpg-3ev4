import { t } from "../../utils/i18n.js";

export class PietyPointsDialog {
  static async show(actor) {
    if (!actor?.system) {
      ui.notifications.error(t("UESRPG.Dialogs.PietyPoints.InvalidActor"));
      return false;
    }
    const { WorshipManagerAppV2 } = await import("./v2/worship-manager.js");
    const app = await WorshipManagerAppV2.prompt(actor);
    return Boolean(app);
  }
}
