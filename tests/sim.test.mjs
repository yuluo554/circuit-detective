import test from "node:test";
import assert from "node:assert/strict";
import { simulate, truthTable, truthTableMasks, firstMismatch, inputCombinations } from "../src/core/sim.mjs";

const notGate = (src) => ({ id: "g01", type: "NOT", in: [src] });
const base = (gates, outputsMap) => ({
  inputs: ["i0", "i1"],
  outputs: Object.keys(outputsMap),
  gates,
  outputsMap,
});

test("NOT / AND / OR 的确定行为", () => {
  const andNet = base([{ id: "g01", type: "AND", in: ["i0", "i1"] }], { o0: "g01" });
  assert.deepEqual(simulate(andNet, [0, 0]).outputs, { o0: 0 });
  assert.deepEqual(simulate(andNet, [1, 1]).outputs, { o0: 1 });

  const orNet = base([{ id: "g01", type: "OR", in: ["i0", "i1"] }], { o0: "g01" });
  assert.equal(simulate(orNet, [0, 1]).outputs.o0, 1);
  assert.equal(simulate(orNet, [0, 0]).outputs.o0, 0);

  const notNet = base([notGate("i0")], { o0: "g01" });
  assert.equal(simulate(notNet, [1, 0]).outputs.o0, 0);
});

test("unit-delay：门输出在下一 tick 才可见", () => {
  const net = base([{ id: "g01", type: "NOT", in: ["i0"] }], { o0: "g01" });
  const result = simulate(net, [0, 0], { recordTrace: true });
  assert.equal(result.trace[0].gates.g01, 1);
  assert.equal(result.trace[1].gates.g01, 1);
  assert.equal(result.stable, true);
});

test("带 X 的输入传播：AND 遇 0 得 0，否则遇 X 得 X", () => {
  const net = base([{ id: "g01", type: "AND", in: ["i0", "i1"] }], { o0: "g01" });
  assert.equal(simulate(net, [2, 1]).outputs.o0, 2);
  assert.equal(simulate(net, [2, 0]).outputs.o0, 0);
  const orNet = base([{ id: "g01", type: "OR", in: ["i0", "i1"] }], { o0: "g01" });
  assert.equal(simulate(orNet, [2, 1]).outputs.o0, 1);
  assert.equal(simulate(orNet, [2, 0]).outputs.o0, 2);
  assert.equal(simulate(orNet, [2, 2]).outputs.o0, 2);
});

test("组合环在有限 tick 内收敛为全 X，不挂死", () => {
  const net = base(
    [
      { id: "g01", type: "NOT", in: ["g02"] },
      { id: "g02", type: "NOT", in: ["g01"] },
    ],
    { o0: "g01" },
  );
  const result = simulate(net, [0, 0]);
  assert.equal(result.ok, true);
  assert.equal(result.stable, true);
  assert.equal(result.gates.g01, 2);
  assert.equal(result.gates.g02, 2);
  assert.equal(result.outputs.o0, 2);
  assert.ok(result.ticks <= net.gates.length + 1);
  assert.ok(result.diagnostics.some((line) => line.includes("组合环")));
});

test("非法网表返回结构化错误而不是抛异常", () => {
  const result = simulate({ inputs: ["i0"], outputs: ["o0"], gates: [], outputsMap: {} }, [0]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assert.deepEqual(result.outputs, {});
});

test("输入向量越界值按 X 处理", () => {
  const net = base([notGate("i0")], { o0: "g01" });
  assert.equal(simulate(net, [5, 0]).outputs.o0, 2);
});

test("全表 16 行、行序固定、无抽样", () => {
  const rows = inputCombinations(4);
  assert.equal(rows.length, 16);
  assert.deepEqual(rows[0], [0, 0, 0, 0]);
  assert.deepEqual(rows[15], [1, 1, 1, 1]);
  const net = {
    inputs: ["i0", "i1", "i2", "i3"],
    outputs: ["o0"],
    gates: [{ id: "g01", type: "AND", in: ["i0", "i1"] }],
    outputsMap: { o0: "g01" },
  };
  const table = truthTable(net);
  assert.equal(table.length, 16);
  const { masks } = truthTableMasks(net);
  assert.equal(masks.o0, 0xf000);
});

test("firstMismatch 报出具体行与端口", () => {
  const expected = {
    inputs: ["i0", "i1"],
    outputs: ["o0"],
    gates: [{ id: "g01", type: "AND", in: ["i0", "i1"] }],
    outputsMap: { o0: "g01" },
  };
  const actual = {
    ...expected,
    gates: [{ id: "g01", type: "OR", in: ["i0", "i1"] }],
  };
  const mismatch = firstMismatch(actual, expected);
  assert.equal(mismatch.input.join(""), "01");
  assert.equal(mismatch.output, "o0");
  assert.equal(mismatch.expected, 0);
  assert.equal(mismatch.actual, 1);
  assert.equal(firstMismatch(expected, expected), null);
});

test("仿真不读时钟：同一输入两次求值完全一致", () => {
  const net = base(
    [
      { id: "g01", type: "AND", in: ["i0", "i1"] },
      { id: "g02", type: "OR", in: ["g01", "i0"] },
    ],
    { o0: "g02" },
  );
  const first = simulate(net, [1, 0], { recordTrace: true });
  const second = simulate(net, [1, 0], { recordTrace: true });
  assert.deepEqual(first, second);
});
