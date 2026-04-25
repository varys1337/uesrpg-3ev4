import { GroupSheetV2 } from "../../ui/sheets/v2/group-sheet.js";
import { SimpleItemSheetV2 } from "../../ui/sheets/v2/item-sheet.js";
import { PCActorSheetV2 } from "../../ui/sheets/v2/actor-sheet.js";
import { NpcSheetV2 } from "../../ui/sheets/v2/npc-sheet.js";
import { WarfareUnitSheetV2 } from "../../ui/sheets/v2/warfare-unit-sheet.js";
import { t } from "../../utils/i18n.js";

export async function registerSheets() {
  foundry.documents.collections.Actors.registerSheet("uesrpg-3ev4", PCActorSheetV2, {
    types: ["Player Character"],
    makeDefault: true,
    label: t("UESRPG.Sheets.SheetLabels.Character", "UESRPG Character Sheet"),
  });

  foundry.documents.collections.Actors.registerSheet("uesrpg-3ev4", GroupSheetV2, {
    types: ["Group"],
    makeDefault: true,
    label: t("UESRPG.Sheets.SheetLabels.Group", "UESRPG Group Sheet"),
  });

  foundry.documents.collections.Items.registerSheet("uesrpg-3ev4", SimpleItemSheetV2, {
    makeDefault: true,
    label: t("UESRPG.Sheets.SheetLabels.Item", "UESRPG Item Sheet"),
  });

  foundry.documents.collections.Actors.registerSheet("uesrpg-3ev4", NpcSheetV2, {
    types: ["NPC"],
    makeDefault: true,
    label: t("UESRPG.Sheets.SheetLabels.NPC", "UESRPG NPC Sheet"),
  });

  // Warfare Unit sheet — always registered so existing actors remain openable
  // even when mass combat is toggled off. Creation gating is separate.
  foundry.documents.collections.Actors.registerSheet("uesrpg-3ev4", WarfareUnitSheetV2, {
    types: ["Warfare Unit"],
    makeDefault: true,
    label: t("UESRPG.Sheets.SheetLabels.WarfareUnit", "UESRPG Warfare Unit Sheet"),
  });
}
