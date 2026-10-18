#!/usr/bin/env node
// 跨引擎一致性校验（M2 DoD：≥2 引擎哈希相同）。
// 做法：起本地 http 源，让每个浏览器加载同一份 src/core/* 模块，逐 seed 生成关卡 JSON，
// 与 Node 侧结果逐字节比对；再各算一遍探测序列的输出。
// Playwright 不是项目依赖（K16）：按本机全局路径动态 import，缺浏览器就 SKIP。
//
// 用法：node tools/cross-engine.mjs [--seeds 200]

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateLevel } from "../src/core/generator.mjs";
import { recomputeProbes } from "../src/core/judge.mjs";
import { startStaticServer } from "./serve.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const seedsFlag = args.indexOf("--seeds");
const SEED_COUNT = seedsFlag >= 0 ? Number(args[seedsFlag + 1]) : 200;
const PROBE_SEQUENCES = [
  [0, 1, 2, 3],
  [15, 0, 8, 8, 7],
  Array.from({ length: 16 }, (_, index) => (index * 3) & 0xf),
];

const SEEDS = Array.from({ length: SEED_COUNT }, (_, seed) => String(seed));

function candidateCorePaths() {
  const appData = process.env.APPDATA ?? "";
  return [
    process.env.PLAYWRIGHT_CORE,
    join(appData, "npm", "node_modules", "@playwright", "mcp", "node_modules", "playwright-core"),
    join(appData, "npm", "node_modules", "playwright-core"),
    join(ROOT, "node_modules", "playwright-core"),
  ].filter(Boolean);
}

async function loadPlaywright() {
  for (const path of candidateCorePaths()) {
    try {
      const module = await import(pathToFileURL(join(path, "index.mjs")).href);
      if (module.chromium && module.firefox) return module;
    } catch {
      // 试下一个候选
    }
  }
  return null;
}

/** 页面内：用生产模块逐 seed 生成关卡 JSON，并重算探测序列。 */
const PAGE_JOB = async ({ seeds, probeSequences }) => {
  const { generateLevel } = await import("/src/core/generator.mjs");
  const { recomputeProbes } = await import("/src/core/judge.mjs");
  const levels = [];
  const probes = [];
  for (const seed of seeds) {
    const result = generateLevel(seed);
    levels.push(result.ok ? result.json : `ERROR:${result.code}`);
    if (!result.ok) {
      probes.push(null);
      continue;
    }
    probes.push(
      probeSequences.map((sequence) =>
        JSON.stringify(recomputeProbes(result.level, sequence)),
      ),
    );
  }
  return { levels, probes };
};

const chromiumPath = join(
  process.env.LOCALAPPDATA ?? "",
  "ms-playwright",
  "chromium-1228",
  "chrome-win64",
  "chrome.exe",
);

const playwright = await loadPlaywright();
if (!playwright) {
  process.stdout.write("SKIP  cross-engine：本机未找到 playwright-core\n");
  process.exit(0);
}

const handle = await startStaticServer({ port: 0 });
const failures = [];
const notes = [];

async function runEngine(name, launcher, options = {}) {
  let browser;
  try {
    browser = await launcher.launch({ headless: true, ...options });
  } catch (error) {
    notes.push(`SKIP  ${name}: ${String(error.message).split("\n")[0]}`);
    return null;
  }
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${handle.origin}/index.html`, { waitUntil: "load" });
  const result = await page.evaluate(PAGE_JOB, { seeds: SEEDS, probeSequences: PROBE_SEQUENCES });
  await browser.close();
  notes.push(`${errors.length === 0 ? "PASS" : "FAIL"}  ${name} 页面无 JS 错误`);
  if (errors.length > 0) failures.push(`${name}:pageerror`);
  return result;
}

// Node 侧基准
const nodeLevels = SEEDS.map((seed) => generateLevel(seed).json);
const nodeProbes = SEEDS.map((seed) => {
  const generated = generateLevel(seed);
  return PROBE_SEQUENCES.map((sequence) => JSON.stringify(recomputeProbes(generated.level, sequence)));
});

const engines = [];
if (chromiumPath) {
  const chromium = await runEngine("chromium", playwright.chromium, { executablePath: chromiumPath });
  if (chromium) engines.push({ name: "chromium", ...chromium });
}
const firefox = await runEngine("firefox", playwright.firefox);
if (firefox) engines.push({ name: "firefox", ...firefox });

await handle.close();

// 起始路径必须绝对，页面里用 /src/... 是相对 http 源的绝对路径。
for (const engine of engines) {
  let levelDiff = 0;
  let probeDiff = 0;
  for (let i = 0; i < SEEDS.length; i += 1) {
    if (engine.levels[i] !== nodeLevels[i]) levelDiff += 1;
    if (JSON.stringify(engine.probes[i]) !== JSON.stringify(nodeProbes[i])) probeDiff += 1;
  }
  const same = levelDiff === 0 && probeDiff === 0;
  if (!same) failures.push(`${engine.name}:levelDiff=${levelDiff},probeDiff=${probeDiff}`);
  notes.push(
    `${same ? "PASS" : "FAIL"}  ${engine.name} 与 Node 逐字节一致 (levels ${SEEDS.length} / 差异 ${levelDiff}；探测序列 差异 ${probeDiff})`,
  );
}

if (engines.length >= 2) {
  const levelDiff = engines[0].levels.filter((value, index) => value !== engines[1].levels[index]).length;
  const same = levelDiff === 0;
  if (!same) failures.push(`engines-differ:${levelDiff}`);
  notes.push(
    `${same ? "PASS" : "FAIL"}  ${engines[0].name} vs ${engines[1].name} 关卡 JSON 逐字节一致（差异 ${levelDiff}）`,
  );
} else {
  notes.push(`SKIP  引擎两两比对：本机只跑起 ${engines.length} 个引擎`);
}

process.stdout.write("跨引擎一致性 · 关卡 JSON + 探测序列\n");
process.stdout.write("=".repeat(56) + "\n");
for (const line of notes) process.stdout.write(`${line}\n`);
process.stdout.write("=".repeat(56) + "\n");
process.stdout.write(`结论: ${failures.length === 0 ? "全绿" : `${failures.length} 项未通过`}\n`);
if (failures.length > 0) process.exitCode = 1;
