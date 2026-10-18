import test from "node:test";
import assert from "node:assert/strict";
import { buildCostTable, solveOptimal, minimalGatesForMask, inputMasks, countedGates, coneOf } from "../src/core/solver.mjs";

const A = 0xff00;
const B = 0xf0f0;
const C = 0xcccc;
const D = 0xaaaa;

test("输入掩码与真值表行序一致（4 输入、MSB = i0）", () => {
  const masks = inputMasks(4);
  assert.deepEqual(masks, [A, B, C, D]);
});

test("成本表：常量与单变量为 0 门，反相 1 门，二输入 XOR 为 4 门", () => {
  const { cost } = buildCostTable(4, 12);
  assert.equal(cost[A], 0);
  assert.equal(cost[A & B], 1);
  assert.equal(cost[(~A & 0xffff)], 1);
  assert.equal(cost[(A ^ B) & 0xffff], 4);
  assert.equal(cost[0], 2);
  assert.equal(cost[0xffff], 2);
});

test("AND/OR/NOT 的等价式与门数一致", () => {
  const { cost } = buildCostTable(4, 12);
  // NOT(AND(A,B)) = 2 门；NAND 用 NOT+AND 表达
  assert.equal(cost[(~(A & B)) & 0xffff], 2);
  // A OR B 直接用 OR = 1 门
  assert.equal(cost[A | B], 1);
  // 三输入多数函数：(A&B) | (C&(A|B)) = 4 门
  const majority = (A & B) | (A & C) | (B & C);
  assert.equal(cost[majority], 4);
});

test("求解器：多输出按输出锥求和，负数不可达显式返回 -1", () => {
  const solved = solveOptimal({ o0: A & B, o1: (A ^ B) & 0xffff }, 4, 12);
  assert.equal(solved.optimal, 5);
  assert.equal(solved.perOutput.o0, 1);
  assert.equal(solved.perOutput.o1, 4);
  assert.equal(solved.reason, null);

  const unreachable = solveOptimal({ o0: 0x1234 }, 4, 2);
  assert.equal(unreachable.optimal, -1);
  assert.equal(unreachable.reason, "unreachable");
});

test("门数上限是硬边界：上限 2 时 4 门函数判不可达", () => {
  assert.equal(minimalGatesForMask((A ^ B) & 0xffff, 4, 2), -1);
  assert.equal(minimalGatesForMask((A ^ B) & 0xffff, 4, 4), 4);
});

test("门数计数只算输出锥内：未使用门不计分", () => {
  const netlist = {
    inputs: ["i0", "i1"],
    outputs: ["o0"],
    gates: [
      { id: "g01", type: "AND", in: ["i0", "i1"] },
      { id: "g02", type: "NOT", in: ["i0"] },
    ],
    outputsMap: { o0: "g01" },
  };
  assert.equal(countedGates(netlist), 1);
  assert.deepEqual([...coneOf(netlist, "o0")], ["g01"]);
});

test("共享门按使用它的输出各计一次（口径随文档一起声明）", () => {
  const netlist = {
    inputs: ["i0", "i1"],
    outputs: ["o0", "o1"],
    gates: [{ id: "g01", type: "AND", in: ["i0", "i1"] }],
    outputsMap: { o0: "g01", o1: "g01" },
  };
  assert.equal(countedGates(netlist), 2);
});

test("同一输出内重复引用同一个门，每次引用各计一次（D21 按引用展开）", () => {
  // OR(g01, g01) 展开后是 1 + 1 + 1 = 3 个门；按锥内去重会得到 2。
  const netlist = {
    inputs: ["i0", "i1"],
    outputs: ["o0"],
    gates: [
      { id: "g01", type: "AND", in: ["i0", "i1"] },
      { id: "g02", type: "OR", in: ["g01", "g01"] },
    ],
    outputsMap: { o0: "g02" },
  };
  assert.equal(countedGates(netlist), 3);
  // 三个输出共用同一个门：按每个灯各计一次。
  const shared = {
    inputs: ["i0", "i1"],
    outputs: ["o0", "o1", "o2"],
    gates: [{ id: "g01", type: "OR", in: ["i0", "i1"] }],
    outputsMap: { o0: "g01", o1: "g01", o2: "g01" },
  };
  assert.equal(countedGates(shared), 3);
});

test("门数口径与公式复杂度对齐：任何提交都 ≥ 求解器最优（差值不为负）", () => {
  // 构造一个"按锥去重会小于最优"的形状：最优解需要 2 门的两输出，
  // 若玩家用共享门，按引用展开 = 3，去掉引用去重 = 2。
  const shared = {
    inputs: ["i0", "i1", "i2", "i3"],
    outputs: ["o0", "o1"],
    gates: [
      { id: "g01", type: "AND", in: ["i0", "i1"] },
      { id: "g02", type: "OR", in: ["g01", "g01"] },
    ],
    outputsMap: { o0: "g02", o1: "g01" },
  };
  assert.equal(countedGates(shared), 3 + 1);
});
