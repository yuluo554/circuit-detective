#!/usr/bin/env node
// 校验器：一条命令跑全量自检。
//   ① 仿真核与独立第二实现交叉验证（全量 fixture × 全输入组合）
//   ② 10,000 seed 关卡生成：p50 / p99 + 失败数 + 多解/无解数
//   ③ 求解器复核通过率（重新算一遍最优门数）
//   ④ 跨进程回放一致率（编码 → 子进程解码/重演 → 逐项比对）
//   ⑤ 构建产物静态扫描（零外链、体积、gzip）
// 判定只看通过率 / 差异数 / 外链数；耗时只报告，不参与判定。

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { simulate, truthTableMasks, inputCombinations } from "../src/core/sim.mjs";
import { referenceSimulate } from "../tests/reference/sim-reference.mjs";
import { generateLevel } from "../src/core/generator.mjs";
import { countedGates, optimalNetlist, solveOptimal } from "../src/core/solver.mjs";
import { encodeRecord, decodeRecord } from "../src/core/replay.mjs";
import { decodeReplay, sharePayload } from "../src/core/share.mjs";
import { buildRevealPlan, revealSequence } from "../src/core/reveal.mjs";
import { addGate, connectSignal, createDraft, toNetlist, validateDraft } from "../src/core/editor.mjs";
import { judgeSubmission, recomputeProbes } from "../src/core/judge.mjs";
import { copyFor, forbiddenTermHits } from "../src/ui/copy.mjs";
import { campaignOptions, campaignSeed } from "../src/ui/level-source.mjs";
import { build } from "./build.mjs";
import { buildFixtures } from "./gen-fixtures.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_COUNT = 10000;
const EXTERNAL_RE = /https?:\/\//gi;

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[index];
}

function checkSimCross() {
  const fixtures = JSON.parse(readFileSync(join(ROOT, "data", "fixtures", "netlists.json"), "utf8"));
  let comparisons = 0;
  let differences = 0;
  const samples = [];
  for (const fixture of fixtures.fixtures) {
    for (const vector of inputCombinations(fixture.netlist.inputs.length)) {
      const actual = simulate(fixture.netlist, vector, { recordTrace: false });
      const reference = referenceSimulate(fixture.netlist, vector);
      comparisons += 1;
      if (!actual.ok) {
        differences += 1;
        if (samples.length < 5) samples.push({ index: fixture.index, reason: "invalid-netlist" });
        continue;
      }
      let same = true;
      for (const name of fixture.netlist.outputs) {
        if (actual.outputs[name] !== reference.outputs[name]) same = false;
      }
      for (const gate of fixture.netlist.gates) {
        if (actual.gates[gate.id] !== reference.gateValues[gate.id]) same = false;
      }
      if (!same) {
        differences += 1;
        if (samples.length < 5) samples.push({ index: fixture.index, vector });
      }
    }
  }
  return {
    name: "sim.cross",
    pass: differences === 0,
    detail: { fixtures: fixtures.fixtures.length, comparisons, differences },
    samples,
  };
}

function checkFixtureByteStability() {
  const onDisk = readFileSync(join(ROOT, "data", "fixtures", "netlists.json"), "utf8");
  const regenerated = `${JSON.stringify(
    { format: "circuit-detective/fixtures", version: 1, seed: "circuit-detective/fixtures/v1", fixtures: buildFixtures() },
    null,
    1,
  )}\n`;
  return {
    name: "fixtures.bytes",
    pass: onDisk === regenerated,
    detail: { identical: onDisk === regenerated },
    samples: [],
  };
}

