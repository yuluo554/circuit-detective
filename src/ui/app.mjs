// 交互层：拨杆 → 仿真核 → 灯；拼装视图 → 提交 → 结算 → 逐层点亮；`#r=` 短码 → 只读回放。
// 观察结果只由 sim.mjs 决定；渲染层与动画时序不参与任何判定。

import { simulate } from "../core/sim.mjs";
import { generateLevel } from "../core/generator.mjs";
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
import { decodeReplay, sharePayload } from "../core/share.mjs";
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
  routeFromLocation,
  seedFromDate,
} from "./level-source.mjs";
import { copyFor, replayCopy } from "./copy.mjs";

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
  replay: null,
  revealTimer: null,
  status: "",
};

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const el = (id) => document.getElementById(id);

/** 揭示态与回放态都是只读态：编辑器、提交、清空、摆件一律锁死。 */
function readOnly() {
  return Boolean(state.reveal) || Boolean(state.replay);
}

/** 播放时钟：揭示动画与回放共用同一个计时器字段（两者不会同时跑）。 */
function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

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
  if (!state.draft || readOnly()) return;
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
  state.replay = null;
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

function canShare() {
  // 分享文案要含"门数差"，所以只在结算之后可用；回放态本身已经是码，不再重复分享。
  return Boolean(state.level && state.settlement && !state.replay);
}

