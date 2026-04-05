import { openArmyCampaignApp } from "../../../ui/apps/v2/army-campaign-app.js";

let _registered = false;

export function registerWarfareCampaignHooks() {
  if (_registered) return;
  _registered = true;

  Hooks.once("ready", () => {
    game.uesrpg = game.uesrpg ?? {};
    game.uesrpg.massWarfare = game.uesrpg.massWarfare ?? {};
    game.uesrpg.massWarfare.openArmyCampaignApp = openArmyCampaignApp;
  });
}