function checkGeneration() {
  const times = [];
  const optimalSeen = {};
  let failed = 0;
  let ambiguous = 0;
  let solverMismatch = 0;
  const samples = [];
  for (let seed = 0; seed < SEED_COUNT; seed += 1) {
    const start = process.hrtime.bigint();
    const result = generateLevel(seed);
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
    if (!result.ok) {
      failed += 1;
      if (samples.length < 5) samples.push({ seed, reason: result.code });
      continue;
    }
    const { masks, hasX } = truthTableMasks(result.level.netlist);
    if (Object.values(hasX).some(Boolean)) {
      ambiguous += 1;
      if (samples.length < 5) samples.push({ seed, reason: "contains-X" });
      continue;
    }
    const recheck = solveOptimal(masks, result.level.inputs.length, 12);
    if (recheck.optimal !== result.level.optimal) {
      solverMismatch += 1;
      if (samples.length < 5) samples.push({ seed, reason: "solver-mismatch", stored: result.level.optimal, recheck: recheck.optimal });
    }
    optimalSeen[result.level.optimal] = (optimalSeen[result.level.optimal] ?? 0) + 1;
  }
  times.sort((a, b) => a - b);
  const recheckTotal = SEED_COUNT - failed - ambiguous;
  const passRate = recheckTotal === 0 ? 0 : (recheckTotal - solverMismatch) / recheckTotal;
  return {
    name: "level.generation",
    pass: failed === 0 && ambiguous === 0 && recheckTotal > 0 && passRate === 1,
    detail: {
      seeds: SEED_COUNT,
      failed,
      ambiguous,
      solverRecheckTotal: recheckTotal,
      solverRecheckMismatch: solverMismatch,
      solverRecheckPassRate: passRate,
      p50ms: Number(percentile(times, 0.5).toFixed(3)),
      p99ms: Number(percentile(times, 0.99).toFixed(3)),
      optimalHistogram: optimalSeen,
    },
    samples,
  };
}

function checkReplay() {
  const cases = [
    { seed: "2026-10-19", probes: [0, 1, 2, 3, 15, 7] },
    { seed: 42, probes: [1, 1, 0, 9] },
    { seed: "leaderboard-free", probes: [15, 0] },
  ];
  let mismatches = 0;
  const samples = [];
  for (const item of cases) {
    const generated = generateLevel(item.seed);
    if (!generated.ok) {
      mismatches += 1;
      samples.push({ seed: String(item.seed), reason: "generation-failed" });
      continue;
    }
    const record = { seed: generated.level.seed, probes: item.probes, netlist: generated.level.netlist };
    const code = encodeRecord(record);
    const local = decodeRecord(code);
    const localOutputs = item.probes.map((vector) => {
      const bits = [3, 2, 1, 0].map((shift) => (vector >> shift) & 1);
      return simulate(local.netlist, bits, { recordTrace: false }).outputs;
    });

    const child = execFileSync(
      process.execPath,
      [join(ROOT, "tools", "replay-child.mjs")],
      { input: JSON.stringify({ code, probes: item.probes }), encoding: "utf8" },
    );
    const remote = JSON.parse(child);
    const remoteOutputs = remote.outputs.map((item) => item.outputs);
    if (JSON.stringify(localOutputs) !== JSON.stringify(remoteOutputs)) {
      mismatches += 1;
      samples.push({ seed: String(item.seed), reason: "cross-instance-mismatch" });
    }
    if (code.length > 64) {
      mismatches += 1;
      samples.push({ seed: String(item.seed), reason: "code-too-long", length: code.length });
    }
  }
  return {
    name: "replay.crossInstance",
    pass: mismatches === 0,
    detail: { cases: cases.length, mismatches, consistency: (cases.length - mismatches) / cases.length },
    samples,
  };
}

/**
 * M4 分享闭环：结算记录 → 分享短码 → 解码 → 重演。
 * 判定项：逐项一致率 100%、短码 ≤64、篡改一位必被识别（不许静默回放成别的关卡）。
 */
