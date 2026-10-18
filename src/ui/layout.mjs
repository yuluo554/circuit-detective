// 画布几何：把"信号 / 引脚 / 拼块"映射成可点击的坐标。
// 纯函数，不碰 DOM；命中判定与渲染共用同一份坐标，避免"看着能点、实际点不到"。

import { gateArity } from "../core/netlist.mjs";
import { GRID } from "../core/editor.mjs";
import { buildRevealPlan } from "../core/reveal.mjs";

export const BOARD = Object.freeze({ width: 880, height: 560 });
export const GATE_SIZE = Object.freeze({ w: 56, h: 52 });
export const PIN_HIT_RADIUS = 10;

// 相邻拼块中心距必须大于「拼块宽 + 2×命中半径」，否则一个引脚会抢走另一个引脚的点击。
export const MIN_GATE_STEP_X = GATE_SIZE.w + PIN_HIT_RADIUS * 2 + 4;
export const MIN_GATE_STEP_Y = GATE_SIZE.h + 24;

export const SOCKET_X = Object.freeze({ input: 74, output: 806 });
export const SOCKET_Y0 = 148;
export const SOCKET_GAP = 92;

export const WORK_AREA = Object.freeze({ x0: 150, x1: 730, y0: 80, y1: 520 });

export function socketPoint(side, index) {
  return { x: SOCKET_X[side], y: SOCKET_Y0 + index * SOCKET_GAP };
}

export function inputSocketPoint(index) {
  return socketPoint("input", index);
}

export function gateRect(gate) {
  return { x: gate.x - GATE_SIZE.w / 2, y: gate.y - GATE_SIZE.h / 2, w: GATE_SIZE.w, h: GATE_SIZE.h };
}

export function gateInputPin(gate, pin) {
  const rect = gateRect(gate);
  const arity = gateArity(gate.type);
  const ys = arity === 1 ? [rect.y + rect.h / 2] : [rect.y + rect.h / 2 - 11, rect.y + rect.h / 2 + 11];
  return { x: rect.x, y: ys[pin] ?? rect.y + rect.h / 2 };
}

