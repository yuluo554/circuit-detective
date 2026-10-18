// 揭示计划：把隐藏网表按"从输入侧到输出侧"的层级切开。
// 纯计算，不读时钟、不碰 DOM；渲染层只消费这里给出的顺序。
// 层级定义：直接吃输入信号的门为第 0 层；其余门的层 = 1 + 上游门的最大层。
// 组合环成员单列到最后一层（不参与前向层级），保证层号严格递增。

import { gateMap, topoOrder } from "./netlist.mjs";

/**
 * @param {object} netlist
 * @returns {{order: string[], layers: string[][], layerById: Record<string, number>,
 *   orderIndex: Record<string, number>, cyclic: string[]}}
 */
export function buildRevealPlan(netlist) {
  const { order, cyclic } = topoOrder(netlist);
  const gates = gateMap(netlist);
  const cyclicSet = new Set(cyclic);
  const layerById = {};

  for (const id of order) {
    const gate = gates.get(id);
    let layer = 0;
    for (const src of gate.in) {
      if (cyclicSet.has(src)) continue; // 环成员不参与前向层级
      const upstream = layerById[src];
      if (typeof upstream === "number") layer = Math.max(layer, upstream + 1);
    }
    layerById[id] = layer;
  }

  let maxLayer = -1;
  for (const id of order) maxLayer = Math.max(maxLayer, layerById[id]);
  for (const id of cyclic) layerById[id] = maxLayer + 1;

  const totalLayers = cyclic.length > 0 ? maxLayer + 2 : maxLayer + 1;
  const layers = Array.from({ length: Math.max(0, totalLayers) }, () => []);
  for (const id of [...order, ...cyclic]) {
    const index = layerById[id] ?? 0;
    while (layers.length <= index) layers.push([]);
    layers[index].push(id);
  }
  // 同层按门 id 升序：顺序固定，动画与断言都可复现。
  for (const layer of layers) layer.sort();

  const revealedOrder = [...order, ...cyclic];
  const orderIndex = {};
  revealedOrder.forEach((id, index) => {
    orderIndex[id] = index;
  });

  return { order: revealedOrder, layers, layerById, orderIndex, cyclic };
}

/**
 * 终态（已揭示层数 = 总层数）时可见的门集合。
 * 揭示步进本身由 UI 的计时器驱动，判定只读这里的结果。
 */
export function revealProgress(plan, revealedLayers) {
  const revealed = new Set();
  const layers = [];
  plan.layers.forEach((layer, index) => {
    if (index >= revealedLayers) return;
    layers.push(index);
    for (const id of layer) revealed.add(id);
  });
  return { revealed, layers, done: revealedLayers >= plan.layers.length };
}

/** 揭示序列（严格递增的层号），供动画与测试共用。 */
export function revealSequence(plan) {
  return plan.layers.map((_, index) => index);
}
