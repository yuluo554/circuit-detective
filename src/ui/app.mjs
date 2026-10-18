// 交互层：拨杆 → 仿真核 → 灯；拼装视图 → 提交 → 结算 → 逐层点亮。
// 观察结果只由 sim.mjs 决定；渲染层与动画时序不参与任何判定。

import { simulate } from "../core/sim.mjs";
import { generateLevel, dailySeed } from "../core/generator.mjs";
import { GATE_TYPES } from "../core/netlist.mjs";
import { countedGates } from "../core/solver.mjs";
import {
  addGate,
  clearDraft,
  connectSignal,
  createDraft,
  disconnectPin,
  gateById,
  moveGate,
  removeGate,
  setOutput,
  toNetlist,
} from "../core/editor.mjs";
import { buildRevealPlan, revealProgress } from "../core/reveal.mjs";
import { bitsToVector, judgeSubmission } from "../core/judge.mjs";
import {
  autoLayout,
  clampToWorkArea,
  freeSlot,
  hitTest,
  inputSocketPoint,
  toBoardPoint,
} from "./layout.mjs";
import { drawBoard, drawProbe } from "./render.mjs";
import {
  CAMPAIGN_LAST,
  campaignIndexFromSeed,
  campaignOptions,
  campaignSeed,
  seedFromDate,
  seedFromLocation,
} from "./level-source.mjs";
import { copyFor } from "./copy.mjs";

const REVEAL_INTERVAL_MS = 520;
const NOTE_PREFIX = "circuit-detective/note/";

const state = {
  level: null,
  seedText: "",
  campaignIndex: null,
  copy: copyFor(null),
  view: "probe",
  values: [0, 0, 0, 0],
  probes: 0,
  probeLog: [],
  probeObservations: [],
  lastVector: null,
  lamps: [0, 0, 0, 0],
  draft: null,
  selected: null,
  source: null,
  dragged: null,
  hover: null,
  submissions: 0,
  settlement: null,
  mismatch: null,
  reveal: null,
  revealTimer: null,
  status: "",
};

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const el = (id) => document.getElementById(id);

function setStatus(text) {
  state.status = text;
  el("status").textContent = text;
}

function setReadout(text, tone = "") {
  const node = el("readout");
  node.textContent = text;
  node.className = `readout${tone ? ` ${tone}` : ""}`;
}

function applyCopy(copy) {
  state.copy = copy;
  el("subtitle").textContent = copy.subtitle;
  el("label-probes").textContent = copy.probesLabel;
  el("label-level").textContent = copy.levelLabel;
  el("label-submissions").textContent = copy.submissionLabel;
  el("view-probe").textContent = copy.viewProbe;
  el("view-build").textContent = copy.viewBuild;
  el("load").textContent = copy.load;
  el("daily").textContent = copy.daily;
  el("share").textContent = copy.share;
  el("submit").textContent = copy.submit;
  el("prev").textContent = copy.prev;
  el("next").textContent = copy.next;
  el("clear").textContent = copy.clear;
  el("delete").textContent = copy.deleteGate;
  el("note-label").textContent = copy.noteLabel;
  el("note").placeholder = copy.notePlaceholder;
  el("seed").placeholder = copy.seedPlaceholder;
  el("settle-your-label").textContent = copy.settlement.yourGates;
  el("settle-optimal-label").textContent = copy.settlement.optimalGates;
  el("settle-diff-label").textContent = copy.settlement.difference;
  el("settle-probes-label").textContent = copy.settlement.probes;
  el("settle-basis").textContent = copy.settlement.basis;
  renderPalette();
}

function renderPalette() {
  el("palette").replaceChildren(
    ...GATE_TYPES.map((type) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.gate = type;
      button.textContent = state.copy.palette[type];
      button.addEventListener("click", () => placePart(type));
      return button;
    }),
  );
}

function placePart(type) {
  if (!state.draft || state.reveal) return;
  const result = addGate(state.draft, type, freeSlot(state.draft));
  if (!result.ok) {
    setReadout(result.errors[0].message, "bad");
    return;
  }
  state.selected = result.id;
  state.source = result.id;
  setView("build");
  setStatus(state.copy.statusBuilding);
  setReadout(state.copy.readout.pickTarget);
  render();
  updatePanel();
}

