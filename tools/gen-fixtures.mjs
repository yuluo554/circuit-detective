#!/usr/bin/env node
// 生成仿真核 fixture：固定 seed 的随机网表（含环、扇出、未使用门）。
// --check 模式重新生成并逐字节比对，不写盘。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRng } from "../src/core/rng.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "fixtures", "netlists.json");
const SEED = "circuit-detective/fixtures/v1";
export const FIXTURE_COUNT = 1000;

const TYPES = ["NOT", "AND", "OR"];
const ARITY = { NOT: 1, AND: 2, OR: 2 };

export function buildFixtures(count = FIXTURE_COUNT) {
  const rng = createRng(SEED);
  const fixtures = [];
  for (let index = 0; index < count; index += 1) {
    const shape = index % 5; // 0 普通 / 1 扇出 / 2 未使用门 / 3 组合环 / 4 常量折叠型
    const inputCount = 2 + rng.nextInt(3);
    const gateCount = 2 + rng.nextInt(6);
    const inputs = Array.from({ length: inputCount }, (_, i) => `i${i}`);
    const gates = [];
    const available = [...inputs];

    for (let g = 0; g < gateCount; g += 1) {
      const type = TYPES[rng.nextInt(TYPES.length)];
      const arity = ARITY[type];
      const id = `g${String(g + 1).padStart(2, "0")}`;
      const pool = shape === 3 ? [...available] : available;
      const pins = [];
      for (let p = 0; p < arity; p += 1) pins.push(pool[rng.nextInt(pool.length)]);
      gates.push({ id, type, in: pins });
      if (shape !== 2 || g < gateCount - 1) available.push(id);
    }

    if (shape === 3 && gates.length >= 2) {
      // 人为造 2-环：a -> b 且 b -> a（拓扑排序必然覆盖不到这两门）
      const first = rng.nextInt(gates.length - 1);
      const second = first + 1 + rng.nextInt(gates.length - first - 1);
      gates[first].in[0] = gates[second].id;
      gates[second].in[0] = gates[first].id;
    }

    const outputCount = 1 + rng.nextInt(3);
    const outputs = Array.from({ length: outputCount }, (_, i) => `o${i}`);
    const outputsMap = {};
    for (const name of outputs) outputsMap[name] = available[rng.nextInt(available.length)];

    fixtures.push({
      synthetic: true,
      seed: SEED,
      index,
      shape: ["plain", "fanout", "unused", "cyclic", "fold"][shape],
      netlist: { inputs, outputs, gates, outputsMap },
    });
  }
  return fixtures;
}

export function serialize(fixtures) {
  return `${JSON.stringify({ format: "circuit-detective/fixtures", version: 1, seed: SEED, fixtures }, null, 1)}\n`;
}

function main() {
  const check = process.argv.includes("--check");
  const text = serialize(buildFixtures());
  if (check) {
    let existing = "";
    try {
      existing = readFileSync(OUT, "utf8");
    } catch {
      process.stderr.write(`fixture 缺失: ${OUT}\n`);
      process.exitCode = 1;
      return;
    }
    if (existing !== text) {
      process.stderr.write("fixture 与重生成结果不一致（字节级）\n");
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`fixture 校验通过: ${FIXTURE_COUNT} 条，字节级一致\n`);
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text, "utf8");
  process.stdout.write(`已写入 ${OUT}（${FIXTURE_COUNT} 条）\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