export function gateOutputPin(gate) {
  const rect = gateRect(gate);
  return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 命中判定。顺序：**最近的**引脚 / 插口 > 拼块本体。
 * 只按类型排序会让相邻拼块的引脚互相抢点击（点 A 的输出却命中 B 的输入），
 * 所以同一优先级内按距离取最近。
 * 返回 {type, ...}；type = "pin" | "socket" | "gate" | "empty"。
 */
export function hitTest(point, draft) {
  const candidates = [];
  for (const gate of draft.gates) {
    for (let pin = 0; pin < gate.in.length; pin += 1) {
      const at = gateInputPin(gate, pin);
      candidates.push({ gap: distance(point, at), hit: { type: "pin", gate: gate.id, pin, point: at } });
    }
    const out = gateOutputPin(gate);
    candidates.push({ gap: distance(point, out), hit: { type: "socket", side: "gate", gate: gate.id, point: out } });
  }
  for (let index = 0; index < draft.inputs.length; index += 1) {
    const at = socketPoint("input", index);
    candidates.push({
      gap: distance(point, at),
      hit: { type: "socket", side: "input", signal: draft.inputs[index], point: at },
    });
  }
  for (let index = 0; index < draft.outputs.length; index += 1) {
    const at = socketPoint("output", index);
    candidates.push({
      gap: distance(point, at),
      hit: { type: "pin", target: "output", output: draft.outputs[index], point: at },
    });
  }

  const near = candidates.filter((item) => item.gap <= PIN_HIT_RADIUS).sort((a, b) => a.gap - b.gap);
  if (near.length > 0) return near[0].hit;

  for (const gate of [...draft.gates].reverse()) {
    const rect = gateRect(gate);
    if (
      point.x >= rect.x - 4 &&
      point.x <= rect.x + rect.w + 4 &&
      point.y >= rect.y - 4 &&
      point.y <= rect.y + rect.h + 4
    ) {
      return { type: "gate", gate: gate.id, offset: { x: point.x - gate.x, y: point.y - gate.y } };
    }
  }
  return { type: "empty" };
}

/** 画布像素 → 逻辑坐标（canvas 内部尺寸固定，CSS 可缩放）。 */
export function toBoardPoint(clientX, clientY, rect) {
  const scaleX = BOARD.width / rect.width;
  const scaleY = BOARD.height / rect.height;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

export function clampToWorkArea(position) {
  const halfW = GATE_SIZE.w / 2;
  const halfH = GATE_SIZE.h / 2;
  return {
    x: Math.min(WORK_AREA.x1 - halfW, Math.max(WORK_AREA.x0 + halfW, position.x)),
    y: Math.min(WORK_AREA.y1 - halfH, Math.max(WORK_AREA.y0 + halfH, position.y)),
  };
}

/** 新拼块的落点：从左上按网格扫，找第一个没被占的格子（间距 ≥ 命中直径）。 */
export function freeSlot(draft, index = draft.gates.length) {
  const occupied = new Set(draft.gates.map((gate) => `${gate.x},${gate.y}`));
  const stepX = Math.ceil(MIN_GATE_STEP_X / GRID) * GRID;
  const stepY = Math.ceil(MIN_GATE_STEP_Y / GRID) * GRID;
  const cols = Math.max(1, Math.floor((WORK_AREA.x1 - WORK_AREA.x0) / stepX));
  const rows = Math.max(1, Math.floor((WORK_AREA.y1 - WORK_AREA.y0) / stepY));
  const total = cols * rows;
  for (let step = 0; step < total; step += 1) {
    const slot = (index + step) % total;
    const x = WORK_AREA.x0 + (slot % cols) * stepX;
    const y = WORK_AREA.y0 + Math.floor(slot / cols) * stepY;
    if (!occupied.has(`${x},${y}`)) return { x, y };
  }
  return { x: WORK_AREA.x0, y: WORK_AREA.y0 };
}


/**
 * 自动布局：把任意网表（隐藏答案或提交草稿）按揭示层级排成左→右。
 * 返回 {positions: Map(id → {x,y}), layers, layerById, order}。
 * 同一个网表永远得到同一份坐标（同层按门 id 升序），供逐层点亮与断言。
 */
export function autoLayout(netlist) {
  const plan = buildRevealPlan(netlist);
  const positions = new Map();
  const count = plan.layers.length;
  const span = WORK_AREA.x1 - WORK_AREA.x0;
  const stepX = count <= 1 ? 0 : span / count;
  const maxRows = Math.max(1, ...plan.layers.map((layer) => layer.length));
  const usableY = WORK_AREA.y1 - WORK_AREA.y0 - GATE_SIZE.h;
  // 行距取「放得下且不重叠」的最大值：同一层的拼块永不互相压住。
  const stepY = maxRows <= 1 ? 0 : Math.min(78, usableY / (maxRows - 1));
  // 列距至少保证相邻两列的引脚不落在对方的命中半径内。
  const stepXSafe = Math.max(stepX, MIN_GATE_STEP_X);

  plan.layers.forEach((layer, layerIndex) => {
    const x = count <= 1 ? (WORK_AREA.x0 + WORK_AREA.x1) / 2 : WORK_AREA.x0 + stepX * (layerIndex + 0.5);
    const total = layer.length;
    layer.forEach((id, row) => {
      const y = (WORK_AREA.y0 + WORK_AREA.y1) / 2 + (row - (total - 1) / 2) * stepY;
      positions.set(id, { x, y });
    });
  });

  const gates = netlist.gates.map((gate) => ({
    id: gate.id,
    type: gate.type,
    in: [...gate.in],
    x: positions.get(gate.id)?.x ?? (WORK_AREA.x0 + WORK_AREA.x1) / 2,
    y: positions.get(gate.id)?.y ?? (WORK_AREA.y0 + WORK_AREA.y1) / 2,
  }));

  return { gates, positions, layers: plan.layers, layerById: plan.layerById, order: plan.order };
}

