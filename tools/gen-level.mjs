#!/usr/bin/env node
// 关卡生成 CLI：node tools/gen-level.mjs --seed <seed> [--out <file>] [--count <n>]
// 输出严格走 levelToJson，同 seed 逐字节相同。

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generateLevel } from "../src/core/generator.mjs";

function parseArgs(argv) {
  const options = { seed: null, out: null, count: 1, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--seed") options.seed = argv[++i];
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--count") options.count = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new UsageError(`未知参数: ${arg}`);
  }
  if (!options.help && options.seed == null) throw new UsageError("缺少 --seed");
  if (!Number.isInteger(options.count) || options.count < 1) throw new UsageError("--count 必须是正整数");
  return options;
}

class UsageError extends Error {}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n用法: node tools/gen-level.mjs --seed <seed> [--count n] [--out file]\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write("用法: node tools/gen-level.mjs --seed <seed> [--count n] [--out file]\n");
    return;
  }

  const lines = [];
  for (let offset = 0; offset < options.count; offset += 1) {
    const seed = offset === 0 ? options.seed : `${options.seed}+${offset}`;
    const result = generateLevel(seed);
    if (!result.ok) {
      process.stderr.write(`${result.message}\n`);
      process.exitCode = 1;
      return;
    }
    lines.push(result.json);
  }
  const payload = `${lines.join("\n")}\n`;
  if (options.out) {
    const path = resolve(options.out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, payload, "utf8");
    process.stdout.write(`已写入 ${path}（${lines.length} 关）\n`);
    return;
  }
  process.stdout.write(payload);
}

main();