function loadLevel(seedText) {
  const index = campaignIndexFromSeed(seedText);
  const result = generateLevel(seedText, index ? campaignOptions(index) : {});
  if (!result.ok) {
    setStatus("关卡不可用");
    setReadout(`${result.message}（重抽 ${result.attempts} 次）。换一个种子试试。`, "bad");
    return false;
  }
  stopReveal();
  state.level = result.level;
  state.seedText = String(seedText);
  state.campaignIndex = index;
  state.values = new Array(result.level.inputs.length).fill(0);
  state.probes = 0;
  state.probeLog = [];
  state.probeObservations = [];
  state.lastVector = 0; // 进入关卡时看到的初始向量不算探测
  state.lamps = new Array(result.level.outputs.length).fill(0);
  state.draft = createDraft(result.level);
  state.selected = null;
  state.source = null;
  state.hover = null;
  state.dragged = null;
  state.submissions = 0;
  state.settlement = null;
  state.mismatch = null;
  state.reveal = null;
  applyCopy(copyFor(index));
  el("seed").value = seedText;
  el("level-id").textContent = index ? `关卡 ${index}` : state.level.label;
  el("submissions").textContent = "0";
  el("note").value = readNote(seedText);
  el("settlement").hidden = true;
  setView("probe");
  setStatus(state.copy.statusReady);
  setReadout(index && index <= 3 ? state.copy.readout.introEarly : state.copy.readout.introFull);
  evaluate();
  return true;
}

function readNote(seedText) {
  try {
    return window.localStorage.getItem(`${NOTE_PREFIX}${seedText}`) ?? "";
  } catch {
    return "";
  }
}

function writeNote(text) {
  try {
    if (text) window.localStorage.setItem(`${NOTE_PREFIX}${state.seedText}`, text);
    else window.localStorage.removeItem(`${NOTE_PREFIX}${state.seedText}`);
  } catch {
    // 隐私模式 / 存储已满：笔记降级为本次有效，不阻断玩法。
  }
}

function currentVector() {
  return bitsToVector(state.values);
}

function evaluate() {
  if (!state.level) return;
  const vector = currentVector();
  if (state.lastVector !== null && vector !== state.lastVector) {
    state.probes += 1;
    state.probeLog.push(vector);
  }
  state.lastVector = vector;
  const result = simulate(state.level.netlist, state.values, { recordTrace: false });
  state.lamps = state.level.outputs.map((name) => result.outputs[name] ?? 2);
  state.probeObservations.push({
    vector,
    outputs: Object.fromEntries(state.level.outputs.map((name, index) => [name, state.lamps[index]])),
  });
  el("probes").textContent = String(state.probes);
  updateLampChips();
}

