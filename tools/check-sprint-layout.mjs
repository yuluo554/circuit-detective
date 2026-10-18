#!/usr/bin/env node
// 布局门（方法论装订第②件，K40）：把"项目还长在方法论上"变成可跑红的断言。
// 判据一律落**仓库内文件**（不读 git 元数据——浅克隆下 git tag / 历史深度会翻转）。
// 刻意常绿：它没有"发布前本来就该红"的条目（与 tools/check-release.mjs 相反）。
// 退出码：0 全绿 / 1 有 FAIL / 2 用法错误。

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const checks = [];
const add = (id, ok, detail) => checks.push({ id, ok, detail });
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);

const scanned = { docs: 0, handoffs: 0, copies: 0 };

// ── ① 强制文件（阶段 0 的必备产物 + 装订锚点）───────────────────────────────
const REQUIRED_FILES = [
  "AGENTS.md",
  "README.md",
  "data/README.md",
  "plan/00-README总览.md",
  "plan/01-题目文档.md",
  "plan/02-架构与技术选型.md",
  "plan/03-模块详设.md",
  "plan/04-数据计划.md",
  "plan/05-里程碑与发布.md",
  "plan/06-交付对标与决策.md",
];

/**
 * ② 装订行：三个锚点**必须同现于一行**——方法论名 + 布局门命令 + 装订日期。
 * 用顺序无关的前瞻；写成 `A.*B.*C` 会把"日期在命令之前"的合法行判成缺。
 * 不要写成"或"关系（残句会被判绿）。
 */
const BINDING_LINE = /^>(?=.*ai-tool-project-sprint)(?=.*check-sprint-layout)(?=.*20\d{2}-\d{2}-\d{2}).*$/m;

// ── ③ 各文档的必需小节（超集宽容：只断言"存在"，不断言节数）────────────────
const REQUIRED_SECTIONS = {
  "plan/00-README总览.md": ["文档索引", "决策记录", "承诺-证据台账", "里程碑"],
  "plan/01-题目文档.md": ["任务要求", "评分标准", "边界与非目标"],
  "plan/02-架构与技术选型.md": ["分层", "构建"],
  "plan/03-模块详设.md": ["M1", "M2", "M3", "M4", "M5"],
  "plan/04-数据计划.md": ["数据清单", "真值纪律", "数值口径"],
  "plan/05-里程碑与发布.md": ["DoD", "已知未验证项", "里程碑"],
  "plan/06-交付对标与决策.md": ["评分对标", "开放项", "风险登记"],
  "data/README.md": ["依据查证记录", "数值口径"],
};

/** ④ HANDOFF 必需节（六节；本仓自造的九段式是合法超集）。 */
const HANDOFF_SECTIONS = ["证据", "待办", "（K 编号", "环境坑", "DoD", "命令速查"];

/** 项目**已声明**的豁免与冻结规则——门必须复用，别另立更严的一套（否则误报）。 */
const EXEMPT_MILESTONES = [0]; // plan/00：M0 的收尾记录就是计划套件本身，不要求 HANDOFF
const HANDOFF_FORMAT_FROM = 3; // 格式冻结从 M3 起（M1/M2 是补记，节可少）

/** ⑤ 状态副本：同一里程碑在这几处必须**互相一致**。 */
const STATUS_COPIES = [
  { file: "plan/00-README总览.md", kind: "里程碑表" },
  { file: "plan/05-里程碑与发布.md", kind: "状态表" },
  { file: "README.md", kind: "状态行" },
];

/** 只认"状态行"：表格行且首格就是里程碑号（不扫自由文本——见文件末注释）。 */
const STATUS_LINE = /^\|\s*\*{0,2}M(\d+)\b/;
const PENDING_MARKERS = ["⬜", "🟡", "未开始", "未执行", "待执行", "待确认"];

function checkRequiredFiles() {
  const missing = REQUIRED_FILES.filter((rel) => !existsSync(join(ROOT, rel)));
  scanned.docs = REQUIRED_FILES.length - missing.length;
  add("LAYOUT.FILES", missing.length === 0, missing.length ? `缺: ${missing.join(",")}` : `${scanned.docs} 份齐备`);
}

