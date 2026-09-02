import { SYSTEM_ID } from "../../core/system/namespace.js";
import { createLogger } from "../../utils/debug.js";
import { t } from "../../utils/i18n.js";
import { PCActorSheetV2 } from "../../ui/sheets/v2/actor-sheet.js";
import { GroupSheetV2 } from "../../ui/sheets/v2/group-sheet.js";
import { NpcSheetV2 } from "../../ui/sheets/v2/npc-sheet.js";
import { WarfareUnitSheetV2 } from "../../ui/sheets/v2/warfare-unit-sheet.js";
import { SimpleItemSheetV2 } from "../../ui/sheets/v2/item-sheet.js";

let sheetsRegistered = false;
const SHEET_REGISTRATION_LOG = createLogger(`${SYSTEM_ID} | AppV2 sheet registration |`, {
  debugEnabled: isAppV2DebugEnabled,
});

function isAppV2DebugEnabled() {
  try {
    if (game?.settings?.settings?.has?.(`${SYSTEM_ID}.debugClientEnabled`) !== true) return false;
    return game.settings.get(SYSTEM_ID, "debugClientEnabled") === true;
  } catch (_err) {
    return false;
  }
}

function debugSheetRegistration(message, data = undefined) {
  if (data === undefined) SHEET_REGISTRATION_LOG.debug(message);
  else SHEET_REGISTRATION_LOG.debug(message, data);
}

function getSheetLabel(key, fallback) {
  return t(`UESRPG.Sheets.SheetLabels.${key}`, fallback);
}

function buildActorSheetEntries() {
  debugSheetRegistration("Actor sheets registered through AppV2 production path. Legacy sheet rollback setting is hidden and ignored.");

  return [
    {
      sheetClass: PCActorSheetV2,
      options: {
        types: ["Player Character"],
        makeDefault: true,
        label: getSheetLabel("Character", "UESRPG Character Sheet"),
      },
    },
    {
      sheetClass: GroupSheetV2,
      options: {
        types: ["Group"],
        makeDefault: true,
        label: getSheetLabel("Group", "UESRPG Group Sheet"),
      },
    },
    {
      sheetClass: NpcSheetV2,
      options: {
        types: ["NPC"],
        makeDefault: true,
        label: getSheetLabel("NPC", "UESRPG NPC Sheet"),
      },
    },
    {
      sheetClass: WarfareUnitSheetV2,
      options: {
        types: ["Warfare Unit"],
        makeDefault: true,
        label: getSheetLabel("WarfareUnit", "UESRPG Warfare Unit Sheet"),
      },
    },
  ];
}

function buildItemSheetEntries() {
  debugSheetRegistration("Item sheets registered through AppV2 production path. Legacy sheet rollback setting is hidden and ignored.");

  return [
    {
      sheetClass: SimpleItemSheetV2,
      options: {
        makeDefault: true,
        label: getSheetLabel("Item", "UESRPG Item Sheet"),
      },
    },
  ];
}

function registerDocumentSheets(documentClass, documentName, entries) {
  const sheets = foundry?.applications?.apps?.DocumentSheetConfig;
  if (typeof sheets?.registerSheet !== "function") {
    throw new Error(`${SYSTEM_ID} | DocumentSheetConfig.registerSheet is unavailable for ${documentName}.`);
  }
  if (typeof documentClass !== "function") {
    throw new Error(`${SYSTEM_ID} | ${documentName} document class is unavailable.`);
  }

  for (const entry of entries) {
    const sheetClass = entry?.sheetClass;
    if (typeof sheetClass !== "function") {
      SHEET_REGISTRATION_LOG.warn(`Skipping ${documentName} sheet registration because the sheet class is unavailable.`, entry);
      continue;
    }

    sheets.registerSheet(documentClass, SYSTEM_ID, sheetClass, entry.options);
    debugSheetRegistration(`Registered ${documentName} sheet.`, {
      className: sheetClass.name,
      types: entry.options?.types ?? null,
      makeDefault: entry.options?.makeDefault === true,
    });
  }
}

export function registerSheets() {
  if (sheetsRegistered) {
    debugSheetRegistration("Skipped duplicate sheet registration call.");
    return;
  }

  const actorEntries = buildActorSheetEntries();
  const itemEntries = buildItemSheetEntries();

  try {
    registerDocumentSheets(foundry?.documents?.Actor, "Actor", actorEntries);
    registerDocumentSheets(foundry?.documents?.Item, "Item", itemEntries);
    sheetsRegistered = true;
  } catch (err) {
    sheetsRegistered = false;
    throw err;
  }
}
