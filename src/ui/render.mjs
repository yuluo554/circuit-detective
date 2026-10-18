// Canvas2D 绘制：黑盒视图（拨杆 + 灯）与拼装视图（拼块 + 走线）。
// 渲染层不参与任何判定：只消费 sim 的输出、揭示计划与草稿数据。

import { gateArity } from "../core/netlist.mjs";
import {
  BOARD,
  GATE_SIZE,
  SOCKET_GAP,
  SOCKET_Y0,
  gateInputPin,
  gateOutputPin,
  gateRect,
  socketPoint,
} from "./layout.mjs";

const BOX = { x: 260, y: 70, w: 360, h: 420 };

const THEME = {
  bg: "#101216",
  grid: "#1d222b",
  line: "#2a2f38",
  wire: "#2c333e",
  wireHot: "#6a5a3a",
  box: "#0c0e12",
  boxEdge: "#3a414d",
  dim: "#5c6370",
  label: "#6d7481",
  part: "#1a1f27",
  partEdge: "#3c4553",
  partText: "#a8b0bd",
  accent: "#e0b062",
  ok: "#6fd08c",
  unknown: "#a58bd8",
  bad: "#e08a62",
};

export function drawProbe(ctx, state) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);
  drawChip(ctx);

  state.inputs.forEach((name, index) => {
    const cy = SOCKET_Y0 + index * SOCKET_GAP;
    drawLever(ctx, socketPoint("input", index).x, cy, state.values[index] === 1);
    drawWire(ctx, socketPoint("input", index).x + 34, cy, BOX.x + 22, SOCKET_Y0 + index * 60, THEME.wire);
  });

  state.outputs.forEach((name, index) => {
    const cy = SOCKET_Y0 + index * SOCKET_GAP;
    drawLamp(ctx, socketPoint("output", index).x, cy, state.lamps[index]);
    drawWire(ctx, BOX.x + BOX.w - 22, SOCKET_Y0 + index * 60, socketPoint("output", index).x - 40, cy, THEME.wire);
  });

  ctx.save();
  ctx.fillStyle = THEME.label;
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "center";
  state.inputs.forEach((name, index) => {
    ctx.fillText(String.fromCharCode(65 + index), socketPoint("input", index).x - 56, SOCKET_Y0 + index * SOCKET_GAP + 4);
  });
  state.outputs.forEach((name, index) => {
    ctx.fillText(String(index + 1), socketPoint("output", index).x + 56, SOCKET_Y0 + index * SOCKET_GAP + 4);
  });
  ctx.restore();
}

/**
 * 拼装视图。
 * @param {object} state {draft, selected, source, hover, revealed:Set|null, revealLamps, outputsMode, partLabel}
 *   revealed = null 表示正常编辑；给 Set 表示揭示态（只画集合里的门）。
 */