function updateLampChips() {
  if (!state.level) return;
  el("lamps").replaceChildren(
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
  el("probes").textContent = String(state.probes);
  el("submissions").textContent = String(state.submissions);
  updateLampChips();
  el("view-probe").classList.toggle("active", state.view === "probe");
  el("view-build").classList.toggle("active", state.view === "build");
  el("submit").disabled = !state.level || Boolean(state.reveal);
  el("delete").disabled = !state.selected || Boolean(state.reveal);
  el("clear").disabled = !state.draft || state.draft.gates.length === 0 || Boolean(state.reveal);
  el("share").disabled = true;
  el("prev").disabled = !state.campaignIndex || state.campaignIndex <= 1;
  el("next").disabled = !state.campaignIndex || state.campaignIndex >= CAMPAIGN_LAST;
  el("hint").innerHTML = state.view === "probe" ? state.copy.hintProbe : state.copy.hintBuild;
}

function setView(view) {
  state.view = view;
  updatePanel();
  render();
}

/** 拼块上的实时值：用草稿网表跑一次仿真；接线不完整时不显示数字（不参与判定）。 */
function partValues() {
  const netlist = toNetlist(state.draft);
  if (netlist.gates.some((gate) => gate.in.some((pin) => pin === ""))) return {};
  const result = simulate(netlist, state.values, { recordTrace: false });
  return result.ok ? result.gates : {};
}

function render() {
  if (!state.level) return;
  if (state.view === "probe" && !state.reveal) {
    drawProbe(ctx, {
      inputs: state.level.inputs,
      outputs: state.level.outputs,
      values: state.values,
      lamps: state.lamps,
    });
    return;
  }
  const revealed = state.reveal ? state.reveal.revealed : null;
  drawBoard(ctx, {
    draft: state.draft,
    values: state.values,
    selected: state.selected,
    source: state.source,
    hover: state.hover,
    revealed,
    revealLamps: state.reveal ? state.reveal.lamps : null,
    partValues: revealed ? null : partValues(),
    partLabel: (type) => state.copy.part[type] ?? type,
  });
}

function pointerPoint(event) {
  return toBoardPoint(event.clientX, event.clientY, canvas.getBoundingClientRect());
}

function onCanvasPointerDown(event) {
  if (!state.level || state.reveal) return;
  const point = pointerPoint(event);
  if (state.view === "probe") {
    toggleLeverAt(point);
    return;
  }
  const hit = hitTest(point, state.draft);

  if (hit.type === "empty") {
    state.selected = null;
    state.source = null;
    render();
    updatePanel();
    return;
  }
  if (hit.type === "gate") {
    state.selected = hit.gate;
    state.dragged = { id: hit.gate, offset: hit.offset };
    state.source = null;
    render();
    updatePanel();
    return;
  }
  handleConnect(hit);
}

function handleConnect(hit) {
  if (hit.type === "socket" && hit.side === "input") {
    state.source = hit.signal;
    setReadout(`${state.copy.readout.pickSource}（已选：开关 ${hit.signal}）`);
    render();
    return;
  }
  if (hit.type === "socket" && hit.side === "gate") {
    state.source = hit.gate;
    setReadout(state.copy.readout.pickTarget);
    render();
    return;
  }
  // 没有待接来源时，点一个已经接好的入口 = 拆掉这根线（否则玩家只能删掉整个零件）。
  if (!state.source && hit.type === "pin") {
    const gate = hit.gate ? gateById(state.draft, hit.gate) : null;
    const wired =
      hit.target === "output"
        ? state.draft.outputsMap[hit.output] !== null
        : Boolean(gate && gate.in[hit.pin] !== null);
    if (wired) {
      const result =
        hit.target === "output"
          ? setOutput(state.draft, hit.output, null)
          : disconnectPin(state.draft, hit.gate, hit.pin);
      if (!result.ok) {
        setReadout(result.errors[0].message, "bad");
        return;
      }
      setReadout(state.copy.readout.disconnected);
      render();
      updatePanel();
      return;
    }
  }
  if (!state.source) {
    setReadout(state.copy.readout.pickSource);
    return;
  }
  if (hit.type === "pin" && hit.target === "output") {
    reportEdit(connectSignal(state.draft, state.source, { output: hit.output }));
    return;
  }
  if (hit.type === "pin" && hit.gate) {
    reportEdit(connectSignal(state.draft, state.source, { gate: hit.gate, pin: hit.pin }));
    return;
  }
  setReadout(state.copy.readout.noTarget);
}

function reportEdit(result) {
  if (!result.ok) {
    setReadout(result.errors[0].message, "bad");
    return;
  }
  state.source = null;
  setReadout(state.copy.readout.wired);
  render();
  updatePanel();
}

function onCanvasPointerMove(event) {
  if (!state.level || state.reveal || state.view !== "build") return;
  const point = pointerPoint(event);
  if (state.dragged) {
    const gate = gateById(state.draft, state.dragged.id);
    if (!gate) return;
    moveGate(
      state.draft,
      gate.id,
      clampToWorkArea({ x: point.x - state.dragged.offset.x, y: point.y - state.dragged.offset.y }),
    );
    render();
    return;
  }
  const hit = hitTest(point, state.draft);
  state.hover = hit.type === "pin" || hit.type === "socket" ? hit : null;
  render();
}

function onCanvasPointerUp() {
  if (state.dragged) {
    state.dragged = null;
    updatePanel();
  }
}

function toggleLeverAt(point) {
  const index = state.values.findIndex((_, i) => {
    const socket = inputSocketPoint(i);
    return Math.abs(point.x - socket.x) <= 36 && Math.abs(point.y - socket.y) <= 28;
  });
  return index >= 0 ? toggleLeverByIndex(index) : false;
}

function toggleLeverByIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.values.length) return false;
  state.values[index] = state.values[index] === 1 ? 0 : 1;
  evaluate();
  render();
  updatePanel();
  return true;
}

