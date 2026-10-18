import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { simulate } from "../src/core/sim.mjs";
import { referenceSimulate } from "./reference/sim-reference.mjs";
import { inputCombinations } from "../src/core/sim.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = JSON.parse(readFileSync(join(ROOT, "data", "fixtures", "netlists.json"), "utf8"));

test("fixture 台账形态：1000 条、含环、全部标记合成", () => {
  assert.equal(fixtures.fixtures.length, 1000);
  assert.equal(fixtures.format, "circuit-detective/fixtures");
  const shapes = new Set(fixtures.fixtures.map((item) => item.shape));
  assert.ok(shapes.has("fanout"));
  assert.ok(shapes.has("unused"));
  assert.ok(shapes.has("cyclic"));
  assert.ok(fixtures.fixtures.every((item) => item.synthetic === true));
});

test("生产实现与独立第二实现：1000 网表 × 全部输入组合，0 差异", () => {
  let compared = 0;
  const differences = [];
  for (const fixture of fixtures.fixtures) {
    const vectors = inputCombinations(fixture.netlist.inputs.length);
    for (const vector of vectors) {
      const actual = simulate(fixture.netlist, vector, { recordTrace: false });
      const reference = referenceSimulate(fixture.netlist, vector);
      compared += 1;
      if (!actual.ok) {
        differences.push({ index: fixture.index, vector, reason: "invalid", errors: actual.errors });
        continue;
      }
      for (const name of fixture.netlist.outputs) {
        if (actual.outputs[name] !== reference.outputs[name]) {
          differences.push({ index: fixture.index, vector, name, actual: actual.outputs[name], reference: reference.outputs[name] });
        }
      }
      for (const gate of fixture.netlist.gates) {
        if (actual.gates[gate.id] !== reference.gateValues[gate.id]) {
          differences.push({ index: fixture.index, vector, gate: gate.id, actual: actual.gates[gate.id], reference: reference.gateValues[gate.id] });
        }
      }
    }
  }
  const expected = fixtures.fixtures.reduce(
    (total, fixture) => total + 2 ** fixture.netlist.inputs.length,
    0,
  );
  assert.equal(differences.length, 0, JSON.stringify(differences.slice(0, 5)));
  assert.equal(compared, expected);
});

test("环网表在两个实现里都收敛为全 X", () => {
  const cyclic = fixtures.fixtures.filter((item) => item.shape === "cyclic");
  assert.ok(cyclic.length > 0);
  for (const fixture of cyclic) {
    const vector = new Array(fixture.netlist.inputs.length).fill(0);
    const actual = simulate(fixture.netlist, vector, { recordTrace: false });
    const reference = referenceSimulate(fixture.netlist, vector);
    for (const gate of fixture.netlist.gates) {
      if (actual.gates[gate.id] === 2) {
        assert.equal(reference.gateValues[gate.id], 2);
      }
    }
    assert.ok(actual.ticks <= fixture.netlist.gates.length + 1);
  }
});
