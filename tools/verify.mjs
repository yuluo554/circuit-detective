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
import { solveOptimal } from "../src/core/solver.mjs";
import { encodeRecord, decodeRecord } from "../src/core/replay.mjs";
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

function run(requireList) {
  const checks = [checkSimCross(), checkFixtureByteStability(), checkGeneration(), checkReplay(), checkBuild()];
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