function submit() {
  if (!state.level || state.reveal) return;
  const outcome = judgeSubmission(state.draft, state.level, { probes: state.probes });
  state.submissions += 1;
  el("submissions").textContent = String(state.submissions);
  if (!outcome.accepted) {
    state.settlement = null;
    state.mismatch = outcome.mismatch;
    el("settlement").hidden = true;
    if (outcome.reason === "mismatch") {
      setReadout(
        `${state.copy.rejectedHead} · ${state.copy.mismatch({
          ...outcome.mismatch,
          outputLabel: mismatchLabel(outcome.mismatch.output),
        })}`,
        "bad",
      );
    } else if (outcome.reason === "invalid-draft") {
      setReadout(`${state.copy.invalidDraft} ${outcome.errors.map((item) => item.message).join("；")}`, "bad");
    } else {
      setReadout(outcome.errors.map((item) => item.message).join("；"), "bad");
    }
    setStatus(state.copy.statusBuilding);
    render();
    return;
  }
  state.mismatch = null;
  state.settlement = outcome.settlement;
  fillSettlement(outcome.settlement);
  startReveal();
}

function mismatchLabel(name) {
  const index = state.level.outputs.indexOf(name);
  return index >= 0 ? `${index + 1} 号灯` : name;
}

function fillSettlement(settlement) {
  el("settle-your").textContent = String(settlement.yourGates);
  el("settle-optimal").textContent = String(settlement.optimalGates);
  el("settle-diff").textContent = `${settlement.difference} ${state.copy.diffSuffix}`;
  el("settle-probes").textContent = String(settlement.probes);
  el("settlement-head").textContent = state.copy.acceptedHead;
  el("settlement").hidden = false;
}

/**
 * 逐层点亮：揭示集合只增不减，层号严格递增；灯在它的来源门被揭示后亮起。
 * prefers-reduced-motion 时直接终态（不动画、不延时）。
 */
function startReveal() {
  stopReveal();
  const plan = buildRevealPlan(state.level.netlist);
  const laidOut = autoLayout(state.level.netlist);
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const total = plan.layers.length;

  // 揭示态复用同一个画布：把隐藏网表按层级摆好，交由 revealed 集合控制可见性。
  state.draft = {
    inputs: [...state.level.inputs],
    outputs: [...state.level.outputs],
    gates: laidOut.gates.map((gate) => ({ ...gate, in: [...gate.in] })),
    outputsMap: { ...state.level.netlist.outputsMap },
    nextGateNumber: laidOut.gates.length + 1,
  };
  state.view = "build";
  state.selected = null;
  state.source = null;
  state.reveal = { plan, step: 0, total, revealed: new Set(), lamps: new Array(state.lamps.length).fill(0) };
  setStatus(state.copy.statusReveal);

  if (reduced || total === 0) {
    for (let step = 1; step <= total; step += 1) advanceReveal(step);
    finishReveal();
    return;
  }
  advanceReveal(0);
  state.revealTimer = window.setInterval(() => {
    const next = state.reveal.step + 1;
    advanceReveal(next);
    if (state.reveal.step >= total) finishReveal();
  }, REVEAL_INTERVAL_MS);
}

function advanceReveal(step) {
  const { plan } = state.reveal;
  const progress = revealProgress(plan, step);
  state.reveal.step = step;
  state.reveal.revealed = progress.revealed;
  state.reveal.lamps = state.level.outputs.map((name) => {
    const src = state.level.netlist.outputsMap[name];
    const visible = !state.level.netlist.gates.some((gate) => gate.id === src) || progress.revealed.has(src);
    const index = state.level.outputs.indexOf(name);
    return visible ? state.lamps[index] : 0;
  });
  setReadout(state.copy.revealLayer(step, plan.layers.length));
  render();
  updatePanel();
}

function finishReveal() {
  stopReveal();
  if (!state.reveal) return;
  state.reveal.lamps = [...state.lamps];
  state.reveal.revealed = new Set(state.reveal.plan.order);
  setStatus(state.copy.statusSettled);
  setReadout(`${state.copy.revealDone} · ${state.copy.nextHint}`, "good");
  render();
  updatePanel();
}

