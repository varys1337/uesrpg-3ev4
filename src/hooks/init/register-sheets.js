import { SYSTEM_ID } from "../../core/system/namespace.js";
import { createLogger } from "../../utils/debug.js";
import { t } from "../../utils/i18n.js";

let sheetsRegistered = false;
const SHEET_REGISTRATION_LOG = createLogger(`${SYSTEM_ID} | AppV2 sheet registration |`, {
  debugEnabled: isAppV2DebugEnabled,
});

const SHEET_CLASS_SPECS = Object.freeze({
  PCActorSheetV2: Object.freeze({ path: "../../ui/sheets/v2/actor-sheet.js", exportName: "PCActorSheetV2" }),
  GroupSheetV2: Object.freeze({ path: "../../ui/sheets/v2/group-sheet.js", exportName: "GroupSheetV2" }),
  NpcSheetV2: Object.freeze({ path: "../../ui/sheets/v2/npc-sheet.js", exportName: "NpcSheetV2" }),
  WarfareUnitSheetV2: Object.freeze({ path: "../../ui/sheets/v2/warfare-unit-sheet.js", exportName: "WarfareUnitSheetV2" }),
  SimpleItemSheetV2: Object.freeze({ path: "../../ui/sheets/v2/item-sheet.js", exportName: "SimpleItemSheetV2" }),
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

async function loadSheetClass(spec) {
  try {
    const module = await import(spec.path);
    const sheetClass = module?.[spec.exportName];
    if (typeof sheetClass === "function") return sheetClass;

    SHEET_REGISTRATION_LOG.warn("Sheet class export is unavailable during registration.", {
      path: spec.path,
      exportName: spec.exportName,
    });
  } catch (err) {
    SHEET_REGISTRATION_LOG.warn("Failed to load sheet class during registration.", {
      path: spec.path,
      exportName: spec.exportName,
      err,
    });
  }

  return null;
}

async function loadSheetClasses() {
  const entries = await Promise.all(
    Object.entries(SHEET_CLASS_SPECS).map(async ([key, spec]) => [key, await loadSheetClass(spec)])
  );
  return Object.fromEntries(entries);
}

function assertRequiredSheetClasses(sheetClasses) {
  const required = ["PCActorSheetV2", "GroupSheetV2", "NpcSheetV2"];
  const missing = required.filter(key => typeof sheetClasses?.[key] !== "function");
  if (!missing.length) return;

  const message = `${SYSTEM_ID} | Required AppV2 actor sheet classes failed to load: ${missing.join(", ")}.`;
  SHEET_REGISTRATION_LOG.error(message, { missing });
  throw new Error(message);
}

function buildActorSheetEntries(sheetClasses) {
  debugSheetRegistration("Actor sheets registered through AppV2 production path. Legacy sheet rollback setting is hidden and ignored.");

  return [
    {
      sheetClass: sheetClasses.PCActorSheetV2,
      options: {
        types: ["Player Character"],
        makeDefault: true,
        label: getSheetLabel("Character", "UESRPG Character Sheet"),
      },
    },
    {
      sheetClass: sheetClasses.GroupSheetV2,
      options: {
        types: ["Group"],
        makeDefault: true,
        label: getSheetLabel("Group", "UESRPG Group Sheet"),
      },
    },
    {
      sheetClass: sheetClasses.NpcSheetV2,
      options: {
        types: ["NPC"],
        makeDefault: true,
        label: getSheetLabel("NPC", "UESRPG NPC Sheet"),
      },
    },
    {
      sheetClass: sheetClasses.WarfareUnitSheetV2,
      options: {
        types: ["Warfare Unit"],
        makeDefault: true,
        label: getSheetLabel("WarfareUnit", "UESRPG Warfare Unit Sheet"),
      },
    },
  ];
}

function buildItemSheetEntries(sheetClasses) {
  debugSheetRegistration("Item sheets registered through AppV2 production path. Legacy sheet rollback setting is hidden and ignored.");

  return [
    {
      sheetClass: sheetClasses.SimpleItemSheetV2,
      options: {
        makeDefault: true,
        label: getSheetLabel("Item", "UESRPG Item Sheet"),
      },
    },
  ];
}

function registerDocumentSheets(collection, documentName, entries) {
  if (typeof collection?.registerSheet !== "function") {
    throw new Error(`${SYSTEM_ID} | ${documentName} sheet collection does not expose registerSheet.`);
  }

  for (const entry of entries) {
    const sheetClass = entry?.sheetClass;
    if (typeof sheetClass !== "function") {
      SHEET_REGISTRATION_LOG.warn(`Skipping ${documentName} sheet registration because the sheet class is unavailable.`, entry);
      continue;
    }

    collection.registerSheet(SYSTEM_ID, sheetClass, entry.options);
    debugSheetRegistration(`Registered ${documentName} sheet.`, {
      className: sheetClass.name,
      types: entry.options?.types ?? null,
      makeDefault: entry.options?.makeDefault === true,
    });
  }
}

export async function registerSheets() {
  if (sheetsRegistered) {
    debugSheetRegistration("Skipped duplicate sheet registration call.");
    return;
  }

  const sheetClasses = await loadSheetClasses();
  assertRequiredSheetClasses(sheetClasses);
  const actorEntries = buildActorSheetEntries(sheetClasses);
  const itemEntries = buildItemSheetEntries(sheetClasses);

  try {
    registerDocumentSheets(foundry?.documents?.collections?.Actors, "Actor", actorEntries);
    registerDocumentSheets(foundry?.documents?.collections?.Items, "Item", itemEntries);
    sheetsRegistered = true;
  } catch (err) {
    sheetsRegistered = false;
    throw err;
  }
}
