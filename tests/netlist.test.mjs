import test from "node:test";
import assert from "node:assert/strict";
import {
  validateNetlist,
  topoOrder,
  levelToJson,
  gateArity,
  GATE_TYPES,
} from "../src/core/netlist.mjs";

const good = {
  inputs: ["i0", "i1"],
  outputs: ["o0", "o1"],
  gates: [
    { id: "g01", type: "AND", in: ["i0", "i1"] },
    { id: "g02", type: "NOT", in: ["g01"] },
  ],
  outputsMap: { o0: "g01", o1: "g02" },
};

test("合法网表通过校验", () => {
  assert.deepEqual(validateNetlist(good), { ok: true, errors: [] });
});

test("非法网表逐类报错", () => {
  const cases = [
    [{ ...good, inputs: [] }, "inputs"],
    [{ ...good, gates: [{ id: "g01", type: "XOR", in: ["i0", "i1"] }] }, "未知门类型"],
    [{ ...good, gates: [{ id: "g01", type: "AND", in: ["i0"] }] }, "输入引脚数"],
    [{ ...good, gates: [{ id: "g01", type: "AND", in: ["nope", "i1"] }] }, "未定义信号"],
    [{ ...good, outputsMap: { o0: "missing", o1: "g02" } }, "未定义信号"],
    [{ ...good, outputsMap: null }, "outputsMap"],
  ];
  for (const [netlist, needle] of cases) {
    const result = validateNetlist(netlist);
    assert.equal(result.ok, false, `应判非法: ${needle}`);
    assert.ok(result.errors.some((error) => error.includes(needle)), `缺少错误: ${needle} -> ${result.errors}`);
  }
});

test("重复 id 与端口重名被拒绝", () => {
  const dup = {
    ...good,
    gates: [
      { id: "g01", type: "AND", in: ["i0", "i1"] },
      { id: "g01", type: "OR", in: ["i0", "i1"] },
    ],
  };
  assert.equal(validateNetlist(dup).ok, false);
  const clash = { ...good, gates: [{ id: "i0", type: "NOT", in: ["i1"] }] };
  assert.equal(validateNetlist(clash).ok, false);
});

test("拓扑序按同层 id 字典序固定", () => {
  const netlist = {
    inputs: ["i0"],
    outputs: ["o0"],
    gates: [
      { id: "g03", type: "NOT", in: ["i0"] },
      { id: "g01", type: "NOT", in: ["i0"] },
      { id: "g02", type: "AND", in: ["g01", "g03"] },
    ],
    outputsMap: { o0: "g02" },
  };
  const { order, cyclic } = topoOrder(netlist);
  assert.deepEqual(order, ["g01", "g03", "g02"]);
  assert.deepEqual(cyclic, []);
});

test("组合环被识别为 cyclic，不参与拓扑序", () => {
  const netlist = {
    inputs: ["i0"],
    outputs: ["o0"],
    gates: [
      { id: "g01", type: "NOT", in: ["g02"] },
      { id: "g02", type: "NOT", in: ["g01"] },
      { id: "g03", type: "NOT", in: ["i0"] },
    ],
    outputsMap: { o0: "g03" },
  };
  const { order, cyclic } = topoOrder(netlist);
  assert.deepEqual(order, ["g03"]);
  assert.deepEqual(cyclic, ["g01", "g02"]);
});

test("关卡 JSON 键顺序固定，双跑逐字节一致", () => {
  const level = {
    format: "circuit-detective/level",
    version: 1,
    id: "seed-1",
    seed: "1",
    difficulty: "easy",
    inputs: ["i0"],
    outputs: ["o0"],
    netlist: good,
    optimal: 2,
  };
  const once = levelToJson(level);
  const twice = levelToJson({ ...level });
  assert.equal(once, twice);
  assert.ok(once.startsWith('{"format":"circuit-detective/level","version":1'));
});

test("门基与元数在单点声明", () => {
  assert.deepEqual([...GATE_TYPES], ["NOT", "AND", "OR"]);
  assert.equal(gateArity("NOT"), 1);
  assert.equal(gateArity("AND"), 2);
  assert.equal(gateArity("MUX"), 0);
});