function checkShareRoundtrip() {
  const CASES = 200;
  const PROBE_SEQ = [0, 1, 2, 3, 15, 8, 7, 11, 4, 12];
  let encoded = 0;
  let stepsMismatch = 0;
  let netlistMismatch = 0;
  let optimalMismatch = 0;
  let tooLong = 0;
  let tamperBlind = 0;
  let maxCodeLength = 0;
  const samples = [];

  for (let seed = 0; seed < CASES; seed += 1) {
    const generated = generateLevel(seed);
    if (!generated.ok) continue;
    const { level } = generated;
    const payload = sharePayload({ seed: level.seed, probes: PROBE_SEQ, netlist: level.netlist, difference: 0 });
    if (!payload.ok) {
      tooLong += 1;
      if (samples.length < 5) samples.push({ seed, reason: "share-degraded", message: payload.message });
      continue;
    }
    encoded += 1;
    maxCodeLength = Math.max(maxCodeLength, payload.code.length);
    if (payload.code.length > 64) {
      tooLong += 1;
      if (samples.length < 5) samples.push({ seed, reason: "code-too-long", length: payload.code.length });
    }

    const replay = decodeReplay(payload.code);
    if (JSON.stringify(replay.steps) !== JSON.stringify(recomputeProbes(level, PROBE_SEQ))) {
      stepsMismatch += 1;
      if (samples.length < 5) samples.push({ seed, reason: "steps-mismatch" });
    }
    if (JSON.stringify(replay.level.netlist) !== JSON.stringify(level.netlist)) {
      netlistMismatch += 1;
      if (samples.length < 5) samples.push({ seed, reason: "netlist-mismatch" });
    }
    if (replay.optimal !== level.optimal) {
      optimalMismatch += 1;
      if (samples.length < 5) samples.push({ seed, reason: "optimal-mismatch", got: replay.optimal, want: level.optimal });
    }

    // 篡改一位必须解码失败：宁可报错，也不能回放成另一个关卡。
    const index = Math.floor(payload.code.length / 2);
    const swapped = payload.code[index] === "A" ? "B" : "A";
    const tampered = `${payload.code.slice(0, index)}${swapped}${payload.code.slice(index + 1)}`;
    let recognised = false;
    try {
      decodeReplay(tampered);
    } catch {
      recognised = true;
    }
    if (!recognised) {
      tamperBlind += 1;
      if (samples.length < 5) samples.push({ seed, reason: "tamper-blind" });
    }
  }

  const pass =
    encoded === CASES &&
    stepsMismatch === 0 &&
    netlistMismatch === 0 &&
    optimalMismatch === 0 &&
    tooLong === 0 &&
    tamperBlind === 0;

  return {
    name: "share.roundtrip",
    pass,
    detail: {
      cases: CASES,
      encoded,
      consistency: encoded === 0 ? 0 : (encoded - stepsMismatch) / encoded,
      stepsMismatch,
      netlistMismatch,
      optimalMismatch,
      tooLong,
      tamperBlind,
      maxCodeLength,
      probesPerCase: PROBE_SEQ.length,
    },
    samples,
  };
}

function checkBuild() {
  const { html, bytes } = build({ write: false });
  const external = [...html.matchAll(EXTERNAL_RE)].length;
  const gzipBytes = gzipSync(Buffer.from(html, "utf8"), { level: 9 }).length;
  const missingBones = ["黑盒电路侦探", 'id="board"'].filter((needle) => !html.includes(needle));
  return {
    name: "build.static",
    pass: external === 0 && missingBones.length === 0 && html.includes("<script type=\"module\">"),
    detail: { bytes, gzipBytes, externalLinks: external, missingBones },
    samples: [],
  };
}

/** 在编辑器里原样重建生成器产出的网表（不做任何"理解"，只搬接线）。 */
function rebuildThroughEditor(level) {
  const draft = createDraft(level);
  const idMap = new Map();
  for (const gate of level.netlist.gates) {
    const result = addGate(draft, gate.type, { x: 320, y: 200 });
    if (!result.ok) return { ok: false, reason: result.errors[0]?.code ?? "add-failed" };
    idMap.set(gate.id, result.id);
    gate.in.forEach((src, pin) => {
      const connected = connectSignal(draft, idMap.get(src) ?? src, { gate: result.id, pin });
      if (!connected.ok) return;
    });
  }
  for (const name of level.outputs) {
    connectSignal(draft, idMap.get(level.netlist.outputsMap[name]) ?? level.netlist.outputsMap[name], {
      output: name,
    });
  }
  return { ok: true, draft };
}

