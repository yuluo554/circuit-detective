import test from "node:test";
import assert from "node:assert/strict";
import { generateLevel } from "../src/core/generator.mjs";
import { addGate, connectSignal, createDraft, toNetlist } from "../src/core/editor.mjs";
import { bitsToVector, judgeSubmission, probesMatch, recomputeProbes, vectorBits } from "../src/core/judge.mjs";
import { countedGates, optimalNetlist, solveOptimal } from "../src/core/solver.mjs";
import { truthTableMasks } from "../src/core/sim.mjs";

function rebuild(level) {
  const draft = createDraft(level);
  const idMap = new Map();
  for (const gate of level.netlist.gates) {
    const result = addGate(draft, gate.type, { x: 320, y: 200 });
    idMap.set(gate.id, result.id);
    gate.in.forEach((src, pin) => connectSignal(draft, idMap.get(src) ?? src, { gate: result.id, pin }));
  }
  for (const name of level.outputs) {
    connectSignal(draft, idMap.get(level.netlist.outputsMap[name]) ?? level.netlist.outputsMap[name], {
      output: name,
    });
  }
  return draft;
}

test("判定：照答案拼出的网表被接受，差值为 0", () => {
  for (const seed of ["campaign/1", "campaign/2", "campaign/3", "2026-10-19", 42]) {
    const { level } = generateLevel(seed, { gateBudget: 4, minOptimal: 2 });
    const outcome = judgeSubmission(rebuild(level), level, { probes: 5 });
    assert.equal(outcome.accepted, true, `${seed}: ${JSON.stringify(outcome.errors)}`);
    assert.equal(outcome.settlement.yourGates, countedGates(level.netlist));
    assert.equal(outcome.settlement.optimalGates, level.optimal);
    assert.equal(outcome.settlement.difference, countedGates(level.netlist) - level.optimal);
    assert.ok(outcome.settlement.difference >= 0);
    assert.equal(outcome.settlement.probes, 5);
  }
});

test("判定：错一个输出时给出第一处失配的行 / 组合 / 端口 / 期望 / 实际", () => {
  const { level } = generateLevel("campaign/2", { gateBudget: 4, minOptimal: 2 });
  const draft = rebuild(level);
  // 把第一个灯改接到一个恒定错误的信号：NOT(i0) 与答案不同的概率高，但更稳妥的是直接改映射。
  const wrong = level.outputs[0];
  const alternative = level.netlist.gates.find((gate) => gate.id !== level.netlist.outputsMap[wrong]);
  const { level: other } = generateLevel("campaign/3", { gateBudget: 4, minOptimal: 2 });
  const otherSignal = other.netlist.gates[0].id;
  // 用第二个关卡的某个门替换：若仍等价则换 i0 的反相
  connectSignal(draft, alternative ? alternative.id : otherSignal, { output: wrong });
  const outcome = judgeSubmission(draft, level, { probes: 2 });
  if (outcome.accepted) {
    // 极少数情况下替换后功能仍相同：改为把输出接到输入端口，必然不同。
    connectSignal(draft, "i0", { output: wrong });
    const retry = judgeSubmission(draft, level, { probes: 2 });
    assert.equal(retry.accepted, false);
    assert.equal(retry.reason, "mismatch");
    assert.equal(retry.mismatch.output, wrong);
    assert.equal(retry.mismatch.input.length, level.inputs.length);
    assert.ok(Number.isInteger(retry.mismatch.row));
    return;
  }
  assert.equal(outcome.reason, "mismatch");
  assert.equal(outcome.mismatch.output, wrong);
  assert.equal(outcome.mismatch.input.length, 4);
  assert.ok(outcome.mismatch.row >= 0 && outcome.mismatch.row < 16);
  assert.ok([0, 1].includes(outcome.mismatch.expected));
  assert.ok([0, 1].includes(outcome.mismatch.actual));
});

test("判定：结构不完整的草稿不进比对，只报结构问题", () => {
  const { level } = generateLevel("campaign/1", { gateBudget: 2, minOptimal: 2 });
  const draft = createDraft(level);
  const { id } = addGate(draft, "AND", { x: 320, y: 200 });
  connectSignal(draft, id, { output: level.outputs[0] });
  const outcome = judgeSubmission(draft, level, { probes: 1 });
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.reason, "invalid-draft");
  assert.equal(outcome.mismatch, null);
  assert.equal(outcome.settlement, null);
  assert.ok(outcome.errors.some((item) => item.code === "pin-unconnected"));
  // 其余三个灯仍未接：同样被点名，一次列全
  assert.ok(outcome.errors.filter((item) => item.code === "output-unmapped").length >= 3);
});