export function drawBoard(ctx, state) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  const { draft, revealed } = state;
  const visible = (id) => !revealed || revealed.has(id);

  // 走线先画，拼块盖在上面。
  for (const gate of draft.gates) {
    if (!visible(gate.id)) continue;
    gate.in.forEach((src, pin) => {
      if (!src) return;
      const from = sourcePoint(src, draft);
      if (!from) return;
      const to = gateInputPin(gate, pin);
      const hot = state.source === src;
      drawWire(ctx, from.x, from.y, to.x, to.y, hot ? THEME.wireHot : THEME.wire);
    });
  }
  draft.outputs.forEach((name, index) => {
    const src = draft.outputsMap[name];
    if (!src) return;
    const from = sourcePoint(src, draft);
    if (!from) return;
    const to = socketPoint("output", index);
    drawWire(ctx, from.x, from.y, to.x - 28, to.y, state.source === src ? THEME.wireHot : THEME.wire);
  });

  // 输入端插口
  draft.inputs.forEach((name, index) => {
    const point = socketPoint("input", index);
    drawSocket(ctx, point, state.source === name, state.values?.[index] === 1);
    label(ctx, String.fromCharCode(65 + index), point.x - 32, point.y + 4, THEME.label);
  });

  // 拼块
  for (const gate of draft.gates) {
    if (!visible(gate.id)) continue;
    drawPart(ctx, gate, {
      selected: state.selected === gate.id,
      source: state.source === gate.id,
      values: state.partValues?.[gate.id],
      label: state.partLabel?.(gate.type) ?? gate.type,
    });
  }

  // 输出灯插口
  draft.outputs.forEach((name, index) => {
    const point = socketPoint("output", index);
    const value = state.revealLamps ? state.revealLamps[index] : null;
    drawLampSocket(ctx, point, value, draft.outputsMap[name] === state.source);
    label(ctx, String(index + 1), point.x + 32, point.y + 4, THEME.label);
  });

  if (state.hover?.type === "pin") {
    ctx.save();
    ctx.strokeStyle = THEME.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(state.hover.point.x, state.hover.point.y, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function sourcePoint(signal, draft) {
  const inputIndex = draft.inputs.indexOf(signal);
  if (inputIndex >= 0) return socketPoint("input", inputIndex);
  const gate = draft.gates.find((item) => item.id === signal);
  if (gate) return gateOutputPin(gate);
  return null;
}

function drawGrid(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = THEME.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawChip(ctx) {
  ctx.save();
  ctx.fillStyle = THEME.box;
  ctx.strokeStyle = THEME.boxEdge;
  ctx.lineWidth = 2;
  roundRect(ctx, BOX.x, BOX.y, BOX.w, BOX.h, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = THEME.dim;
  ctx.font = "12px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("BLACK BOX", BOX.x + BOX.w / 2, BOX.y + 30);
  ctx.fillStyle = "#333a45";
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.arc(BOX.x + 40 + i * 22, BOX.y + BOX.h - 26, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLever(ctx, x, y, on) {
  ctx.save();
  ctx.fillStyle = on ? "#2a2418" : "#171b22";
  ctx.strokeStyle = on ? THEME.accent : THEME.boxEdge;
  ctx.lineWidth = 2;
  roundRect(ctx, x - 26, y - 20, 52, 40, 10);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = on ? THEME.accent : "#4a515e";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y + 8);
  ctx.lineTo(x + (on ? 12 : -12), y - 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y + 8, 3, 0, Math.PI * 2);
  ctx.fillStyle = on ? THEME.accent : "#4a515e";
  ctx.fill();
  ctx.restore();
}

function drawLamp(ctx, x, y, value) {
  ctx.save();
  ctx.strokeStyle = THEME.boxEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 22, 0, Math.PI * 2);
  ctx.stroke();

  const lit = value === 1;
  const unknown = value === 2;
  if (lit || unknown) {
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 30);
    glow.addColorStop(0, lit ? "rgba(111,208,140,0.85)" : "rgba(165,139,216,0.75)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = lit ? THEME.ok : unknown ? THEME.unknown : "#232830";
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSocket(ctx, point, active, on) {
  ctx.save();
  ctx.strokeStyle = active ? THEME.accent : THEME.boxEdge;
  ctx.fillStyle = on ? "#2a2418" : "#141821";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLampSocket(ctx, point, value, active) {
  ctx.save();
  ctx.strokeStyle = active ? THEME.accent : THEME.boxEdge;
  ctx.fillStyle = value === 1 ? THEME.ok : value === 2 ? THEME.unknown : "#171b22";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (value === 1 || value === 2) {
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = value === 1 ? THEME.ok : THEME.unknown;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 17, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPart(ctx, gate, { selected, source, values, label }) {
  const rect = gateRect(gate);
  ctx.save();
  ctx.fillStyle = THEME.part;
  ctx.strokeStyle = selected ? THEME.accent : source ? THEME.accent : THEME.partEdge;
  ctx.lineWidth = selected || source ? 2.5 : 1.6;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 9);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = Array.isArray(values) || typeof values === "number" ? valueColor(values) : THEME.partText;
  ctx.font = "13px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 - 2);

  if (Array.isArray(values)) {
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = THEME.label;
    ctx.fillText(values.join(" "), rect.x + rect.w / 2, rect.y + rect.h - 9);
  }

  // 引脚
  ctx.fillStyle = THEME.partEdge;
  for (let pin = 0; pin < gateArity(gate.type); pin += 1) {
    const point = gateInputPin(gate, pin);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  const out = gateOutputPin(gate);
  ctx.beginPath();
  ctx.arc(out.x, out.y, 4.5, 0, Math.PI * 2);
  ctx.fill();

  if (gate.in.some((src) => src === null)) {
    ctx.strokeStyle = THEME.bad;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    roundRect(ctx, rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6, 11);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function valueColor(value) {
  if (Array.isArray(value)) return THEME.partText;
  if (value === 1) return THEME.ok;
  if (value === 2) return THEME.unknown;
  return THEME.partText;
}

function drawWire(ctx, x1, y1, x2, y2, color) {
  ctx.save();
  ctx.strokeStyle = color ?? THEME.wire;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  const midX = (x1 + x2) / 2;
  ctx.bezierCurveTo(midX, y1, midX, y2, x2, y2);
  ctx.stroke();
  ctx.restore();
}

function label(ctx, text, x, y, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const BOARD_SIZE = BOARD;
export { GATE_SIZE, SOCKET_GAP, SOCKET_Y0 };