/**
 * M3 结算闭环：
 *   a. 编辑器能表达生成器的全部产物并通过校验
 *   b. 照答案提交 → 接受、差值为 0、结算字段与求解器一致
 *   c. 改错一个输出 → 给出具体失配行
 *   d. 最优解可构造：门数 == 求解器最优（证明不是只给了下界）
 *   e. 探测序列可重算，逐项一致
 */
function checkSettlement() {
  const CASES = 400;
  const PROBE_SEQS = [
    [0, 1, 2, 3],
    [15, 0, 8, 8, 7],
    Array.from({ length: 24 }, (_, index) => (index * 5) & 0xf),
  ];
  let checked = 0;
  let editorFailures = 0;
  let settlementMismatch = 0;
  let differenceFailures = 0;
  let mismatchBlind = 0;
  let unreachableOptimal = 0;
  let probeMismatch = 0;
  const samples = [];

  for (let seed = 0; seed < CASES; seed += 1) {
    const generated = generateLevel(seed);
    if (!generated.ok) continue;
    const { level } = generated;
    checked += 1;

    const rebuilt = rebuildThroughEditor(level);
    if (!rebuilt.ok) {
      editorFailures += 1;
      if (samples.length < 5) samples.push({ seed, reason: "editor-cannot-express" });
      continue;
    }
    const validation = validateDraft(rebuilt.draft);
    if (!validation.ok) {
      editorFailures += 1;
      if (samples.length < 5) samples.push({ seed, reason: "draft-invalid", errors: validation.errors.slice(0, 2) });
      continue;
    }

    const accepted = judgeSubmission(rebuilt.draft, level, { probes: 3 });
    if (!accepted.accepted) {
      settlementMismatch += 1;
      if (samples.length < 5) samples.push({ seed, reason: "answer-rejected" });
      continue;
    }
    const yourGates = countedGates(toNetlist(rebuilt.draft));
    if (accepted.settlement.optimalGates !== level.optimal || accepted.settlement.yourGates !== yourGates) {
      settlementMismatch += 1;
      if (samples.length < 5) samples.push({ seed, reason: "settlement-fields-drift" });
    }
    if (accepted.settlement.difference !== yourGates - level.optimal || accepted.settlement.difference < 0) {
      differenceFailures += 1;
      if (samples.length < 5) {
        samples.push({ seed, reason: "difference", your: yourGates, optimal: level.optimal });
      }
    }

    // 改错一个输出后必须报出具体失配，而不是只报"错"。
    const tampered = judgeSubmission(
      tamperOutput(rebuilt.draft, level),
      level,
      { probes: 1 },
    );
    const isBlind = tampered.accepted || tampered.reason !== "mismatch" || !tampered.mismatch;
    if (isBlind) mismatchBlind += 1;
    else if (
      !Number.isInteger(tampered.mismatch.row) ||
      tampered.mismatch.input.length !== level.inputs.length ||
      typeof tampered.mismatch.output !== "string"
    ) {
      mismatchBlind += 1;
    }

    // 最优解可达：构造最优网表，门数必须等于求解器给出的值。
    const { masks } = truthTableMasks(level.netlist);
    const solved = solveOptimal(masks, level.inputs.length, 12);
    const built = optimalNetlist(masks, level.inputs.length, 12, level.outputs);
    if (countedGates(built) !== solved.optimal) {
      unreachableOptimal += 1;
      if (samples.length < 5) samples.push({ seed, reason: "optimal-unreachable", built: countedGates(built), optimal: solved.optimal });
    }

    for (const probes of PROBE_SEQS) {
      const first = recomputeProbes(level, probes);
      const second = recomputeProbes(generateLevel(seed).level, probes);
      if (JSON.stringify(first) !== JSON.stringify(second)) {
        probeMismatch += 1;
        if (samples.length < 5) samples.push({ seed, reason: "probe-recompute" });
        break;
      }
    }
  }

  const pass =
    checked === CASES &&
    editorFailures === 0 &&
    settlementMismatch === 0 &&
    differenceFailures === 0 &&
    mismatchBlind === 0 &&
    unreachableOptimal === 0 &&
    probeMismatch === 0;

  return {
    name: "settlement.closure",
    pass,
    detail: {
      cases: checked,
      editorFailures,
      settlementMismatch,
      differenceFailures,
      mismatchBlind,
      unreachableOptimal,
      probeMismatch,
      probeSequences: PROBE_SEQS.length,
    },
    samples,
  };
}

