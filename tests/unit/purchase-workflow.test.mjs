import { test } from "node:test";
import assert from "node:assert/strict";

const getProperty = (object, path) => String(path).split(".").reduce((value, key) => value?.[key], object);
function setProperty(object, path, value) {
  const keys = String(path).split(".");
  const last = keys.pop();
  const parent = keys.reduce((value, key) => value[key] ??= {}, object);
  parent[last] = structuredClone(value);
}
function expandObject(value) {
  if (Array.isArray(value)) return value.map(expandObject);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) setProperty(output, key, expandObject(entry));
  return output;
}
let nextId = 0;
globalThis.foundry = { utils: { deepClone: structuredClone, getProperty, setProperty,
  hasProperty: (object, path) => getProperty(object, path) !== undefined, expandObject,
  randomID: () => String(++nextId).padStart(24, "0"), isEmpty: value => !Object.keys(value).length } };
globalThis.CONFIG = {};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
globalThis.game = { system: { id: "uesrpg-3ev4" }, settings: { get: () => undefined }, release: { generation: 14 } };
const { foundry, game, CONFIG } = globalThis;

const { buildXpPurchasePlan } = await import("../../src/core/advancement/purchase-plans.js");
const { requestAuthorityIntent } = await import("../../src/utils/authority-intents.js");
const { encodeXpPurchaseIntent, getXpPurchaseSnapshot, readXpPurchaseJournal, registerXpPurchaseService } = await import("../../src/core/advancement/purchase-service.js");

function updateDocument(document, patch, dryRun = false) {
  const source = document.toObject();
  const changed = {};
  for (const [path, value] of Object.entries(patch)) {
    if (JSON.stringify(getProperty(source, path)) !== JSON.stringify(value)) changed[path] = value;
    if (!dryRun) setProperty(document, path, value);
  }
  return changed;
}
class FakeItem {
  constructor(data, { parent } = {}) {
    this.parent = parent; this.documentName = "Item"; this.id = data._id ?? foundry.utils.randomID();
    this.uuid = `${parent?.uuid ?? "Actor.test"}.Item.${this.id}`;
    this.name = data.name; this.type = data.type; this.img = data.img; this.system = structuredClone(data.system ?? {});
    this.flags = structuredClone(data.flags ?? {}); this.effects = structuredClone(data.effects ?? []);
  }
  toObject() { return structuredClone({ _id: this.id, name: this.name, type: this.type, img: this.img, system: this.system, flags: this.flags, effects: this.effects }); }
  getFlag(scope, key) { return getProperty(this.flags?.[scope], key); }
  testUserPermission(user) { return this.parent.testUserPermission(user); }
  canUserModify(user) { return user.isGM || this.testUserPermission(user); }
  validate() { return true; }
  updateSource(patch, options = {}) { return updateDocument(this, patch, options.dryRun); }
  async update(patch) { this.updateSource(patch); return this; }
}
globalThis.Item = { implementation: FakeItem };

function makeUser(id, isGM = false) {
  return { id, isGM, active: true, flags: {}, getFlag(scope, key) { return getProperty(this.flags?.[scope], key); },
    canUserModify() { return true; },
    async update(patch) { for (const [path, value] of Object.entries(patch)) setProperty(this, path, expandObject(value)); return this; },
    async query(channel, data) { const before = game.user; game.user = this; try { return await CONFIG.queries[channel](data); } finally { game.user = before; } } };
}
const gm = makeUser("gm", true);
const player = makeUser("player");
const stranger = makeUser("stranger");
game.users = { contents: [gm, player, stranger], get: id => [gm, player, stranger].find(user => user.id === id), activeGM: gm };

function makeActor() {
  const actor = { id: "test", uuid: "Actor.test", documentName: "Actor", type: "Player Character", flags: {},
    system: { xp: 900, xpTotal: 1000, wealth: 1000, characteristics: { int: { base: 40, total: 40, bonus: 4, favored: true } } },
    items: [], getFlag(scope, key) { return getProperty(this.flags?.[scope], key); },
    toObject() { return structuredClone({ system: this.system, flags: this.flags, effects: [] }); },
    testUserPermission(user) { return user.id === "player"; }, canUserModify(user) { return user.isGM || this.testUserPermission(user); },
    updateSource(patch, options = {}) { return updateDocument(this, patch, options.dryRun); },
    async update(patch) { this.updateSource(patch); return this; },
    async createEmbeddedDocuments(_name, data) { const created = data.map(entry => new FakeItem(entry, { parent: this })); this.items.push(...created); return created; } };
  actor.items.get = id => actor.items.find(item => item.id === id);
  actor.items.has = id => Boolean(actor.items.get(id));
  actor.items.push(new FakeItem({ _id: "skill1", name: "Conjuration", type: "magicSkill", system: { rank: "untrained", governingCha: "int" } }, { parent: actor }));
  return actor;
}
let currentActor;
globalThis.fromUuid = async uuid => uuid === currentActor?.uuid ? currentActor : null;
registerXpPurchaseService(buildXpPurchasePlan);