function stopReveal() {
  if (state.revealTimer) {
    window.clearInterval(state.revealTimer);
    state.revealTimer = null;
  }
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture?.(event.pointerId);
  onCanvasPointerDown(event);
});
canvas.addEventListener("pointermove", onCanvasPointerMove);
canvas.addEventListener("pointerup", onCanvasPointerUp);
canvas.addEventListener("pointercancel", onCanvasPointerUp);
canvas.addEventListener("keydown", (event) => {
  if (!state.level) return;
  if (state.view === "probe" && !state.reveal) {
    const index = Number(event.key) - 1;
    if (Number.isInteger(index)) {
      event.preventDefault();
      toggleLeverByIndex(index);
    }
    return;
  }
  if (state.reveal) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    if (!state.selected) return;
    event.preventDefault();
    removeGate(state.draft, state.selected);
    state.selected = null;
    state.source = null;
    render();
    updatePanel();
    return;
  }
  if (event.key.startsWith("Arrow") && state.selected) {
    const gate = gateById(state.draft, state.selected);
    if (!gate) return;
    const step = 32;
    const delta = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    moveGate(state.draft, gate.id, clampToWorkArea({ x: gate.x + delta.x, y: gate.y + delta.y }));
    render();
  }
});

el("view-probe").addEventListener("click", () => setView("probe"));
el("view-build").addEventListener("click", () => setView("build"));
el("submit").addEventListener("click", submit);
el("clear").addEventListener("click", () => {
  if (!state.draft || state.reveal) return;
  clearDraft(state.draft);
  state.selected = null;
  state.source = null;
  setReadout(state.copy.empty);
  render();
  updatePanel();
});
el("delete").addEventListener("click", () => {
  if (!state.draft || !state.selected || state.reveal) return;
  removeGate(state.draft, state.selected);
  state.selected = null;
  state.source = null;
  render();
  updatePanel();
});

el("load").addEventListener("click", () => {
  const seed = el("seed").value.trim() || "0";
  if (loadLevel(seed)) history.replaceState(null, "", `#s=${encodeURIComponent(seed)}`);
});

el("daily").addEventListener("click", () => {
  const seed = seedFromDate(new Date());
  if (loadLevel(seed)) {
    setStatus("今日题");
    history.replaceState(null, "", `#s=${encodeURIComponent(seed)}`);
  }
});

el("prev").addEventListener("click", () => {
  if (state.campaignIndex && state.campaignIndex > 1) goCampaign(state.campaignIndex - 1);
});
el("next").addEventListener("click", () => {
  if (state.campaignIndex && state.campaignIndex < CAMPAIGN_LAST) goCampaign(state.campaignIndex + 1);
});

function goCampaign(index) {
  const seed = campaignSeed(index);
  if (loadLevel(seed)) history.replaceState(null, "", `#s=${encodeURIComponent(seed)}`);
}

el("share").addEventListener("click", () => {
  setReadout(state.copy.readout.summary(state.probes));
});

el("note").addEventListener("input", () => writeNote(el("note").value));

// 只读快照：供无头浏览器冒烟与测试读取，不含任何判定逻辑。
function snapshot() {
  return {
    view: state.view,
    seed: state.seedText,
    campaignIndex: state.campaignIndex,
    probes: state.probes,
    probeLog: [...state.probeLog],
    probeObservations: state.probeObservations.map((row) => ({
      vector: row.vector,
      outputs: { ...row.outputs },
    })),
    values: [...state.values],
    lamps: [...state.lamps],
    submissions: state.submissions,
    settlement: state.settlement ? { ...state.settlement } : null,
    mismatch: state.mismatch ? { ...state.mismatch } : null,
    reveal: state.reveal
      ? {
          step: state.reveal.step,
          total: state.reveal.total,
          layers: state.reveal.plan.layers.map((layer) => [...layer]),
          revealed: [...state.reveal.revealed],
          lamps: [...state.reveal.lamps],
        }
      : null,
    draft: state.draft
      ? {
          gates: state.draft.gates.map((gate) => ({
            id: gate.id,
            type: gate.type,
            in: [...gate.in],
            x: gate.x,
            y: gate.y,
          })),
          outputsMap: { ...state.draft.outputsMap },
        }
      : null,
  };
}

window.__circuitDetective = Object.freeze({
  snapshot,
  revealPlan: () => (state.reveal ? state.reveal.plan.layers.map((layer) => [...layer]) : null),
  draftNetlist: () => (state.draft ? toNetlist(state.draft) : null),
  counts: () => (state.draft ? countedGates(toNetlist(state.draft)) : null),
});

loadLevel(seedFromLocation(window.location) || dailySeed(seedFromDate(new Date())));