/**
 * 把第一个输出改接到一个**函数必然不同**的信号上。
 * 生成器允许 `OR(i0,i0)=i0` 这类退化结构，所以不能盲选输入端口；
 * 先按真值表掩码筛掉同功能候选，筛不出就改接该输出的取反（NOT 包一层会新增门，
 * 这里直接换成另一个已知不同函数的输入/门）。
 */
function tamperOutput(draft, level) {
  const clone = {
    ...draft,
    gates: draft.gates.map((gate) => ({ ...gate, in: [...gate.in] })),
    outputsMap: { ...draft.outputsMap },
  };
  const name = level.outputs[0];
  const own = toNetlist(draft);
  const originalMask = truthTableMasks(own).masks[name];
  const candidates = clone.gates.map((gate) => gate.id).filter((id) => {
    const probe = { ...own, outputs: [name], outputsMap: { [name]: id } };
    return truthTableMasks(probe).masks[name] !== originalMask;
  });
  if (candidates.length > 0) {
    clone.outputsMap[name] = candidates[0];
  } else {
    // 极少见：所有中间信号与该输出同函数。此时改接一个输入端口。
    clone.outputsMap[name] = level.inputs.find((input) => input !== own.outputsMap[name]) ?? "i0";
  }
  return clone;
}

/** M3 揭示：层级严格递增、无空层、终态覆盖全部门（读数据，不靠截图）。 */
function checkReveal() {
  const CASES = 500;
  let nonIncreasing = 0;
  let emptyLayer = 0;
  let uncovered = 0;
  const samples = [];
  for (let seed = 0; seed < CASES; seed += 1) {
    const generated = generateLevel(seed);
    if (!generated.ok) continue;
    const { level } = generated;
    const plan = buildRevealPlan(level.netlist);
    const sequence = revealSequence(plan);
    for (let i = 1; i < sequence.length; i += 1) {
      if (sequence[i] <= sequence[i - 1]) nonIncreasing += 1;
    }
    if (plan.layers.some((layer) => layer.length === 0)) {
      emptyLayer += 1;
      if (samples.length < 5) samples.push({ seed, reason: "empty-layer" });
    }
    const revealed = new Set(plan.layers.flat());
    if (revealed.size !== level.netlist.gates.length) {
      uncovered += 1;
      if (samples.length < 5) samples.push({ seed, reason: "uncovered", gates: level.netlist.gates.length });
    }
    for (const [id, layer] of Object.entries(plan.layerById)) {
      const gate = level.netlist.gates.find((item) => item.id === id);
      for (const src of gate.in) {
        if (plan.layerById[src] !== undefined && plan.layerById[src] >= layer) {
          nonIncreasing += 1;
          if (samples.length < 5) samples.push({ seed, reason: "upstream-layer", src, id });
        }
      }
    }
  }
  return {
    name: "reveal.order",
    pass: nonIncreasing === 0 && emptyLayer === 0 && uncovered === 0,
    detail: { seeds: CASES, nonIncreasing, emptyLayer, uncovered },
    samples,
  };
}

/** M3 术语门槛（D1）：前 3 关文案与页面骨架都不得出现正式术语。 */
function checkTerms() {
  const hits = [];
  for (let index = 1; index <= 3; index += 1) {
    for (const hit of forbiddenTermHits(copyFor(index))) hits.push({ source: `copy:${index}:${hit.label}`, term: hit.term });
  }
  const html = readFileSync(join(ROOT, "index.html"), "utf8")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  for (const term of ["门", "NAND", "AND", "OR", "NOT"]) {
    if (html.includes(term)) hits.push({ source: "index.html", term });
  }
  // 阳性对照：扫描器必须能抓到禁用词，否则"0 命中"没有意义。
  const positive = forbiddenTermHits({ ...copyFor(1), hintProbe: "这里有个门" }).length > 0;
  return {
    name: "copy.terms",
    pass: hits.length === 0 && positive,
    detail: { hits: hits.length, positiveControl: positive, earlyLevels: 3 },
    samples: hits.slice(0, 5),
  };
}