const skill = { id: "one", kind: "skillRankAdvance", label: "Conjuration", costXp: 75, costWealth: 0,
  payload: { itemRef: "id:skill1", flatData: { "system.rank": "novice" } } };
const talent = { id: "two", kind: "talentLearn", label: "Test Talent", costXp: 75, costWealth: 0,
  payload: { itemData: { name: "Test Talent", type: "talent", system: { level: "novice", governingCharacteristics: "int" } } } };
async function makeIntent(actor, entries, id = foundry.utils.randomID()) {
  return { version: 1, id, actorUuid: actor.uuid, workflow: "spendXpDraft", choices: { entries }, expected: await getXpPurchaseSnapshot(actor),
    quote: { xpCost: entries.reduce((sum, entry) => sum + entry.costXp, 0), wealthCost: 0 } };
}
async function send(user, intent) {
  game.user = user;
  return requestAuthorityIntent("advancement.purchase", { ...encodeXpPurchaseIntent(intent), phase: "execute" });
}

test("GM and player-owned mixed skill and talent purchases charge exactly once", async () => {
  for (const user of [gm, player]) {
    currentActor = makeActor();
    const intent = await makeIntent(currentActor, [skill, talent]);
    const first = (await send(user, intent)).data.purchase;
    assert.equal(first.status, "complete", first.reason);
    assert.equal(currentActor.system.xp, 750);
    assert.equal(currentActor.items.get("skill1").system.rank, "novice");
    assert.equal(currentActor.items.filter(item => item.type === "talent").length, 1);
    const again = (await send(user, intent)).data.purchase;
    assert.equal(again.replayed, true);
    assert.equal(currentActor.system.xp, 750);
  }
});

test("authority rejects non-owners, stale drafts, and malformed requests", async () => {
  currentActor = makeActor();
  const intent = await makeIntent(currentActor, [skill]);
  assert.equal((await send(stranger, intent)).data.purchase.code, "UNAUTHORIZED");
  currentActor.system.xp = 899;
  assert.equal((await send(player, intent)).data.purchase.code, "STALE_REVISION");
  game.user = player;
  const malformed = await requestAuthorityIntent("advancement.purchase", { actorUuid: currentActor.uuid, intentJson: "{", phase: "execute" });
  assert.equal(malformed.data.purchase.code, "INVALID_REQUEST");
  assert.equal(currentActor.system.xp, 899);
  assert.equal(readXpPurchaseJournal(currentActor).revision, 0);
});

test("the reported two-skill draft deducts 225 XP", async () => {
  currentActor = makeActor();
  currentActor.items.push(new FakeItem({ _id: "skill2", name: "Destruction", type: "magicSkill",
    system: { rank: "novice", governingCha: "int" } }, { parent: currentActor }));
  const destruction = { id: "three", kind: "skillRankAdvance", label: "Destruction", costXp: 150, costWealth: 0,
    payload: { itemRef: "id:skill2", flatData: { "system.rank": "apprentice" } } };
  const result = (await send(player, await makeIntent(currentActor, [skill, destruction]))).data.purchase;
  assert.equal(result.status, "complete", result.reason);
  assert.equal(currentActor.system.xp, 675);
  assert.equal(currentActor.items.get("skill1").system.rank, "novice");
  assert.equal(currentActor.items.get("skill2").system.rank, "apprentice");
});

test("a rejected reserved field advances the journal and a fresh draft can succeed", async () => {
  currentActor = makeActor();
  const invalid = structuredClone(skill);
  invalid.payload.flatData["flags.uesrpg-3ev4.advancementPurchase"] = true;
  const rejected = (await send(player, await makeIntent(currentActor, [invalid]))).data.purchase;
  assert.equal(rejected.status, "rejected");
  assert.match(rejected.reason, /Unsupported or reserved purchase field/);
  assert.equal(readXpPurchaseJournal(currentActor).revision, 1);
  assert.equal(currentActor.system.xp, 900);
  const fresh = (await send(player, await makeIntent(currentActor, [talent]))).data.purchase;
  assert.equal(fresh.status, "complete", fresh.reason);
  assert.equal(currentActor.system.xp, 825);
});

test("an active player owner can execute when no GM is online", async () => {
  currentActor = makeActor();
  gm.active = false;
  game.users.activeGM = null;
  try {
    const result = (await send(player, await makeIntent(currentActor, [talent]))).data.purchase;
    assert.equal(result.status, "complete", result.reason);
    assert.equal(currentActor.system.xp, 825);
  } finally {
    gm.active = true;
    game.users.activeGM = gm;
  }
});

