/**
 * @module magic/conjuration/bound-item-service
 *
 * src/core/magic/bound-item-service.js
 *
 * Bound Item lifecycle for Conjure [Weapon] / Conjure [Armor] spells.
 *
 * RAW (Chapter 6 – Conjuration):
 *   - Conjure [Weapon]: creates a temporary weapon with Bound + Summoned traits
 *   - Conjure [Armor]: creates temporary armor pieces with Bound + Summoned traits
 *   - Items last for the spell duration and are auto-removed on spell end
 *
 * Framework:
 *   1. Hooks `uesrpg.spell.originCreated` — when a Conjure spell's Origin AE is created:
 *      a. Resolve the item profile from the spell's `flags.tempItemProfiles[spellStr]`
 *      b. Search compendium packs for a matching item (by name)
 *      c. If found: clone it to the caster's inventory, flagged `isBoundItem: true`
 *      d. If not found: post a GM chat notification to manually add the item
 *      e. Register the created item with Origin AE as type `"boundItem"` for synchronized teardown
 *   2. `_deleteLinkedEntity` handles type `"boundItem"` — deletes the item from the actor
 *
 * Target: Foundry VTT v14.368+
 */

import { registerLinkedEntity } from "../effects/origin-effect.js";
import { requestCreateEmbeddedDocuments, requestDeleteEmbeddedDocuments } from "../../../utils/authority-proxy.js";
import { createDebugLogger } from "../_primitives.js";
import { FLAG_SCOPE } from "../../system/namespace.js";
import { ensureIndex, getDocumentById, normalizeCompendiumName } from "../../compendium/access-service.js";

const _FLAG_NS = FLAG_SCOPE;

const _debug = createDebugLogger("debugMagicRouting", "[UESRPG][BoundItem]");

/* ── Profile Resolver ─────────────────────────────────────────────────────── */

/**
 * Attempt to find an item matching the profile name in compendium packs.
 * Searches weapon and armor packs for items whose names match.
 *
 * @param {string} profileName - e.g. "Standard", "Partial Daedric"
 * @param {string} conjureType - "weapon" or "armor"
 * @returns {Promise<Item|null>}
 */
async function _resolveProfileFromCompendium(profileName, conjureType) {
  if (!profileName) return null;

  const packType = conjureType === "armor" ? "armor" : "weapon";
  const normalizedName = profileName.toLowerCase().trim();

  // Search all Item-type compendium packs
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item") continue;

    try {
      const index = await ensureIndex(pack.collection, { fields: ["name", "type"] });
      for (const entry of index) {
        const entryName = normalizeCompendiumName(entry.name);
        // Match by exact name or "Bound" prefix + profile name
        if (entryName === normalizedName ||
            entryName === `bound ${normalizedName}` ||
            entryName === `daedric ${normalizedName}`) {
          const doc = await getDocumentById(pack.collection, entry._id);
          if (doc && (doc.type === packType || doc.type === "item")) {
            return doc;
          }
        }
      }
    } catch (_e) { /* pack access error, skip */ }
  }

  return null;
}

/* ── Item Creation ────────────────────────────────────────────────────────── */

/**
 * Create a bound item on the caster's actor.
 *
 * @param {Actor} casterActor
 * @param {ActiveEffect} originAE
 * @param {Item} spell
 * @param {string} profileName - The profile name from tempItemProfiles
 * @param {string} conjureType - "weapon" or "armor"
 * @returns {Promise<Item|null>}
 */