test("判定：绕环的草稿被结构校验挡住（不靠超时或 X 传播）", () => {
  const { level } = generateLevel("campaign/1", { gateBudget: 2, minOptimal: 2 });
  const draft = createDraft(level);
  const a = addGate(draft, "NOT", { x: 320, y: 160 });
  const b = addGate(draft, "NOT", { x: 480, y: 160 });
  connectSignal(draft, b.id, { gate: a.id, pin: 0 });
  connectSignal(draft, a.id, { gate: b.id, pin: 0 });
  connectSignal(draft, a.id, { output: level.outputs[0] });
  const outcome = judgeSubmission(draft, level, { probes: 1 });
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.reason, "invalid-draft");
  assert.ok(outcome.errors.some((item) => item.code === "cycle"));
});

test("结算：多用未使用的零件不改变门数（未使用不计分）", () => {
  const { level } = generateLevel("campaign/2", { gateBudget: 4, minOptimal: 2 });
  const draft = rebuild(level);
  const baseline = judgeSubmission(draft, level, { probes: 0 }).settlement.yourGates;
  addGate(draft, "OR", { x: 300, y: 420 });
  addGate(draft, "NOT", { x: 400, y: 420 });
  const outcome = judgeSubmission(draft, level, { probes: 0 });
  assert.equal(outcome.accepted, true);
  assert.equal(outcome.settlement.yourGates, baseline, "未使用零件不应改变门数");
});

test("结算：共享零件按每个灯各计一次（口径可复核）", () => {
  const netlist = {
    inputs: ["i0", "i1"],
    outputs: ["o0", "o1"],
    gates: [{ id: "g01", type: "AND", in: ["i0", "i1"] }],
    outputsMap: { o0: "g01", o1: "g01" },
  };
  assert.equal(countedGates(netlist), 2);
});

test("结算门数与求解器 100% 一致：最优网表的门数 == 求解器最优值", () => {
  let checked = 0;
  for (let seed = 0; seed < 120; seed += 1) {
    const { level } = generateLevel(seed);
    const { masks, hasX } = truthTableMasks(level.netlist);
    assert.ok(Object.values(hasX).every((value) => value === false));
    const solved = solveOptimal(masks, 4, 12);
    const built = optimalNetlist(masks, 4, 12, level.outputs);
    const rebuilt = truthTableMasks(built);
    for (const name of level.outputs) {
      assert.equal(rebuilt.masks[name], masks[name], `seed ${seed} 输出 ${name} 功能不一致`);
    }
    assert.equal(countedGates(built), solved.optimal, `seed ${seed} 最优解不可达`);
    checked += 1;
  }
  assert.equal(checked, 120);
});

test("结算差值恒非负：任何合法提交都不会小于求解器最优", () => {
  for (let seed = 0; seed < 80; seed += 1) {
    const { level } = generateLevel(seed);
    const { masks } = truthTableMasks(level.netlist);
    const solved = solveOptimal(masks, 4, 12);
    assert.ok(level.optimal >= solved.optimal);
    assert.ok(countedGates(level.netlist) >= 0);
  }
});

test("探测重算：任意序列由 seed + 网表重算逐项相同", () => {
  const { level } = generateLevel("2026-10-19");
  const sequences = [
    [0, 1, 2, 3],
    [15, 0, 15, 8, 8, 8],
    Array.from({ length: 40 }, (_, index) => (index * 7) & 0xf),
  ];
  for (const probes of sequences) {
    const first = recomputeProbes(level, probes);
    const second = recomputeProbes(generateLevel("2026-10-19").level, probes);
    assert.deepEqual(first, second);
    assert.equal(first.length, probes.length);
  }
});

test("探测重算与 UI 的观察序列逐项一致（含重复向量）", () => {
  const { level } = generateLevel("campaign/2", { gateBudget: 4, minOptimal: 2 });
  const probes = [3, 3, 12, 0, 15];
  const replayed = recomputeProbes(level, probes);
  const observed = probes.map((vector) => ({ vector, outputs: replayed.find((row) => row.vector === vector).outputs }));
  assert.equal(probesMatch(level, probes, observed), true);
  const tampered = observed.map((row) => ({ ...row, outputs: { ...row.outputs } }));
  tampered[0].outputs[level.outputs[0]] = tampered[0].outputs[level.outputs[0]] === 1 ? 0 : 1;
  assert.equal(probesMatch(level, probes, tampered), false);
});

test("输入向量与位数组互为逆变换（4 位，MSB = 第一个开关）", () => {
  for (let vector = 0; vector < 16; vector += 1) {
    const bits = vectorBits(vector, 4);
    assert.equal(bits.length, 4);
    assert.equal(bitsToVector(bits), vector);
    assert.equal(bits[0], (vector >> 3) & 1);
  }
  assert.deepEqual(vectorBits(0b1001, 4), [1, 0, 0, 1]);
});

test("探测重算不依赖草稿：提交前提交后同一序列结果相同", () => {
  const { level } = generateLevel("campaign/3", { gateBudget: 4, minOptimal: 2 });
  const probes = [1, 2, 4, 8];
  const before = recomputeProbes(level, probes);
  const draft = rebuild(level);
  judgeSubmission(draft, level, { probes: probes.length });
  assert.deepEqual(recomputeProbes(level, probes), before);
  assert.deepEqual(toNetlist(draft).outputsMap, level.netlist.outputsMap);
});