function checkBindingHead() {
  const text = read("plan/00-README总览.md") ?? "";
  add(
    "LAYOUT.BINDING_HEAD",
    BINDING_LINE.test(text),
    BINDING_LINE.test(text) ? "plan/00 顶部有装订行（三锚点同现）" : "plan/00 顶部缺装订行（需同现：方法论名 + 布局门命令 + 装订日期）",
  );
}

function checkSections() {
  const bad = [];
  for (const [rel, needles] of Object.entries(REQUIRED_SECTIONS)) {
    const text = read(rel);
    if (text === null) continue; // 缺失由 LAYOUT.FILES 报，这里不重复报也不崩
    const missing = needles.filter((n) => !text.includes(n));
    if (missing.length) bad.push(`${rel}: ${missing.join("/")}`);
  }
  add("LAYOUT.SECTIONS", bad.length === 0, bad.length ? bad.join("；") : `${Object.keys(REQUIRED_SECTIONS).length} 份小节齐备`);
}

/**
 * 逐副本采集状态：`Map<k, Set<"done"|"pending">>`。
 * **真值不取自任何一个副本**——若以 plan/05 为真值，则"在 plan/05 里把某里程碑翻 ⬜"
 * 会让它直接掉出待检集合，其它副本的不一致**永久不可见**（自我参照 → 恒真）。
 */
function collectStates() {
  const states = new Map();
  for (const copy of STATUS_COPIES) {
    const text = read(copy.file);
    if (text === null) continue;
    scanned.copies += 1;
    for (const line of text.split("\n")) {
      const m = STATUS_LINE.exec(line);
      if (!m) continue;
      const k = Number(m[1]);
      if (!states.has(k)) states.set(k, new Set());
      states.get(k).add(PENDING_MARKERS.some((mark) => line.includes(mark)) ? "pending" : "done");
    }
  }
  return states;
}

function checkStatusAgreement(states) {
  const conflicts = [];
  for (const [k, set] of [...states.entries()].sort((a, b) => a[0] - b[0])) {
    if (set.size > 1) conflicts.push(`M${k} 跨副本状态不一致（${[...set].join(" vs ")}）`);
  }
  add(
    "LAYOUT.STATUS",
    conflicts.length === 0,
    conflicts.length ? conflicts.join("；") : `${scanned.copies} 处副本 × ${states.size} 个里程碑 状态全一致`,
  );
}

function checkHandoffs(done) {
  const missing = [];
  for (const k of done) {
    if (EXEMPT_MILESTONES.includes(k)) continue;
    const rel = `plan/HANDOFF-M${k}.md`;
    const text = read(rel);
    if (text === null) {
      missing.push(`${rel}(缺)`);
      continue;
    }
    scanned.handoffs += 1;
    if (k < HANDOFF_FORMAT_FROM) continue;
    const lack = HANDOFF_SECTIONS.filter((n) => !text.includes(n));
    if (lack.length) missing.push(`${rel}(缺节: ${lack.join("/")})`);
  }
  add("LAYOUT.HANDOFFS", missing.length === 0, missing.length ? missing.join("；") : `${scanned.handoffs} 份交接单齐（M0 已声明豁免）`);
}

/**
 * plan/06 的「缺口」列是状态的隐蔽副本。
 * **按表头定位列号再取单元格**，不是"行里含『缺口』二字"——后者永远抓不到
 * "表头有『缺口』、数据行把已 ✅ 里程碑填进缺口格"这种真实故障。
 */
