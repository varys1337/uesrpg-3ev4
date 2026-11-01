import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeXpPurchaseIntent, decodeXpPurchaseIntent } from "../../src/core/advancement/purchase-service.js";
import { assertPurchasePatch } from "../../src/core/advancement/purchase-projection.js";

test("purchase intents retain dotted Item updates across document storage", () => {
  const intent = { version: 1, id: "purchase12345678", actorUuid: "Actor.example", workflow: "spendXpDraft",
    choices: { entries: [{ kind: "skillRankAdvance", payload: { flatData: { "system.rank": "novice" } } },
      { kind: "combatStyleAddEquipment", payload: { flatData: { "system.trainedEquipment": ["Sword", "Bow"] } } }] } };
  const encoded = encodeXpPurchaseIntent(intent);
  assert.equal(typeof encoded.intentJson, "string");
  assert.deepEqual(decodeXpPurchaseIntent(JSON.parse(JSON.stringify(encoded))), intent);
});

test("purchase intent decoder rejects malformed, ambiguous, and mismatched envelopes", () => {
  const valid = { actorUuid: "Actor.example", intentJson: '{"actorUuid":"Actor.example"}' };
  for (const input of [null, {}, { ...valid, intentJson: "{" }, { ...valid, intentJson: "[]" },
    { ...valid, actorUuid: "Actor.other" }, { ...valid, intent: {} }, { ...valid, intent: null },
    { ...valid, intentJson: {} }, { ...valid, intentJson: null, intent: {} }]) {
    assert.equal(decodeXpPurchaseIntent(input), null);
  }
});

test("legacy in-flight object requests remain readable", () => {
  const intent = { version: 1, actorUuid: "Actor.example", choices: { amount: 1 } };
  assert.deepEqual(decodeXpPurchaseIntent({ intent }), intent);
  assert.equal(decodeXpPurchaseIntent({ intent: [] }), null);
});

test("reserved purchase fields remain forbidden after decoding", () => {
  assert.doesNotThrow(() => assertPurchasePatch({ "system.rank": "novice" }));
  for (const path of ["flags.uesrpg-3ev4.advancementPurchase", "flags.uesrpg-3ev4.chargenSpendXpManaged",
    "system.__proto__.rank", "system.constructor.value"]) {
    assert.throws(() => assertPurchasePatch({ [path]: true }), /Unsupported or reserved purchase field/);
  }
});
