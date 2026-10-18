import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../tools/build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("M3 接线：构建产物的入口模块包含编辑器 / 判定 / 揭示 / 文案四处依赖", () => {
  const { files } = build({ write: false });
  const names = files.map((file) => file.replace(/\\/g, "/").split("/src/").pop());
  for (const required of [
    "core/editor.mjs",
    "core/judge.mjs",
    "core/reveal.mjs",
    "ui/copy.mjs",
    "ui/layout.mjs",
    "ui/render.mjs",
    "ui/app.mjs",
  ]) {
    assert.ok(names.includes(required), `构建产物缺少模块: ${required}（依赖未被 app.mjs 引用？）`);
  }
});

test("M3 接线：页面骨架含拼装视图所需的控件 id", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  for (const id of [
    "board",
    "view-probe",
    "view-build",
    "palette",
    "submit",
    "settlement",
    "settle-your",
    "settle-optimal",
    "settle-diff",
    "settle-probes",
    "note",
    "probes",
    "submissions",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `index.html 缺少控件: ${id}`);
  }
});

test("M3 接线：app.mjs 不引用未定义的面板 id", () => {
  const app = readFileSync(join(ROOT, "src", "ui", "app.mjs"), "utf8");
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const used = new Set([...app.matchAll(/el\("([a-z0-9-]+)"\)/g)].map((match) => match[1]));
  const missing = [...used].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `app.mjs 引用了 index.html 不存在的控件: ${missing.join(",")}`);
  assert.ok(used.size >= 20, `面板绑定过少: ${used.size}`);
});

test("M3 接线：构建产物暴露只读快照但没有写入口", () => {
  const { html } = build({ write: false });
  assert.ok(html.includes("__circuitDetective"), "缺少调试快照，端到端冒烟无法读状态");
  assert.ok(html.includes("Object.freeze"), "快照应是只读的");
  // 快照里不得出现"设定结算结果"这类可伪造判定的入口
  assert.ok(!/setSettlement|forceAccept|setProbes\s*:/.test(html), "快照暴露了可伪造判定的写入口");
});

test("M3 接线：面板的按钮文案全部来自 copy.mjs（D1 单点）", () => {
  const app = readFileSync(join(ROOT, "src", "ui", "app.mjs"), "utf8");
  // app.mjs 里不得出现硬编码的中文按钮文案（除调试/报错兜底）
  const suspicious = [...app.matchAll(/textContent\s*=\s*"([^"]*[\u4e00-\u9fa5][^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(suspicious, [], `按钮文案应走 copy.mjs: ${suspicious.join(" | ")}`);
});
