import { GroupSheetV2 } from "../../ui/sheets/v2/group-sheet.js";
import { SimpleItemSheetV2 } from "../../ui/sheets/v2/item-sheet.js";
import { PCActorSheetV2 } from "../../ui/sheets/v2/actor-sheet.js";
import { NpcSheetV2 } from "../../ui/sheets/v2/npc-sheet.js";

export async function registerSheets() {
  // Unregister Foundry's built-in core sheets so they don't appear in the sheet picker.
  foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
  foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);

  foundry.documents.collections.Actors.registerSheet("uesrpg-3ev4", PCActorSheetV2, {
    types: ["Player Character"],
    makeDefault: true,
    label: "UESRPG Character Sheet",
  });

  foundry.documents.collections.Actors.registerSheet("uesrpg-3ev4", GroupSheetV2, {
    types: ["Group"],
    makeDefault: true,
    label: "UESRPG Group Sheet",
  });

  foundry.documents.collections.Items.registerSheet("uesrpg-3ev4", SimpleItemSheetV2, {
    makeDefault: true,
    label: "UESRPG Item Sheet",
  });

  foundry.documents.collections.Actors.registerSheet("uesrpg-3ev4", NpcSheetV2, {
    types: ["NPC"],
    makeDefault: true,
    label: "UESRPG NPC Sheet",
  });
}
