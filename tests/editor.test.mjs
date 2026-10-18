import test from "node:test";
import assert from "node:assert/strict";
import { generateLevel } from "../src/core/generator.mjs";
import {
  addGate,
  clearDraft,
  connectSignal,
  createDraft,
  gateById,
  moveGate,
  reachableGates,
  removeGate,
  setOutput,
  snapCoordinate,
  toNetlist,
  validateDraft,
} from "../src/core/editor.mjs";
import { GRID, MAX_DRAFT_GATES } from "../src/core/editor.mjs";

/** 把隐藏网表原样搬进草稿，用来验证"编辑器能表达生成器的全部产物"。 */
function rebuild(draft, netlist) {
  const idMap = new Map();
  for (const gate of netlist.gates) {
    const result = addGate(draft, gate.type, { x: 320, y: 200 });
    assert.equal(result.ok, true);
    idMap.set(gate.id, result.id);
    gate.in.forEach((src, pin) => {
      const source = idMap.get(src) ?? src;
      assert.equal(connectSignal(draft, source, { gate: result.id, pin }).ok, true);
    });
  }
  for (const name of netlist.outputs) {
    const source = idMap.get(netlist.outputsMap[name]) ?? netlist.outputsMap[name];
    assert.equal(connectSignal(draft, source, { output: name }).ok, true);
  }
  return idMap;
}

test("编辑器：空草稿校验一次列全问题且不抛异常", () => {
  const { level } = generateLevel("campaign/1", { gateBudget: 2, minOptimal: 2 });
  const draft = createDraft(level);
  const result = validateDraft(draft);
  assert.equal(result.ok, false);
  assert.equal(result.netlist, null);
  const codes = result.errors.map((item) => item.code);
  assert.ok(codes.includes("empty"));
  assert.equal(codes.filter((code) => code === "output-unmapped").length, level.outputs.length);
});

test("编辑器：重建生成器产出的网表并通过校验", () => {
  for (const seed of ["campaign/1", "campaign/2", "2026-10-19", 7]) {
    const { level } = generateLevel(seed, { gateBudget: 4, minOptimal: 2 });
    const draft = createDraft(level);
    rebuild(draft, level.netlist);
    const result = validateDraft(draft);
    assert.equal(result.ok, true, `${seed}: ${JSON.stringify(result.errors)}`);
    assert.equal(result.netlist.gates.length, reachableGates(draft).size);
    // 输出锥内门数应等于隐藏网表里真正被用到的门数（未使用门不计入提交网表）
    assert.ok(result.netlist.gates.length <= level.netlist.gates.length);
  }
});

test("编辑器：输出锥内的未接线引脚被点名，接上后消失", () => {
  const { level } = generateLevel("campaign/1", { gateBudget: 2, minOptimal: 2 });
  const draft = createDraft(level);
  const { id } = addGate(draft, "AND", { x: 320, y: 200 });
  connectSignal(draft, id, { output: draft.outputs[0] });
  const before = validateDraft(draft).errors.filter((item) => item.gateId === id);
  assert.deepEqual(before.map((item) => item.pin), [0, 1]);
  connectSignal(draft, "i0", { gate: id, pin: 0 });
  connectSignal(draft, "i1", { gate: id, pin: 1 });
  const after = validateDraft(draft).errors.filter((item) => item.gateId === id);
  assert.deepEqual(after, []);
});

test("编辑器：未使用的零件不参与校验（草稿不惩罚）", () => {
  const { level } = generateLevel("campaign/1", { gateBudget: 2, minOptimal: 2 });
  const draft = createDraft(level);
  rebuild(draft, level.netlist);
  assert.equal(validateDraft(draft).ok, true);
  const usedBefore = reachableGates(draft).size;
  // 多摆一个完全没接线的零件：不影响既有判定
  const extra = addGate(draft, "OR", { x: 320, y: 440 });
  const result = validateDraft(draft);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(reachableGates(draft).size, usedBefore, "未使用的零件不应进入输出锥");
  assert.equal(result.netlist.gates.length, usedBefore);
  assert.ok(!result.netlist.gates.some((gate) => gate.id === extra.id));
});