test("a GM can set up a Player Character's combat style with no players online", async () => {
  currentActor = makeActor();
  player.active = false;
  stranger.active = false;
  try {
    const intent = { version: 1, id: foundry.utils.randomID(), actorUuid: currentActor.uuid, workflow: "combatStyleSetup",
      choices: { input: { styleId: "__new__", styleName: "Test Style", rank: "novice", trainedEquipment: [],
        specialAdvantages: ["bash"], setActive: true, freeCombatStyle: false } },
      expected: await getXpPurchaseSnapshot(currentActor), quote: { xpCost: 100, wealthCost: 0 } };
    const result = (await send(gm, intent)).data.purchase;
    assert.equal(result.status, "complete", result.reason);
    assert.equal(currentActor.system.xp, 800);
    assert.equal(currentActor.items.filter(item => item.type === "combatStyle").length, 1);
  } finally {
    player.active = true;
    stranger.active = true;
  }
});

test("an unsupported Actor type reports its actual type and is not modified", async () => {
  currentActor = makeActor();
  currentActor.type = "NPC";
  const intent = { version: 1, id: foundry.utils.randomID(), actorUuid: currentActor.uuid, workflow: "combatStyleSetup",
    choices: { input: {} }, expected: await getXpPurchaseSnapshot(currentActor), quote: { xpCost: 0, wealthCost: 0 } };
  const result = (await send(gm, intent)).data.purchase;
  assert.equal(result.status, "rejected");
  assert.match(result.reason, /selected Actor's type is NPC/);
  assert.equal(currentActor.system.xp, 900);
});

test("wizard creates a Player Character and completes combat-style setup for a GM alone", async () => {
  class MockElement {
    querySelector(selector) {
      if (selector.includes("combat-style-select")) return { value: "__new__" };
      if (selector.includes("combat-style-rank")) return { value: "novice" };
      if (selector.includes("combat-style-name")) return { value: "Test Style" };
      return null;
    }
    querySelectorAll() { return [{ value: "bash" }]; }
  }
  globalThis.HTMLElement = MockElement;
  globalThis.window = {};
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.canvas = { tokens: { controlled: [] } };
  const messages = [];
  globalThis.ui = { notifications: { warn: message => messages.push(message), error: message => messages.push(message) } };
  foundry.utils.escapeHTML = value => String(value);
  foundry.applications = { api: { ApplicationV2: class { constructor() {} async render() {} }, HandlebarsApplicationMixin: Base => Base,
    DialogV2: { wait: async config => { config.buttons.find(button => button.action === "submit").callback(null, null, { element: new MockElement() }); return "submit"; } } },
  handlebars: { renderTemplate: async () => "" } };
  globalThis.Actor = { create: async data => { currentActor = makeActor(); currentActor.name = data.name; currentActor.type = data.type; return currentActor; } };
  globalThis.fromUuidSync = uuid => uuid === currentActor?.uuid ? currentActor : null;
  player.active = false;
  stranger.active = false;
  game.user = gm;
  try {
    const { CharGenWizardAppV2 } = await import("../../src/ui/apps/v2/char-gen/char-gen-wizard.js");
    const app = new CharGenWizardAppV2({ name: "GM Test Character" });
    await CharGenWizardAppV2._onCreateActor.call(app, { preventDefault() {} });
    assert.equal(currentActor.type, "Player Character");
    assert.equal(app._ws.actorUuid, currentActor.uuid);
    await CharGenWizardAppV2._onOpenCombatStyleSetup.call(app, { preventDefault() {} });
    assert.deepEqual(messages, []);
    assert.equal(app._ws.completion.combatstyle, true);
    assert.equal(currentActor.items.filter(item => item.type === "combatStyle").length, 1);
  } finally {
    player.active = true;
    stranger.active = true;
  }
});

test("an unfinished purchase blocks new requests without charging XP", async () => {
  currentActor = makeActor();
  const intent = await makeIntent(currentActor, [skill]);
  const active = { id: "unfinished123456", intent: { ...intent, id: "unfinished123456" }, status: "needsReview", steps: [] };
  setProperty(currentActor, "flags.uesrpg-3ev4.advancementPurchases", { version: 1, revision: 1, recordEncoding: "json-v1", active: JSON.stringify(active), receipts: [] });
  const blocked = (await send(player, { ...intent, expected: await getXpPurchaseSnapshot(currentActor) })).data.purchase;
  assert.equal(blocked.status, "needsReview");
  assert.equal(currentActor.system.xp, 900);
});