function updatePanel() {
  const locked = readOnly();
  el("probes").textContent = String(state.probes);
  el("submissions").textContent = String(state.submissions);
  updateLampChips();
  el("view-probe").classList.toggle("active", state.view === "probe");
  el("view-build").classList.toggle("active", state.view === "build");
  el("submit").disabled = !state.level || locked;
  el("delete").disabled = !state.selected || locked;
  el("clear").disabled = !state.draft || state.draft.gates.length === 0 || locked;
  el("share").disabled = !canShare();
  el("prev").disabled = !state.campaignIndex || state.campaignIndex <= 1;
  el("next").disabled = !state.campaignIndex || state.campaignIndex >= CAMPAIGN_LAST;
  for (const button of el("palette").querySelectorAll("button")) button.disabled = locked || !state.level;
  el("hint").innerHTML = state.replay
    ? state.copy.hintReplay
    : state.view === "probe"
      ? state.copy.hintProbe
      : state.copy.hintBuild;
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

/** 只读叠加层（结算揭示 / 短码回放）：决定哪些门可见、灯显示成什么值。 */
function overlay() {
  if (state.reveal) return { revealed: state.reveal.revealed, lamps: state.reveal.lamps };
  if (state.replay) return { revealed: state.replay.revealed, lamps: state.replay.lamps };
  return null;
}

function render() {
  if (!state.level) return;
  const shown = overlay();
  if (state.view === "probe" && !shown) {
    drawProbe(ctx, {
      inputs: state.level.inputs,
      outputs: state.level.outputs,
      values: state.values,
      lamps: state.lamps,
    });
    return;
  }
  drawBoard(ctx, {
    draft: state.draft,
    values: state.values,
    selected: state.selected,
    source: state.source,
    hover: state.hover,
    revealed: shown ? shown.revealed : null,
    revealLamps: shown ? shown.lamps : null,
    partValues: shown ? null : partValues(),
    partLabel: (type) => state.copy.part[type] ?? type,
  });
}

function pointerPoint(event) {
  return toBoardPoint(event.clientX, event.clientY, canvas.getBoundingClientRect());
}

function onCanvasPointerDown(event) {
  if (!state.level || readOnly()) return;
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
  if (!state.level || readOnly() || state.view !== "build") return;
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
  if (readOnly()) return false;
  if (!Number.isInteger(index) || index < 0 || index >= state.values.length) return false;
  state.values[index] = state.values[index] === 1 ? 0 : 1;
  evaluate();
  render();
  updatePanel();
  return true;
}

function submit() {
  if (!state.level || readOnly()) return;
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
  const reduced = prefersReducedMotion();
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

// —— 短码回放（M4）——
// 进入回放不重新生成关卡、不重新计数：探测序列与灯值全部由短码里的网表重算，
// 播放只是把已经算好的步表按时间摊开，因此同一条短码在任何实例上逐项相同。

function clearBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/** 短码不可用（篡改 / 截断 / 版本不兼容 / 非法字符）：明确提示，不静默进普通关卡。 */
function showReplayError(error) {
  stopReveal();
  state.level = null;
  state.draft = null;
  state.reveal = null;
  state.replay = null;
  state.settlement = null;
  state.mismatch = null;
  state.seedText = "";
  state.campaignIndex = null;
  state.probes = 0;
  state.probeLog = [];
  state.probeObservations = [];
  state.lamps = [0, 0, 0, 0];
  state.values = [0, 0, 0, 0];
  applyCopy(replayCopy());
  el("seed").value = "";
  el("level-id").textContent = "—";
  el("submissions").textContent = "0";
  el("settlement").hidden = true;
  el("lamps").replaceChildren();
  el("status").textContent = state.copy.statusReplayError;
  setReadout(`${state.copy.replayBad(String((error && error.message) || error))} ${state.copy.replayHint}`, "bad");
  clearBoard();
  updatePanel();
}

/** 短码 → 只读回放态。返回是否进入成功。 */
function enterReplay(code) {
  let decoded;
  try {
    decoded = decodeReplay(code);
  } catch (error) {
    showReplayError(error);
    return false;
  }
  stopReveal();
  state.level = decoded.level;
  state.seedText = decoded.seedText;
  state.campaignIndex = null;
  state.values = new Array(decoded.level.inputs.length).fill(0);
  state.probes = decoded.probes.length; // 回放是对已有探测的重演，不新增计数
  state.probeLog = [...decoded.probes];
  state.probeObservations = decoded.steps.map((row) => ({ vector: row.vector, outputs: { ...row.outputs } }));
  state.lastVector = null;
  state.lamps = new Array(decoded.level.outputs.length).fill(0);
  state.submissions = 0;
  state.settlement = null;
  state.mismatch = null;
  state.reveal = null;
  state.selected = null;
  state.source = null;
  state.hover = null;
  state.dragged = null;

  const laidOut = autoLayout(decoded.level.netlist);
  state.draft = {
    inputs: [...decoded.level.inputs],
    outputs: [...decoded.level.outputs],
    gates: laidOut.gates.map((gate) => ({ ...gate, in: [...gate.in] })),
    outputsMap: { ...decoded.level.netlist.outputsMap },
    nextGateNumber: laidOut.gates.length + 1,
  };
  const plan = buildRevealPlan(decoded.level.netlist);
  state.replay = {
    code,
    version: decoded.version,
    seedText: decoded.seedText,
    optimal: decoded.optimal,
    probes: [...decoded.probes],
    steps: decoded.steps,
    plan,
    total: decoded.probes.length,
    totalTicks: Math.max(decoded.probes.length, plan.layers.length),
    tick: 0,
    step: 0,
    revealed: new Set(),
    lamps: new Array(decoded.level.outputs.length).fill(0),
  };

  applyCopy(replayCopy());
  el("seed").value = state.seedText;
  el("level-id").textContent = state.copy.replayLabel;
  el("submissions").textContent = "0";
  el("settlement").hidden = true;
  el("note").value = "";
  setView("build");
  setStatus(state.copy.statusReplay);
  setReadout(state.copy.readout.replayReady(state.replay.total, state.draft.gates.length));
  startReplayClock();
  return true;
}

/** 把播放进度摊到 tick 上：探测步与揭示层数都随 tick 单调推进，末尾同时到终态。 */
function advanceReplay(tick) {
  const replay = state.replay;
  if (!replay) return;
  const clamped = Math.max(0, Math.min(tick, replay.totalTicks));
  const step = Math.min(clamped, replay.total);
  const layers = Math.min(clamped, replay.plan.layers.length);
  replay.tick = clamped;
  replay.step = step;

  const row = step > 0 ? replay.steps[step - 1] : null;
  state.values = row ? [...row.inputs] : new Array(state.level.inputs.length).fill(0);
  const lamps = row
    ? state.level.outputs.map((name) => row.outputs[name])
    : new Array(state.level.outputs.length).fill(0);
  state.lamps = lamps;
  replay.revealed = revealProgress(replay.plan, layers).revealed;
  // 灯只在它的来源门被揭晓后才亮，避免回放把还没亮到的部分提前泄漏。
  replay.lamps = state.level.outputs.map((name) => {
    const src = state.level.netlist.outputsMap[name];
    const known = !state.level.netlist.gates.some((gate) => gate.id === src) || replay.revealed.has(src);
    return known ? lamps[state.level.outputs.indexOf(name)] : 0;
  });

  setReadout(state.copy.readout.replayStep(step, replay.total));
  render();
  updatePanel();
}

function startReplayClock() {
  stopReveal();
  const replay = state.replay;
  const ticks = replay.totalTicks;
  if (prefersReducedMotion() || ticks === 0) {
    advanceReplay(ticks);
    finishReplayClock();
    return;
  }
  advanceReplay(0);
  state.revealTimer = window.setInterval(() => {
    const next = replay.tick + 1;
    advanceReplay(next);
    if (next >= ticks) finishReplayClock();
  }, REVEAL_INTERVAL_MS);
}

function finishReplayClock() {
  stopReveal();
  if (!state.replay) return;
  setStatus(state.copy.statusReplayDone);
  setReadout(state.copy.readout.replayDone, "good");
  render();
  updatePanel();
}

/** 手动逐步（左右方向键）：手一动就停自动播放，停在当前 tick。 */
function stepReplay(delta) {
  if (!state.replay) return false;
  stopReveal();
  setStatus(state.copy.statusReplay);
  advanceReplay(state.replay.tick + delta);
  if (state.replay.tick >= state.replay.totalTicks) finishReplayClock();
  return true;
}

function copyText(text) {
  try {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") return;
    const pending = clipboard.writeText(text);
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch {
    // file:// 或权限受限：剪贴板不可用，文案已经贴在 readout 里，手动复制。
  }
}

/** 分享：探测次数 + 门数差 + 短码；短码超长时降级为"种子 + 探测次数"。 */
function shareCurrent() {
  if (!canShare()) return;
  const payload = sharePayload({
    seed: state.seedText,
    probes: state.probeLog,
    netlist: state.level.netlist,
    difference: state.settlement.difference,
  });
  const text = payload.ok
    ? state.copy.shareText({ probes: payload.probes, difference: payload.difference, code: payload.code })
    : state.copy.shareFallbackText({ probes: payload.probes, seed: state.seedText });
  copyText(text);
  const head = payload.ok
    ? state.copy.shareCopied
    : `${state.copy.shareDegraded}（${payload.message}） ${state.copy.shareManual}`;
  setReadout(`${head} ${text}`, payload.ok ? "good" : "");
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
  if (state.replay) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      stepReplay(event.key === "ArrowRight" ? 1 : -1);
    }
    return;
  }
  if (state.view === "probe" && !readOnly()) {
    const index = Number(event.key) - 1;
    if (Number.isInteger(index)) {
      event.preventDefault();
      toggleLeverByIndex(index);
    }
    return;
  }
  if (readOnly()) return;
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
  if (!state.draft || readOnly()) return;
  clearDraft(state.draft);
  state.selected = null;
  state.source = null;
  setReadout(state.copy.empty);
  render();
  updatePanel();
});
el("delete").addEventListener("click", () => {
  if (!state.draft || !state.selected || readOnly()) return;
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

el("share").addEventListener("click", shareCurrent);

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
    replay: state.replay
      ? {
          code: state.replay.code,
          version: state.replay.version,
          seedText: state.replay.seedText,
          optimal: state.replay.optimal,
          probes: [...state.replay.probes],
          steps: state.replay.steps.map((row) => ({
            vector: row.vector,
            inputs: [...row.inputs],
            outputs: { ...row.outputs },
            ok: row.ok,
            stable: row.stable,
          })),
          step: state.replay.step,
          total: state.replay.total,
          tick: state.replay.tick,
          totalTicks: state.replay.totalTicks,
          layers: state.replay.plan.layers.map((layer) => [...layer]),
          revealed: [...state.replay.revealed],
          lamps: [...state.replay.lamps],
        }
      : null,
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

// 入口路由：`#r=` 短码优先进入只读回放；否则按 `#s=` 种子（缺省 = 今日题）开一关。
// 失败路径（短码不可用）由 enterReplay 明确提示，不会退化成普通关卡。
const route = routeFromLocation(window.location);
if (route.kind === "replay") enterReplay(route.code);
else loadLevel(route.seed);