async function _createBoundItem(casterActor, originAE, spell, profileName, conjureType, { strict = false } = {}) {
  const templateItem = await _resolveProfileFromCompendium(profileName, conjureType);
  const placeholder = !templateItem;
  const itemData = templateItem ? templateItem.toObject() : {
    name: profileName,
    type: conjureType === "armor" ? "armor" : "weapon",
    img: conjureType === "armor"
      ? "icons/magic/defensive/shield-barrier-flaming-pentagon-blue-yellow.webp"
      : "icons/magic/fire/dagger-rune-enchant-flame-purple.webp",
    system: {},
  };
  itemData.name = `Bound ${itemData.name}`;
  itemData.flags ??= {};
  itemData.flags[_FLAG_NS] ??= {};
  Object.assign(itemData.flags[_FLAG_NS], {
    isBoundItem: true, conjureType, spellUuid: spell.uuid, spellName: spell.name,
    originAEId: originAE.id, profileName,
  });
  if (templateItem && itemData.system) itemData.system.equipped = true;

  const results = await requestCreateEmbeddedDocuments(casterActor, "Item", [itemData]);
  const created = Array.isArray(results) ? results[0] : (results ?? null);
  if (!created) {
    if (strict) throw new Error("Bound Item creation was not confirmed.");
    return null;
  }
  // Establish cleanup ownership before presentation can fail.
  const linked = await registerLinkedEntity(originAE, {
    type: "boundItem", uuid: created.uuid ?? `${casterActor.uuid}.Item.${created.id}`,
    actorUuid: casterActor.uuid, label: `${created.name} on ${casterActor.name}`,
  });
  if (!linked) {
    const removed = await requestDeleteEmbeddedDocuments(casterActor, "Item", [created.id]);
    const error = new Error(`Bound Item linking failed.${removed ? " The new Item was removed." : " Item cleanup also failed."}`);
    error.committed = !removed;
    throw error;
  }
  _debug("Registered bound item with Origin AE", { originId: originAE.id });
  try {
    const createdMessage = await ChatMessage.create({
      content: placeholder
        ? `<div class="uesrpg"><h3>Bound Item Created (Placeholder)</h3>
            <p><strong>${casterActor.name}</strong> conjures <strong>Bound ${profileName}</strong> (${conjureType}).</p>
            <p><em>No matching item found in compendia. A placeholder has been created on the actor — the GM should configure its stats manually.</em></p></div>`
        : `<div class="uesrpg"><h3>Bound Item Conjured</h3>
            <p><strong>${casterActor.name}</strong> conjures <strong>${created.name}</strong>.</p>
            <p><em>The ${conjureType} has the Bound and Summoned traits and will vanish when the spell ends.</em></p></div>`,
      speaker: ChatMessage.getSpeaker({ actor: casterActor }),
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      ...(placeholder ? { whisper: game.users?.filter(u => u.isGM)?.map(u => u.id) ?? [] } : {}),
    });
    if (!createdMessage) throw new Error("Bound Item summary creation was not confirmed.");
  } catch (error) {
    if (strict) { error.committed = true; throw error; }
    console.warn("UESRPG | Bound Item summary failed", error);
  }
  return created;
}

/* ── Hook Handler ─────────────────────────────────────────────────────────── */

/**
 * Handle `uesrpg.spell.originCreated` — if the spell is a Conjure [Weapon/Armor],
 * create the bound item and register it with the Origin AE.
 *
 * @param {object} payload - { casterActor, spell, originEffect, options }
 * @returns {Promise<void>}
 */
export async function applyBoundItemCreation(payload, { strict = false } = {}) {
  const { casterActor, spell, originEffect } = payload;
  if (!casterActor || !spell || !originEffect) return;

  // Only GM processes item creation
  if (!game.user.isGM) {
    if (strict) throw new Error("GM authority is required for bound Item creation.");
    return;
  }

  // Check if this is a Conjure spell with item profiles
  const spellFlags = spell.flags?.[_FLAG_NS] ?? {};
  const conjureType = spellFlags.conjureType;
  if (!conjureType || !["weapon", "armor"].includes(conjureType)) return;

  const tempItemProfiles = spellFlags.tempItemProfiles;
  if (!tempItemProfiles || typeof tempItemProfiles !== "object") return;

  // Determine current spell strength (from origin AE flags or spell data)
  const originFlags = originEffect.flags?.[_FLAG_NS] ?? {};
  const spellStr = Number(
    originFlags.spellStrengthValue ??
    originFlags.castContext?.spellStrengthValue ??
    originFlags.spellOptions?.selectedSpellStr ??
    spell.system?.spell_str ??
    1
  ) || 1;

  // Look up the profile for this spell strength
  const profileName = tempItemProfiles[String(spellStr)] ?? tempItemProfiles[spellStr];
  if (!profileName) {
    _debug(`No profile found for SS=${spellStr} in tempItemProfiles`, tempItemProfiles);
    return;
  }

  _debug("Conjure spell detected:", {
    type: conjureType,
    profile: profileName,
    spellStr,
    caster: casterActor.name
  });

  await _createBoundItem(casterActor, originEffect, spell, profileName, conjureType, { strict });
}

/* ── Initialization ───────────────────────────────────────────────────────── */

let _initialized = false;

/**
 * Register the bound item hook listener. Call once during system ready.
 * Idempotent — safe to call multiple times.
 */
export function initializeBoundItemService() {
  if (_initialized) return;
  _initialized = true;

  Hooks.on("uesrpg.spell.originCreated", payload => {
    if (payload?.handledDomains?.includes("boundItem")) return;
    void applyBoundItemCreation(payload).catch(error => console.error("UESRPG | Bound Item creation failed", error));
  });
  _debug("Bound item service hook registered");
}