/** 战役前 3 关的存在性与难度：低预算、最优 2 门、可生成。 */
function checkCampaign() {
  const failures = [];
  const levels = [];
  for (let index = 1; index <= 3; index += 1) {
    const options = campaignOptions(index);
    const generated = generateLevel(campaignSeed(index), options);
    if (!generated.ok) {
      failures.push({ index, reason: generated.code });
      continue;
    }
    levels.push({ index, optimal: generated.level.optimal, difficulty: generated.level.difficulty });
    if (generated.level.optimal > 2) failures.push({ index, reason: "too-hard", optimal: generated.level.optimal });
  }
  return {
    name: "campaign.early",
    pass: failures.length === 0 && levels.length === 3,
    detail: { levels: levels.length, failures: failures.length, optimal: levels.map((item) => item.optimal) },
    samples: failures,
  };
}

function run(requireList) {
  const checks = [
    checkSimCross(),
    checkFixtureByteStability(),
    checkGeneration(),
    checkReplay(),
    checkShareRoundtrip(),
    checkSettlement(),
    checkReveal(),
    checkTerms(),
    checkCampaign(),
    checkBuild(),
  ];
  const required = new Set(requireList);
  const known = new Set(checks.map((check) => check.name));
  const unknown = [...required].filter((name) => !known.has(name));
  for (const check of checks) {
    if (required.size > 0 && !required.has(check.name)) {
      check.skipped = true;
    }
  }
  // 未知的 --require 项必须显式失败：否则"一项都没跑"会被读成"全绿"。
  if (unknown.length > 0) {
    checks.push({
      name: "verify.args",
      pass: false,
      detail: { unknownRequired: unknown, known: [...known].sort() },
      samples: [],
    });
  }
  const executed = checks.filter((check) => !check.skipped);
  const failed = executed.filter((check) => !check.pass);
  return { checks, failed, executed: executed.length, pass: failed.length === 0 && executed.length > 0 };
}

function renderHuman(result) {
  const lines = [];
  lines.push("黑盒电路侦探 · verify");
  lines.push("=".repeat(48));
  for (const check of result.checks) {
    if (check.skipped) {
      lines.push(`SKIP  ${check.name}`);
      continue;
    }
    lines.push(`${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
    for (const [key, value] of Object.entries(check.detail)) {
      const printable = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
      lines.push(`      ${key}: ${printable}`);
    }
    for (const sample of check.samples) lines.push(`      sample: ${JSON.stringify(sample)}`);
  }
  lines.push("=".repeat(48));
  lines.push(`结论: ${result.pass ? "全绿" : `${result.failed.length} 项未通过`}`);
  lines.push("耗时只报告不参与判定；判定项 = 差异数 / 通过率 / 外链数。");
  return `${lines.join("\n")}\n`;
}

function main() {
  const requireFlag = process.argv.indexOf("--require");
  const requireList = requireFlag >= 0 ? (process.argv[requireFlag + 1] ?? "").split(",").filter(Boolean) : [];
  const jsonFlag = process.argv.includes("--json");
  const outFlag = process.argv.indexOf("--out");
  const result = run(requireList);
  const payload = {
    tool: "circuit-detective/verify",
    version: 1,
    pass: result.pass,
    total: result.checks.length,
    executed: result.executed,
    checks: result.checks.map((check) => ({
      name: check.name,
      skipped: Boolean(check.skipped),
      pass: Boolean(check.pass),
      detail: check.detail,
      samples: check.samples,
    })),
  };
  if (outFlag >= 0) {
    const path = resolve(process.argv[outFlag + 1] ?? "verify.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  if (jsonFlag) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(renderHuman(result));
  }
  if (!result.pass) process.exitCode = 1;
}

main();
