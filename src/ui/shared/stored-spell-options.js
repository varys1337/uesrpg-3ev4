import { resolveDroppedItem } from "../../utils/drop-data.js";
import { isHiddenStoredEnchantmentSpell } from "../../core/enchanting/stored-spell-doc.js";


export function itemUuid(item) {
  return String(item?.uuid ?? "").trim();
}

function itemLevel(item) {
  const value = Number(item?.system?.level ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function itemCost(item) {
  const value = Number(item?.system?.cost ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

async function itemFromDropData(data) {
  const item = await resolveDroppedItem(data);
  return item?.documentName === "Item" ? item : null;
}

async function resolveDocumentUuid(uuid) {
  const raw = String(uuid ?? "").trim();
  if (!raw) return null;
  try {
    return await fromUuid(raw);
  } catch (_e) {
    return null;
  }
}

function resolveItemByUuid(uuid) {
  const raw = String(uuid ?? "").trim();
  if (!raw) return null;
  try {
    if (typeof fromUuidSync === "function") {
      const doc = fromUuidSync(raw);
      return doc?.documentName === "Item" ? doc : null;
    }
  } catch (_e) {
    // no-op
  }
  return null;
}

function localize(key, fallback) {
  try {
    if (typeof game?.i18n?.has === "function" && game.i18n.has(key)) return game.i18n.localize(key);
  } catch (_e) {
    // no-op
  }
  return fallback;
}

function _spellSummarySource(spellData) {
  if (!spellData || typeof spellData !== "object") return null;
  if (spellData?.system && typeof spellData.system === "object") return spellData;
  return null;
}

function buildStoredSpellSummary(spellData) {
  const source = _spellSummarySource(spellData);
  if (!source) return "";
  const spellType = String(source?.system?.spellType ?? "").trim();
  const level = Number(source?.system?.level ?? 0);
  const cost = Number(source?.system?.cost ?? 0);
  const parts = [];
  if (spellType) parts.push(spellType);
  if (Number.isFinite(level) && level > 0) parts.push(`SL ${level}`);
  if (Number.isFinite(cost) && cost > 0) parts.push(`Cost ${cost}`);
  return parts.join(" · ");
}

function buildStoredSpellStatus(hasStoredSpell, resolvedSpell, storedSpellSnapshot) {
  if (resolvedSpell) {
    return {
      statusClass: "resolved",
      statusLabel: localize("UESRPG.Sheets.Item.StoredSpellResolved", "Resolved"),
      selectedSpellName: String(resolvedSpell?.name ?? "").trim(),
      selectedSpellSummary: buildStoredSpellSummary(resolvedSpell)
    };
  }

  if (storedSpellSnapshot && typeof storedSpellSnapshot === "object") {
    return {
      statusClass: "stored",
      statusLabel: localize("UESRPG.Sheets.Item.StoredSpellStored", "Stored"),
      selectedSpellName: String(storedSpellSnapshot?.name ?? "").trim(),
      selectedSpellSummary: buildStoredSpellSummary(storedSpellSnapshot)
    };
  }

  if (hasStoredSpell) {
    return {
      statusClass: "missing",
      statusLabel: localize("UESRPG.Sheets.Item.StoredSpellMissing", "Missing"),
      selectedSpellName: "",
      selectedSpellSummary: ""
    };
  }

  return {
    statusClass: "unassigned",
    statusLabel: localize("UESRPG.Sheets.Item.StoredSpellUnassigned", "Not assigned"),
    selectedSpellName: "",
    selectedSpellSummary: ""
  };
}

export function buildActorStoredSpellOptions(actor) {
  const items = Array.from(actor?.items ?? []);
  return items
    .filter((entry) => entry?.type === "spell" && !isHiddenStoredEnchantmentSpell(entry))
    .map((spell) => ({
      value: itemUuid(spell),
      label: String(spell?.name ?? "").trim() || String(spell?.system?.spellType ?? "Spell"),
      summary: buildStoredSpellSummary(spell),
      spell
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

export async function resolveStoredSpellDocument(selectedUuid) {
  const raw = String(selectedUuid ?? "").trim();
  if (!raw) return null;
  try {
    const direct = resolveItemByUuid(raw);
    if (direct?.documentName === "Item" && direct?.type === "spell") return direct;
    const doc = await resolveDocumentUuid(raw);
    if (doc?.documentName === "Item" && doc?.type === "spell") return doc;
  } catch (_e) {
    // no-op
  }
  return null;
}

export async function resolveStoredSpellDrop(data) {
  const resolved = await itemFromDropData(data);
  if (resolved?.documentName === "Item" && resolved?.type === "spell") {
    return {
      spell: resolved,
      uuid: itemUuid(resolved),
      level: itemLevel(resolved),
      cost: itemCost(resolved),
      summary: buildStoredSpellSummary(resolved)
    };
  }
  return null;
}

export function buildStoredSpellSnapshot(spell) {
  if (!spell || spell?.type !== "spell") return null;
  const source = spell?.toObject?.() ?? null;
  const snapshot = source && typeof source === "object"
    ? foundry.utils.deepClone(source)
    : {
        name: String(spell?.name ?? "").trim(),
        type: "spell",
        img: spell?.img ?? "icons/svg/book.svg",
        system: foundry.utils.deepClone(spell?.system ?? {}),
        flags: foundry.utils.deepClone(spell?.flags ?? {})
      };

  if (snapshot && typeof snapshot === "object") {
    delete snapshot._id;
    delete snapshot.folder;
    delete snapshot.sort;
    delete snapshot.ownership;
    delete snapshot._stats;
  }

  snapshot.name = String(snapshot?.name ?? spell?.name ?? "").trim() || "Stored Spell";
  snapshot.type = "spell";
  snapshot.img = String(snapshot?.img ?? spell?.img ?? "icons/svg/book.svg").trim() || "icons/svg/book.svg";
  snapshot.system = foundry.utils.deepClone(snapshot?.system ?? spell?.system ?? {});
  snapshot.flags = foundry.utils.deepClone(snapshot?.flags ?? spell?.flags ?? {});

  return snapshot;
}

export function buildStoredSpellOptionState({
  actor,
  selectedUuid,
  storedSpellSnapshot,
  slot
} = {}) {
  const rawUuid = String(selectedUuid ?? slot?.spellUuid ?? "").trim();
  const embeddedId = String(slot?.actorSpellItemId ?? "").trim();
  let resolvedSpell = null;

  if (embeddedId && actor?.items?.get) {
    const embedded = actor.items.get(embeddedId) ?? null;
    if (embedded?.type === "spell") resolvedSpell = embedded;
  }
  if (!resolvedSpell && rawUuid) {
    resolvedSpell = resolveItemByUuid(rawUuid) ?? null;
  }

  const hasStoredSpell = Boolean(rawUuid || embeddedId || (storedSpellSnapshot && typeof storedSpellSnapshot === "object"));
  const status = buildStoredSpellStatus(hasStoredSpell, resolvedSpell, storedSpellSnapshot);
  const options = buildActorStoredSpellOptions(actor);
  const selectedValue = rawUuid || (resolvedSpell ? itemUuid(resolvedSpell) : "");
  const selectedOption = options.find((option) => String(option?.value ?? "") === selectedValue) ?? null;
  const selectedSpellName = String(selectedOption?.label ?? status.selectedSpellName ?? String(resolvedSpell?.name ?? "")).trim();
  const selectedSpellSummary = String(selectedOption?.summary ?? status.selectedSpellSummary ?? buildStoredSpellSummary(resolvedSpell)).trim();

  return {
    options,
    selectedUuid: selectedValue,
    selectedSpellUuid: selectedValue,
    selectedOption,
    selectedSpellLabel: selectedOption?.label ?? selectedSpellName,
    selectedSpellName,
    selectedSpellSummary,
    canSelectKnownSpells: options.length > 0,
    isSelectable: options.length > 0,
    availableSpellCount: options.length,
    resolvedSpell,
    hasStoredSpell,
    statusClass: status.statusClass,
    statusLabel: status.statusLabel,
    isResolved: status.statusClass === "resolved",
    isStored: status.statusClass === "stored",
    isMissing: status.statusClass === "missing",
    isUnassigned: status.statusClass === "unassigned"
  };
}
