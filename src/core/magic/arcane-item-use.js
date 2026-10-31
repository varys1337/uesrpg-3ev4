import { getCompendiumItemOriginIds } from "../compendium/access-service.js";
import { SYSTEM_ID } from "../system/namespace.js";
import { alertDialog } from "../../utils/dialog-v2-helper.js";
import { escapeHtml } from "../../utils/html.js";

// These instructions apply only to the four identified Core Items. Their
// source identity does not establish whether an individual stone is a crafted
// variant or has already been drained.
const CORE_ARCANE_ITEMS = Object.freeze([
  {
    id: "wKyBvxACbg2iP0KT", rule: "Welkynd Stones",
    instructions: "Resolve a Secondary Cast Magic Action and restore the user's Magicka to full. An ordinary stone becomes one pinch of Welkynd Stone Dust. Before changing the stone, the GM must determine whether a crafted variant or White-Gold Artificer preservation applies; the source describes both Willpower and Enchanting tests for Welkynd preservation.",
  },
  {
    id: "6Xh9f6VR31JhdmHE", rule: "Varla Stones",
    instructions: "Resolve a Secondary Cast Magic Action and restore up to 1000 Soul Energy to the chosen enchanted Item. An ordinary stone becomes one pinch of Varla Stone Dust. Before changing the stone, the GM must determine whether White-Gold Artificer preservation or a crafted variant applies. A flawless crafted Varla stone has its own three-use rule.",
  },
  {
    id: "12yL60uck70PzoHY", rule: "Dark Welkynd Stones",
    instructions: "Manually resolve the -20 Mysticism test and Secondary Cast Magic Action to activate the stone; choose targets to attack or ignore and cast a Destruction spell of level 2 or less into it. Charge it with the user's Magicka using an Action and a +0 Mysticism test, up to 100 MP. Each round, resolve its spell as a Bolt against the nearest eligible target: it automatically succeeds with one degree of success. A +20 Mysticism test and Secondary Cast Magic Action stops it.",
  },
  {
    id: "yKL1Ppw7q0rKaORE", rule: "Welkynd Lanterns",
    instructions: "Touch the lantern and resolve a Secondary Action, spending up to 10 MP. Each MP provides up to 10 metres of bright-light radius for four hours. Track the light and expiry manually. Touching it extinguishes it; relighting costs MP again. Treat the light as Spell Level 3 for dispelling.",
  },
]);

/** Recognize a Core Item by authored source or exact compendium origin, not name. */
export function getCoreArcaneItemUse(item) {
  if (item?.type !== "item") return null;
  const source = item.flags?.[SYSTEM_ID]?.coreSource;
  if (source?.book === "UESRPG 3e v4 - Rules Compendium") {
    const tagged = CORE_ARCANE_ITEMS.find(entry => entry.rule === source.rule);
    if (tagged) return tagged;
  }
  const origins = getCompendiumItemOriginIds(item, "uesrpg-3ev4.items-revised");
  return CORE_ARCANE_ITEMS.find(entry => origins.includes(entry.id)) ?? null;
}

/** Show manual steps without charging a cost or changing any document. */
export async function showCoreArcaneItemUse(item, rule = getCoreArcaneItemUse(item)) {
  if (!rule) return false;
  await alertDialog({
    title: `${item.name}: manual use`,
    content: `<p>This Item's use is not automated. This dialog does not spend a cost or change the Item, resources, light or targets.</p><p>${escapeHtml(rule.instructions)}</p><p>Check any earlier use and its costs before making changes or trying again.</p>`,
  });
  return true;
}
