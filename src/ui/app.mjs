// 交互层：拨杆 → 仿真核 → 灯。探测计数只统计"输入向量发生变化"。
// 观察结果只由 sim.mjs 决定，渲染层与动画时序不参与。

import { simulate } from "../core/sim.mjs";
import { generateLevel, dailySeed } from "../core/generator.mjs";
import { seedFromDate, seedFromLocation } from "./level-source.mjs";
import { drawBoard } from "./render.mjs";

const LEVER_HIT = { x: 150, y0: 150, gap: 82, halfW: 34, halfH: 26 };

const state = {
  level: null,
  values: [0, 0, 0, 0],
  probes: 0,
  lastVector: null,
  lamps: [0, 0, 0, 0],
  status: "",
};

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const probesEl = document.getElementById("probes");
const levelEl = document.getElementById("level-id");
const lampsEl = document.getElementById("lamps");
const statusEl = document.getElementById("status");
const seedEl = document.getElementById("seed");
const readoutEl = document.getElementById("readout");
const shareBtn = document.getElementById("share");

function setStatus(text) {
  statusEl.textContent = text;
}

function loadLevel(seed) {
  const result = generateLevel(seed);
  if (!result.ok) {
    setStatus("关卡不可用");
    readoutEl.textContent = `${result.message}（重抽 ${result.attempts} 次）。换一个种子试试。`;
    return false;
  }
  state.level = result.level;
  state.values = new Array(result.level.inputs.length).fill(0);
  state.probes = 0;
  state.lastVector = 0; // 进入关卡时观察到的初始向量是 0000，不计为探测
  state.lamps = new Array(result.level.outputs.length).fill(0);
  seedEl.value = result.level.label;
  levelEl.textContent = `#${result.level.label}`;
  setStatus("黑盒已就绪");
  evaluate();
  render();
  updatePanel();
  return true;
}

function currentVector() {
  return state.values.reduce((acc, bit, index) => acc | (bit << (state.values.length - 1 - index)), 0);
}

function evaluate() {
  if (!state.level) return;
  const vector = currentVector();
  if (state.lastVector !== null && vector !== state.lastVector) {
    state.probes += 1;
  }
  state.lastVector = vector;
  const result = simulate(state.level.netlist, state.values, { recordTrace: false });
  state.lamps = state.level.outputs.map((name) => result.outputs[name] ?? 2);
  probesEl.textContent = String(state.probes);
  updateLampChips();
}

function updateLampChips() {
  lampsEl.replaceChildren(
    ...state.level.outputs.map((name, index) => {
      const value = state.lamps[index];
      const chip = document.createElement("span");
      chip.className = `lamp-chip${value === 1 ? " on" : value === 2 ? " x" : ""}`;
      chip.textContent = `${index + 1}: ${value === 2 ? "?" : value}`;
      return chip;
    }),
  );
}

function updatePanel() {
  probesEl.textContent = String(state.probes);
  updateLampChips();
  const shareable = state.probes > 0;
  shareBtn.disabled = !shareable;
  readoutEl.textContent = shareable
    ? `已试探 ${state.probes} 次。分享码在 M4 接入；当前探测序列可按 seed + 拨动顺序复算。`
    : "骨架阶段：拨杆与灯已接通确定性仿真核；门编辑器与提交判定在 M3 接入。";
}

function render() {
  if (!state.level) return;
  drawBoard(ctx, {
    inputs: state.level.inputs,
    outputs: state.level.outputs,
    values: state.values,
    lamps: state.lamps,
  });
}

function toggleAt(canvasX, canvasY) {
  const scale = canvas.width / canvas.getBoundingClientRect().width;
  const x = canvasX * scale;
  const y = canvasY * scale;
  for (let index = 0; index < state.values.length; index += 1) {
    const cy = LEVER_HIT.y0 + index * LEVER_HIT.gap;
    if (Math.abs(x - LEVER_HIT.x) <= LEVER_HIT.halfW && Math.abs(y - cy) <= LEVER_HIT.halfH) {
      state.values[index] = state.values[index] === 1 ? 0 : 1;
      evaluate();
      render();
      updatePanel();
      return true;
    }
  }
  return false;
}

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  toggleAt(event.clientX - rect.left, event.clientY - rect.top);
});

canvas.addEventListener("keydown", (event) => {
  const index = Number(event.key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < state.values.length) {
    state.values[index] = state.values[index] === 1 ? 0 : 1;
    evaluate();
    render();
    updatePanel();
  }
});
canvas.tabIndex = 0;

document.getElementById("load").addEventListener("click", () => {
  const seed = seedEl.value.trim() || "0";
  loadLevel(seed);
  history.replaceState(null, "", `#s=${encodeURIComponent(seed)}`);
});

document.getElementById("daily").addEventListener("click", () => {
  const seed = seedFromDate(new Date());
  if (loadLevel(seed)) {
    setStatus("今日题");
    history.replaceState(null, "", `#s=${encodeURIComponent(seed)}`);
  }
});

shareBtn.addEventListener("click", () => {
  readoutEl.textContent = "分享码（M4）：短码编码器已实现并通过测试，界面接线在 M4 完成。";
});

const initialSeed = seedFromLocation(window.location);
loadLevel(initialSeed || dailySeed(seedFromDate(new Date())));
seedEl.placeholder = "输入种子，例如 2026-10-19";
