import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 交接单守门（补于 M4 轮）。
 *
 * 起因：`plan/00` §一 钉死了"每个里程碑收尾写 `plan/HANDOFF-M<k>.md`"，
 * 但 **M5 的交接单一直没人写**——它的产物在 M0–M3 分批落地、被 `HANDOFF-M3.md`
 * 以"✅ 9 段"结账，于是"少一份交接单"这件事整整一轮没人发现（靠人记住＝会漏）。
 * 这里把它变成常驻断言：里程碑标 ✅ 就必须有对应交接单，且交接单得有该有的部件。
 *
 * M0 不要求：它的收尾记录就是计划套件本身 + `plan/05` §一 的出口证据。
 *
 * M6 扩展（2026-10-18，M6 完成后）：M6 翻 ✅ 后同样要有交接单——否则就是重犯
 * "产物分批落地、没人记得写交接单"这件事（M5 的原病）。**M6 是收尾棒**，它的 §9 指向维护/二期。
 */
const REQUIRED = [1, 2, 3, 4, 5, 6];

/** 格式钉死（`plan/00` §一 引用 `HANDOFF-M3.md` §5 的九段式）之后写的交接单要更完整。 */
const FORMAT_FREEZE_FROM = 3;

test("交接单守门：M1–M6 每个里程碑都有自己的收尾交接单", () => {
  const missing = REQUIRED.filter((k) => !existsSync(join(ROOT, "plan", `HANDOFF-M${k}.md`)));
  assert.deepEqual(
    missing,
    [],
    `缺少收尾交接单：${missing.map((k) => `plan/HANDOFF-M${k}.md`).join("、")}（每个 ✅ 里程碑都要有）`,
  );
});

test("交接单守门：标题对得上里程碑号，且六件套齐备", () => {
  const common = ["证据", "DoD", "（K 编号", "启动提示词"];
  const frozen = [...common, "待办", "环境坑", "关键命令速查"];
  for (const k of REQUIRED) {
    const text = readFileSync(join(ROOT, "plan", `HANDOFF-M${k}.md`), "utf8");
    const title = text.split("\n")[0];
    assert.match(title, new RegExp(`^# HANDOFF-M${k}\\b`), `HANDOFF-M${k}.md 首行标题与里程碑号不符: ${title}`);
    const needed = k >= FORMAT_FREEZE_FROM ? frozen : common;
    const missing = needed.filter((needle) => !text.includes(needle));
    assert.deepEqual(missing, [], `HANDOFF-M${k}.md 缺少部件: ${missing.join(" / ")}`);
  }
});

test("交接单守门：plan/05 标 ✅ 的里程碑（M1–M6）都能在状态表里对上", () => {
  const lines = readFileSync(join(ROOT, "plan", "05-里程碑与发布.md"), "utf8").split("\n");
  for (const k of REQUIRED) {
    const row = lines.find((line) => line.startsWith(`| **M${k} `));
    assert.ok(row, `plan/05 状态表里缺 M${k} 行`);
    assert.ok(row.includes("✅"), `plan/05 的 M${k} 未标 ✅，但它却有交接单（状态与文件不一致）: ${row}`);
  }
});

test("交接单守门：plan/00 的索引行把 M1–M6 都记为 ✅", () => {
  const row = readFileSync(join(ROOT, "plan", "00-README总览.md"), "utf8")
    .split("\n")
    .find((line) => line.startsWith("| `plan/HANDOFF-M<k>.md`"));
  assert.ok(row, "plan/00 缺少交接单索引行");
  for (const k of REQUIRED) {
    assert.ok(row.includes(`M${k} ✅`), `plan/00 的交接单索引未把 M${k} 记为 ✅: ${row}`);
  }
});