function checkStaleGaps(done) {
  const lines = (read("plan/06-交付对标与决策.md") ?? "").split("\n");
  const headerIdx = lines.findIndex((l) => l.startsWith("|") && l.includes("缺口"));
  if (headerIdx < 0) {
    add("LAYOUT.GAPS", false, "plan/06 找不到含『缺口』表头的表（判据表搬走了？）");
    return;
  }
  const col = lines[headerIdx].split("|").length - 2; // 最后一个有效列
  const stale = [];
  for (const line of lines.slice(headerIdx + 2)) {
    if (!line.startsWith("|")) continue;
    const cell = line.split("|")[col] ?? "";
    for (const k of done) {
      if (new RegExp(`(^|[^0-9A-Za-z])M${k}([^0-9]|$)`).test(cell)) stale.push(`plan/06 缺口列仍提 M${k}`);
    }
  }
  add("LAYOUT.GAPS", stale.length === 0, stale.length ? stale.join("；") : "plan/06 缺口列无已 ✅ 里程碑");
}

/** 收尾留档：两栏（tag 前事实 / tag 后追加）+ 阶段 7 出口门覆盖对账（三态逐条）。 */
function checkReleaseDoc(done) {
  if (done.length === 0) {
    add("LAYOUT.RELEASE", true, "尚无 ✅ 里程碑，跳过");
    return;
  }
  const last = Math.max(...done);
  const release = read(`plan/RELEASE-M${last}.md`);
  const wrapup = read(`plan/WRAPUP-M${last}.md`);
  if (!release && !wrapup) {
    add("LAYOUT.RELEASE", false, `缺 plan/RELEASE-M${last}.md 或 plan/WRAPUP-M${last}.md`);
    return;
  }
  if (release) {
    const cols = /^##\s*一、tag 前事实/m.test(release) && /^##\s*二、tag 后追加/m.test(release);
    const heading = /^#{2,3}.*覆盖对账/m.test(release);
    const rows = (release.match(/^\|.*(实现|不适用|待首推).*\|$/gm) ?? []).length;
    add("LAYOUT.RELEASE", cols && heading && rows >= 3, `两栏:${cols} 覆盖对账小节:${heading} 三态行数:${rows}`);
    return;
  }
  add("LAYOUT.RELEASE", true, "WRAPUP 形态");
}

/** CI 里必须真有一条步骤跑本门（否则门只在开发机存在）。 */
function checkCiStep() {
  const text = read(".github/workflows/ci.yml") ?? "";
  add(
    "LAYOUT.CI_STEP",
    text.includes("check-sprint-layout"),
    text.includes("check-sprint-layout") ? "CI 有一步跑布局门" : "CI 缺 `check-sprint-layout` 步骤",
  );
}

function main() {
  for (const run of [checkRequiredFiles, checkBindingHead, checkSections, checkCiStep]) {
    try {
      run();
    } catch (error) {
      add(run.name, false, error.message);
    }
  }
  const states = collectStates();
  const done = [...states.entries()].filter(([, set]) => set.has("done")).map(([k]) => k);
  for (const run of [
    () => checkStatusAgreement(states),
    () => checkHandoffs(done),
    () => checkStaleGaps(done),
    () => checkReleaseDoc(done),
  ]) {
    try {
      run();
    } catch (error) {
      add(run.name, false, error.message);
    }
  }

  const failed = checks.filter((c) => !c.ok);
  process.stdout.write("布局门 · 方法论装订（判据只落仓库内文件）\n");
  process.stdout.write("=".repeat(56) + "\n");
  for (const c of checks) process.stdout.write(`${c.ok ? "PASS" : "FAIL"}  ${c.id}  ${c.detail}\n`);
  process.stdout.write("=".repeat(56) + "\n");
  process.stdout.write(`这轮扫到：文档 ${scanned.docs} / 交接单 ${scanned.handoffs} / 状态副本 ${scanned.copies}\n`);
  process.stdout.write(`结论: ${failed.length === 0 ? "全绿" : `${failed.length} 项 FAIL`}\n`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

/**
 * 为什么状态判据只扫"状态行"而不扫自由文本：
 * `plan/00` 的"当前状态"段落里同时出现 `M0–M6 完成` 与"未验证项保持 ⬜"——扫自由文本会把
 * 它读成"M0/M6 仍挂 ⬜"，是**判据张冠李戴**的典型假红（"断言了全世界"）。
 */
main();
