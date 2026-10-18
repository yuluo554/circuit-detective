import test from "node:test";
import assert from "node:assert/strict";
import { generateLevel } from "../src/core/generator.mjs";
import { buildRevealPlan, revealProgress, revealSequence } from "../src/core/reveal.mjs";
import { topoOrder } from "../src/core/netlist.mjs";
import { autoLayout, gateInputPin, gateOutputPin, hitTest, socketPoint, toBoardPoint } from "../src/ui/layout.mjs";
import { createDraft, addGate, connectSignal } from "../src/core/editor.mjs";

test("揭示层级：从输入侧向输出侧，上游层号严格小于下游", () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const { level } = generateLevel(seed);
    const plan = buildRevealPlan(level.netlist);
    const seen = new Set();
    for (const [id, layer] of Object.entries(plan.layerById)) {
      assert.ok(layer >= 0);
      const gate = level.netlist.gates.find((item) => item.id === id);
      for (const src of gate.in) {
        if (!(src in plan.layerById)) continue;
        assert.ok(plan.layerById[src] < layer, `seed ${seed}: ${src} 的层 ${plan.layerById[src]} 不小于 ${id} 的层 ${layer}`);
      }
      seen.add(id);
    }
    assert.equal(seen.size, level.netlist.gates.length);
  }
});

test("揭示序列严格递增，且每层非空", () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const { level } = generateLevel(seed);
    const plan = buildRevealPlan(level.netlist);
    const sequence = revealSequence(plan);
    assert.deepEqual(sequence, sequence.map((_, index) => index));
    for (let i = 1; i < sequence.length; i += 1) assert.equal(sequence[i], sequence[i - 1] + 1);
    for (const layer of plan.layers) assert.ok(layer.length > 0, `seed ${seed} 出现空层`);
  }
});

test("揭示进度：集合只增不减，终态覆盖全部门", () => {
  const { level } = generateLevel("2026-10-19");
  const plan = buildRevealPlan(level.netlist);
  let previous = new Set();
  for (let step = 0; step <= plan.layers.length; step += 1) {
    const progress = revealProgress(plan, step);
    for (const id of previous) assert.ok(progress.revealed.has(id), "已揭示的门不得回退");
    assert.ok(progress.revealed.size >= previous.size);
    previous = progress.revealed;
  }
  const final = revealProgress(plan, plan.layers.length);
  assert.equal(final.done, true);
  assert.equal(final.revealed.size, level.netlist.gates.length);
  for (const gate of level.netlist.gates) assert.ok(final.revealed.has(gate.id));
});

test("揭示计划：环成员被单列到最后一层且不破坏层序", () => {
  const netlist = {
    inputs: ["i0", "i1"],
    outputs: ["o0"],
    gates: [
      { id: "g01", type: "AND", in: ["i0", "i1"] },
      { id: "g02", type: "NOT", in: ["g03"] },
      { id: "g03", type: "NOT", in: ["g02"] },
    ],
    outputsMap: { o0: "g01" },
  };
  const plan = buildRevealPlan(netlist);
  assert.deepEqual(plan.cyclic, ["g02", "g03"]);
  const topLayer = plan.layers.length - 1;
  assert.equal(plan.layerById.g02, topLayer);
  assert.equal(plan.layerById.g03, topLayer);
  assert.ok(plan.layerById.g01 < topLayer);
});

test("揭示计划顺序与拓扑序一致（同层按门 id 升序）", () => {
  for (let seed = 0; seed < 60; seed += 1) {
    const { level } = generateLevel(seed);
    const plan = buildRevealPlan(level.netlist);
    const { order } = topoOrder(level.netlist);
    assert.deepEqual(plan.order.slice(0, order.length), order);
    for (const layer of plan.layers) {
      assert.deepEqual(layer, [...layer].sort());
    }
  }
});

test("自动布局：同一网表得到同一坐标，且层级越小越靠左", () => {
  const { level } = generateLevel("2026-10-19");
  const first = autoLayout(level.netlist);
  const second = autoLayout(level.netlist);
  assert.deepEqual(first.positions, second.positions);
  for (const [id, point] of first.positions) {
    for (const src of level.netlist.gates.find((gate) => gate.id === id).in) {
      if (!first.positions.has(src)) continue;
      assert.ok(first.positions.get(src).x < point.x, `${src} 应排在 ${id} 左边`);
    }
  }
});

test("命中判定：引脚优先于拼块本体，空处返回 empty", () => {
  const draft = createDraft({ inputs: ["i0", "i1", "i2", "i3"], outputs: ["o0", "o1", "o2", "o3"] });
  const { id } = addGate(draft, "AND", { x: 352, y: 256 });
  const gate = draft.gates[0];
  const pin = gateInputPin(gate, 0);
  assert.deepEqual(hitTest(pin, draft), { type: "pin", gate: id, pin: 0, point: pin });
  const out = gateOutputPin(gate);
  assert.deepEqual(hitTest(out, draft), { type: "socket", side: "gate", gate: id, point: out });
  assert.equal(hitTest({ x: 352, y: 256 }, draft).type, "gate");
  assert.equal(hitTest({ x: 20, y: 540 }, draft).type, "empty");
  const input = socketPoint("input", 0);
  assert.equal(hitTest(input, draft).type, "socket");
  const output = socketPoint("output", 0);
  assert.deepEqual(hitTest(output, draft), { type: "pin", target: "output", output: "o0", point: output });
});

test("命中判定：接线后仍能点中同一个引脚（坐标只由几何决定）", () => {
  const draft = createDraft({ inputs: ["i0", "i1", "i2", "i3"], outputs: ["o0"] });
  const { id } = addGate(draft, "OR", { x: 400, y: 300 });
  const gate = draft.gates[0];
  connectSignal(draft, "i0", { gate: id, pin: 0 });
  const hit = hitTest(gateInputPin(gate, 0), draft);
  assert.equal(hit.type, "pin");
  assert.equal(hit.gate, id);
  assert.equal(hit.pin, 0);
});

test("画布坐标换算：CSS 缩放后仍落在同一逻辑点", () => {
  const rect = { left: 10, top: 20, width: 440, height: 280 };
  assert.deepEqual(toBoardPoint(10, 20, rect), { x: 0, y: 0 });
  assert.deepEqual(toBoardPoint(450, 300, rect), { x: 880, y: 560 });
  assert.deepEqual(toBoardPoint(230, 160, rect), { x: 440, y: 280 });
});
