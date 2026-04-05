import { isMassCombatEnabled } from "../../homebrew/settings.js";
import { openWarfareEncounterApp, syncWarfareEncounterForChatMessage } from "./controller.js";

const CONTROL_TOOL_NAME = "uesrpg-warfare-encounter";

let _registered = false;

function _registerRuntimeApi() {
  game.uesrpg = game.uesrpg ?? {};
  game.uesrpg.massWarfare = game.uesrpg.massWarfare ?? {};
  game.uesrpg.massWarfare.openEncounterApp = openWarfareEncounterApp;
}

export function registerWarfareEncounterHooks() {
  if (_registered) return;
  _registered = true;

  _registerRuntimeApi();

  Hooks.on("getSceneControlButtons", (controls) => {
    const tokenControl = controls?.tokens ?? controls?.token;
    if (!tokenControl?.tools) return;

    const existing = tokenControl.tools[CONTROL_TOOL_NAME];
    const nextOrder = (() => {
      const orders = Object.values(tokenControl.tools)
        .map((tool) => Number(tool?.order))
        .filter(Number.isFinite);
      return orders.length ? Math.max(...orders) + 1 : Object.keys(tokenControl.tools).length;
    })();

    tokenControl.tools[CONTROL_TOOL_NAME] = {
      name: CONTROL_TOOL_NAME,
      title: "Warfare Encounter",
      icon: "fas fa-chess-rook",
      button: true,
      visible: Boolean(game.user?.isGM && isMassCombatEnabled()),
      order: Number.isFinite(existing?.order) ? existing.order : nextOrder,
      onClick: async () => {
        await openWarfareEncounterApp(game?.scenes?.current ?? null);
      },
    };
  });

  Hooks.on("updateChatMessage", (message) => {
    void syncWarfareEncounterForChatMessage(message);
  });
}
