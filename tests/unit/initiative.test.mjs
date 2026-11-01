import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getInitiativeTieBreakTuple, compareInitiativeTuples } from "../../src/core/documents/combat/initiative-helpers.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/initiative.json", import.meta.url), "utf8"));

describe("Initiative ordering from source data", () => {
  it("builds the documented total, rating, luck, PC, id tuple", () => {
    const combatant = structuredClone(fixture.combatants.find(entry => entry.id === "pc"));
    const before = structuredClone(combatant);
    assert.deepEqual(getInitiativeTieBreakTuple(combatant), [20, 12, 4, 1, "pc"]);
    assert.deepEqual(getInitiativeTieBreakTuple(combatant, 25), [25, 12, 4, 1, "pc"]);
    assert.deepEqual(combatant, before);
  });

  it("orders each tie-break level and numeric stable ids", () => {
    const combatants = structuredClone(fixture.combatants);
    const before = structuredClone(combatants);
    const tuples = combatants.map(combatant => getInitiativeTieBreakTuple(combatant));
    tuples.sort(compareInitiativeTuples);
    assert.deepEqual(tuples.map(tuple => tuple[4]), fixture.expectedOrder);
    assert.deepEqual(combatants, before);
  });

  it("uses PC total Luck only when no explicit bonus exists", () => {
    const combatant = { id: "fallback", initiative: 10, actor: { type: "Player Character", system: { characteristics: { lck: { total: 49 } } } } };
    assert.equal(getInitiativeTieBreakTuple(combatant)[2], 4);
    combatant.actor.system.characteristics.lck.bonus = 0;
    assert.equal(getInitiativeTieBreakTuple(combatant)[2], 0);
    delete combatant.actor.system.characteristics.lck.bonus;
    combatant.actor.type = "NPC";
    assert.equal(getInitiativeTieBreakTuple(combatant)[2], 0);
  });

  it("handles absent nested data and invalid numeric input", () => {
    assert.deepEqual(getInitiativeTieBreakTuple({ id: "missing" }), [-Infinity, 0, 0, 0, "missing"]);
    assert.deepEqual(getInitiativeTieBreakTuple({ _id: "legacy", initiative: "bad", actor: { system: {} } }), [-Infinity, 0, 0, 0, "legacy"]);
    assert.equal(getInitiativeTieBreakTuple({ id: "numeric", initiative: "12" })[0], 12);
  });

  it("compares without changing either tuple and returns equality for identical tuples", () => {
    const a = [20, 12, 4, 1, "pc"];
    const b = [20, 12, 4, 0, "npc"];
    const before = structuredClone([a, b]);
    assert.ok(compareInitiativeTuples(a, b) < 0);
    assert.ok(compareInitiativeTuples(b, a) > 0);
    assert.equal(compareInitiativeTuples(a, [...a]), 0);
    assert.deepEqual([a, b], before);
  });

  it("maintains a consistent order across the full representative fixture", () => {
    const tuples = fixture.combatants.map(combatant => getInitiativeTieBreakTuple(combatant)).sort(compareInitiativeTuples);
    for (let left = 0; left < tuples.length; left++) {
      for (let right = left + 1; right < tuples.length; right++) {
        assert.ok(compareInitiativeTuples(tuples[left], tuples[right]) < 0);
        assert.ok(compareInitiativeTuples(tuples[right], tuples[left]) > 0);
      }
    }
  });
});