test("编辑器：删除零件会清掉指向它的接线与输出映射", () => {
  const { level } = generateLevel("campaign/1", { gateBudget: 2, minOptimal: 2 });
  const draft = createDraft(level);
  const first = addGate(draft, "NOT", { x: 320, y: 160 });
  const second = addGate(draft, "AND", { x: 480, y: 160 });
  connectSignal(draft, first.id, { gate: second.id, pin: 0 });
  connectSignal(draft, second.id, { output: draft.outputs[0] });
  removeGate(draft, second.id);
  assert.equal(gateById(draft, second.id), null);
  assert.equal(draft.outputsMap[draft.outputs[0]], null);
  const remaining = gateById(draft, first.id);
  assert.deepEqual(remaining.in, [null]);
});

test("编辑器：接线顺序与来源可复现，同一操作序列得到同一网表", () => {
  const { level } = generateLevel("42", { gateBudget: 4, minOptimal: 2 });
  const build = () => {
    const draft = createDraft(level);
    rebuild(draft, level.netlist);
    return toNetlist(draft);
  };
  assert.deepEqual(build(), build());
});

test("编辑器：坐标按 32 网格吸附，方向键微调也走同一规则", () => {
  assert.equal(snapCoordinate(13), 0);
  assert.equal(snapCoordinate(17), 32);
  assert.equal(snapCoordinate(48), 64);
  assert.equal(snapCoordinate(13, GRID), 0);

  const draft = createDraft({ inputs: ["i0"], outputs: ["o0"] });
  const { id } = addGate(draft, "NOT", { x: 301, y: 333 });
  const gate = gateById(draft, id);
  assert.equal(gate.x, 288);
  assert.equal(gate.y, 320);
  moveGate(draft, id, { x: gate.x + 32, y: gate.y - 32 });
  assert.equal(gate.x, 320);
  assert.equal(gate.y, 288);
});

test("编辑器：坏输入返回结构化错误，不抛异常", () => {
  const draft = createDraft({ inputs: ["i0"], outputs: ["o0"] });
  assert.equal(addGate(draft, "XOR", {}).ok, false);
  assert.equal(connectSignal(draft, "no-such", { output: "o0" }).ok, false);
  assert.equal(connectSignal(draft, "i0", { output: "nope" }).ok, false);
  const { id } = addGate(draft, "NOT", {});
  assert.equal(connectSignal(draft, id, { gate: id, pin: 0 }).errors[0].code, "self-loop");
  assert.equal(setOutput(draft, "o0", "ghost").ok, false);
  assert.equal(removeGate(draft, "ghost").ok, false);
});

test("编辑器：零件数量上限是硬边界", () => {
  const draft = createDraft({ inputs: ["i0", "i1", "i2", "i3"], outputs: ["o0"] });
  for (let i = 0; i < MAX_DRAFT_GATES; i += 1) {
    assert.equal(addGate(draft, "NOT", { x: 300 + i * 10, y: 200 }).ok, true);
  }
  const overflow = addGate(draft, "NOT", { x: 300, y: 300 });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.errors[0].code, "gate-limit");
  clearDraft(draft);
  assert.equal(draft.gates.length, 0);
  assert.equal(addGate(draft, "NOT", {}).ok, true);
});

test("编辑器：绕成环的接线在提交前就被点出来", () => {
  const draft = createDraft({ inputs: ["i0"], outputs: ["o0"] });
  const a = addGate(draft, "NOT", { x: 320, y: 160 });
  const b = addGate(draft, "NOT", { x: 480, y: 160 });
  connectSignal(draft, b.id, { gate: a.id, pin: 0 });
  connectSignal(draft, a.id, { gate: b.id, pin: 0 });
  connectSignal(draft, a.id, { output: "o0" });
  const result = validateDraft(draft);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "cycle"));
});
