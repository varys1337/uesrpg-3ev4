import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  normalizeRank, parseSpecializations, discountCostIfFavored,
  computeCharacteristicAdvancementCost, buildSkillAdvancementPlan,
} from "../../src/core/advancement/skill-advancement.js";
import {
  getCampaignRankFromXpTotal, getMaxPurchasableSkillRankKeyFromXpTotal,
} from "../../src/core/advancement/progression.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/advancement.json", import.meta.url), "utf8"));

describe("Advancement rules using plain source inputs", () => {
  it("runs without installing Foundry globals", () => {
    for (const name of ["game", "foundry", "Actor", "Item", "Hooks"]) assert.equal(Object.hasOwn(globalThis, name), false);
  });

  it("normalizes canonical ranks and existing legacy labels", () => {
    for (const rank of ["untrained", "novice", "apprentice", "journeyman", "adept", "expert", "master"]) {
      assert.equal(normalizeRank(rank), rank);
    }
    assert.equal(normalizeRank(" (2) Journeyman "), "journeyman");
    assert.equal(normalizeRank("MASTER"), "master");
    for (const value of [null, undefined, "", "unknown"]) assert.equal(normalizeRank(value), "untrained");
  });

  it("parses specializations without charging for duplicate spellings", () => {
    assert.deepEqual(parseSpecializations(" Axes, axes\n Bows\r\n, Swords "), ["Axes", "Bows", "Swords"]);
    assert.deepEqual(parseSpecializations(null), []);
    assert.deepEqual(parseSpecializations(" , \n"), []);
  });

  it("applies the favored discount and rounds down to five XP", () => {
    for (const [cost, favored, expected] of [[100, true, 75], [25, true, 15], [90, true, 65], [25, false, 25], [0, true, 0]]) {
      assert.equal(discountCostIfFavored(cost, favored), expected);
    }
    for (const invalid of [-10, "invalid", Infinity, NaN]) assert.equal(discountCostIfFavored(invalid, true), 0);
  });

  it("quotes characteristic costs from the existing bonus and favored rule", () => {
    assert.deepEqual(computeCharacteristicAdvancementCost({ bonus: 3, favored: true }), { bonus: 3, baseCost: 90, favored: true, xpCost: 65 });
    assert.equal(computeCharacteristicAdvancementCost({ total: 39, favored: false }).xpCost, 90);
    assert.equal(computeCharacteristicAdvancementCost(null).xpCost, 0);
  });

  for (const boundary of fixture.campaignBoundaries) {
    it(`uses the recorded campaign threshold at ${boundary.xp} XP`, () => {
      assert.equal(getCampaignRankFromXpTotal(boundary.xp), boundary.label);
      assert.equal(getMaxPurchasableSkillRankKeyFromXpTotal(boundary.xp), boundary.key);
    });
  }

  it("handles numeric strings and invalid total XP without requiring settings", () => {
    assert.equal(getCampaignRankFromXpTotal("5500"), "Expert");
    for (const value of [undefined, null, "invalid", Infinity]) {
      assert.equal(getCampaignRankFromXpTotal(value), "Novice");
      assert.equal(getMaxPurchasableSkillRankKeyFromXpTotal(value), "novice");
    }
  });

  it("quotes an affordable rank without mutating any input", () => {
    const { actor, skill: item } = structuredClone(fixture);
    const flatData = { "system.rank": "apprentice" };
    const before = structuredClone({ actor, item, flatData });
    const result = buildSkillAdvancementPlan({ actor, item, flatData });
    assert.equal(result.ok, true);
    assert.equal(result.xpCost, 200);
    assert.equal(result.nextXp, 200);
    assert.equal(result.actor, actor);
    assert.deepEqual({ actor, item, flatData }, before);
  });

  for (const [xp, ok, nextXp] of [[200, true, 0], [199, false, 199]]) {
    it(`handles ${xp} available XP for a 200 XP rank purchase`, () => {
      const { actor, skill: item } = structuredClone(fixture);
      actor.system.xp = xp;
      const result = buildSkillAdvancementPlan({ actor, item, flatData: { "system.rank": "apprentice" } });
      assert.equal(result.ok, ok);
      assert.equal(result.xpCost, 200);
      assert.equal(result.nextXp, nextXp);
      if (!ok) assert.match(result.reason, /Not enough XP/);
      assert.equal(actor.system.xp, xp);
    });
  }

  it("rejects skipped rank steps before spending", () => {
    const { actor, skill: item } = structuredClone(fixture);
    const result = buildSkillAdvancementPlan({ actor, item, flatData: { "system.rank": "journeyman" } });
    assert.equal(result.ok, false);
    assert.match(result.reason, /one step at a time/);
    assert.equal(result.nextXp, 400);
  });

  it("rejects a rank above the total-XP campaign gate", () => {
    const { actor, skill: item } = structuredClone(fixture);
    actor.system.xpTotal = 999;
    const result = buildSkillAdvancementPlan({ actor, item, flatData: { "system.rank": "apprentice" } });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Total XP/);
  });

  it("uses favored governing characteristics for rank costs", () => {
    const { actor, skill: item } = structuredClone(fixture);
    actor.system.characteristics.str.favored = true;
    const result = buildSkillAdvancementPlan({ actor, item, flatData: { "system.rank": "apprentice" } });
    assert.equal(result.ok, true);
    assert.equal(result.xpCost, 150);
    assert.equal(result.nextXp, 250);
  });

  it("charges only newly added specializations within the effective rank cap", () => {
    const { actor, skill: item } = structuredClone(fixture);
    item.system.rank = "apprentice";
    const result = buildSkillAdvancementPlan({ actor, item, flatData: { "system.trainedItems": "Axes" } });
    assert.equal(result.ok, true);
    assert.equal(result.xpCost, 100);
    item.system.trainedItems = "Axes";
    assert.equal(buildSkillAdvancementPlan({ actor, item, flatData: { "system.trainedItems": "Axes, axes" } }).xpCost, 0);
    assert.equal(buildSkillAdvancementPlan({ actor, item, flatData: { "system.trainedItems": "" } }).nextXp, 400);
  });

  it("rejects excess specializations and honors explicit caller overrides", () => {
    const { actor, skill: item } = structuredClone(fixture);
    item.system.rank = "apprentice";
    const flatData = { "system.trainedItems": "Axes, Bows" };
    assert.equal(buildSkillAdvancementPlan({ actor, item, flatData }).ok, false);
    const result = buildSkillAdvancementPlan({ actor, item, flatData, options: { specializationCapOverride: 2, specializationUnitCostOverride: 50 } });
    assert.equal(result.ok, true);
    assert.equal(result.xpCost, 100);
  });

  it("uses the proposed rank when validating a simultaneous specialization", () => {
    const { actor, skill: item } = structuredClone(fixture);
    const result = buildSkillAdvancementPlan({ actor, item, flatData: { "system.rank": "apprentice", "system.trainedItems": "Axes" } });
    assert.equal(result.ok, true);
    assert.equal(result.xpCost, 300);
    assert.equal(result.nextXp, 100);
  });

  it("charges combat-style equipment consistently for arrays and indexed patches", () => {
    const { actor, combatStyle: item } = structuredClone(fixture);
    actor.system.characteristics.str.favored = true;
    for (const flatData of [
      { "system.trainedEquipment": ["Sword", "Shield", "Bow", "Spear"] },
      { "system.trainedEquipment.2": "Bow", "system.trainedEquipment.3": "Spear" },
    ]) {
      const result = buildSkillAdvancementPlan({ actor, item, flatData });
      assert.equal(result.ok, true);
      assert.equal(result.xpCost, 50);
      assert.equal(result.nextXp, 350);
    }
    assert.equal(item.system.trainedEquipment.filter(Boolean).length, 2);
  });

  it("does not refund removed equipment or charge ignored invalid indexes", () => {
    const { actor, combatStyle: item } = structuredClone(fixture);
    for (const flatData of [{ "system.trainedEquipment": ["Sword"] }, { "system.trainedEquipment.-1": "Bow", "system.trainedEquipment.bad": "Spear" }]) {
      const result = buildSkillAdvancementPlan({ actor, item, flatData });
      assert.equal(result.ok, true);
      assert.equal(result.xpCost, 0);
      assert.equal(result.nextXp, 400);
    }
  });

  it("keeps administrative waiver costs visible without charging XP", () => {
    const { actor, skill: item } = structuredClone(fixture);
    actor.system.xp = 0;
    actor.system.xpTotal = 0;
    const options = { bypassXpPayment: true };
    const result = buildSkillAdvancementPlan({ actor, item, flatData: { "system.rank": "apprentice" }, options });
    assert.equal(result.ok, true);
    assert.equal(result.xpCost, 200);
    assert.equal(result.waivedXp, 200);
    assert.equal(result.nextXp, 0);
    assert.equal(buildSkillAdvancementPlan({ actor, item, flatData: { "system.rank": "master" }, options }).ok, false);
  });

  it("handles absent actor/item and empty patches without a resource mutation", () => {
    assert.equal(buildSkillAdvancementPlan().xpCost, 0);
    const { actor, skill: item } = structuredClone(fixture);
    assert.equal(buildSkillAdvancementPlan({ actor }).nextXp, 400);
    assert.equal(buildSkillAdvancementPlan({ actor, item, flatData: null }).xpCost, 0);
  });
});
