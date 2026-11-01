import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.game = { release: { generation: 14 }, system: { id: "uesrpg-3ev4" }, settings: { get: () => false } };
const getProperty = (object, path) => String(path).split(".").reduce((value, key) => value?.[key], object);
globalThis.foundry = { utils: { getProperty, hasProperty: (object, path) => getProperty(object, path) !== undefined } };

const { computeMagicCastingTN } = await import("../../src/core/magic/magicka-utils.js");
const { hasAppliedCondition } = await import("../../src/core/conditions/engine/queries.js");

function effect(key, options = {}) {
  return { name: options.name ?? key, active: options.active ?? true, disabled: options.disabled ?? false,
    isSuppressed: options.suppressed ?? false, duration: { expired: options.expired ?? false },
    statuses: new Set(options.statuses ?? []), changes: [], flags: options.systemSuppressed
      ? { "uesrpg-3ev4": { ae: { suppressed: { expired: true } } } } : {},
    getFlag: (scope, name) => scope === "uesrpg-3ev4" && name === "condition" && options.flag !== false ? { key } : undefined };
}

function actor({ type = "Player Character", conditions = {}, effects = [], items = [], flags = {} } = {}) {
  const skill = { type: "magicSkill", name: "Destruction", system: { rank: "novice", value: 80 } };
  return { type, system: { traits: { condition: conditions }, professions: { magic: 80 }, characteristics: { wp: { bonus: 4 } } },
    flags: { "uesrpg-3ev4": { magic: flags } }, items: type === "NPC" ? items : [skill, ...items], effects,
    get appliedEffects() { return effects.filter(entry => entry.active && !entry.disabled && !entry.isSuppressed && !entry.duration?.expired); } };
}

const spell = { type: "spell", system: { school: "Destruction", level: 1 } };
const cast = caster => computeMagicCastingTN(caster, spell);
const modifier = (result, label) => result.modifiers.filter(entry => entry.label === label);
const verbal = "Silenced (no verbal)";
const somatic = "No free hands (somatic)";
const weapon = (hands = 1, extra = {}) => ({ type: "weapon", system: { equipped: true, hands, ...extra } });
const talent = name => ({ type: "talent", name, system: {} });

test("active conditions use flags, status IDs, or condition names and ignore inactive effects", () => {
  for (const entry of [effect("silenced"), effect("silenced", { flag: false, name: "Other", statuses: ["silenced"] }),
    effect("silenced", { flag: false, name: "Silenced (1)" })]) {
    assert.equal(hasAppliedCondition(actor({ effects: [entry] }), "silenced"), true);
  }
  for (const option of [{ active: false }, { disabled: true }, { suppressed: true }, { expired: true }]) {
    const caster = actor({ effects: [effect("silenced", option)] });
    assert.equal(hasAppliedCondition(caster, "silenced"), false);
    assert.equal(cast(caster).finalTN, 80);
  }
  const systemSuppressed = actor({ effects: [effect("silenced", { systemSuppressed: true })] });
  assert.equal(hasAppliedCondition(systemSuppressed, "silenced"), false);
  assert.equal(cast(systemSuppressed).finalTN, 80);
  assert.equal(hasAppliedCondition(actor(), "silenced"), false);
});

test("silence and restricted hands apply once each to PC and NPC casting", () => {
  for (const type of ["Player Character", "NPC"]) {
    const normal = cast(actor({ type }));
    const muted = cast(actor({ type, effects: [effect("silenced")] }));
    const both = cast(actor({ type, conditions: { silenced: true }, effects: [effect("silenced"), effect("restrained")] }));
    assert.equal(normal.finalTN, 80);
    assert.equal(muted.finalTN, 60);
    assert.equal(both.finalTN, 40);
    assert.deepEqual(modifier(both, verbal).map(entry => entry.value), [-20]);
    assert.deepEqual(modifier(both, somatic).map(entry => entry.value), [-20]);
    assert.equal(cast(actor({ type, conditions: { silenced: true } })).finalTN, 60);
    assert.equal(cast(actor({ type, effects: [effect("silenced"), effect("silenced")] })).finalTN, 60);
  }
});

test("movement restrictions and equipped hands use the existing somatic penalty", () => {
  for (const key of ["restrained", "paralyzed", "immobilized", "unconscious"]) {
    assert.equal(cast(actor({ effects: [effect(key)] })).finalTN, 60);
    assert.equal(cast(actor({ conditions: { [key]: true } })).finalTN, 60);
  }
  for (const item of [weapon(), weapon(2), { type: "shield", system: { equipped: true } }]) {
    assert.equal(cast(actor({ items: [item] })).finalTN, 60);
  }
  assert.equal(cast(actor({ items: [weapon(1, { qualitiesStructured: [{ key: "focus" }] })] })).finalTN, 80);
  assert.equal(cast(actor({ items: [weapon(1, { equipped: false })] })).finalTN, 80);
});

test("component exemptions and Spellsword remain effective", () => {
  const conditions = [effect("silenced"), effect("restrained")];
  assert.equal(cast(actor({ effects: conditions, items: [talent("Thoughtcaster")] })).finalTN, 80);
  assert.equal(cast(actor({ effects: conditions, flags: { ignoreVerbalComponents: true } })).finalTN, 60);
  assert.equal(cast(actor({ effects: conditions, flags: { ignoreSomaticComponents: true } })).finalTN, 60);
  assert.equal(cast(actor({ items: [talent("Spellsword"), weapon()] })).finalTN, 80);
  assert.equal(cast(actor({ items: [talent("Spellsword"), weapon(2)] })).finalTN, 60);
});
