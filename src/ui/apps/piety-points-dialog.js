export class PietyPointsDialog {
  static async show(actor) {
    if (!actor?.system) {
      ui.notifications.error("Invalid actor for PP management");
      return false;
    }
    const { WorshipManagerAppV2 } = await import("./v2/worship-manager.js");
    const app = await WorshipManagerAppV2.prompt(actor);
    return Boolean(app);
  }
}
