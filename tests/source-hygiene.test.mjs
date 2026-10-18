import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (entry.name.endsWith(".mjs")) out.push(rel);
  }
  return out;
}

/**
 * 构建产物断言"不得出现 undefined"（历史轮次的判据：未定义符号泄漏到产物里，
 * 会让运行期错误变成静默的 undefined 传播）。因此 src/ 下任何模块——包括
 * 还没被 app.mjs 引入的——都不许出现这个 token；否则 M4 一接线就红。
 */
test("src/ 全部模块不含 undefined 字面量（构建产物守卫的前置条件）", () => {
  const offenders = [];
  for (const file of walk("src")) {
    const text = readFileSync(join(ROOT, file), "utf8");
    if (text.includes("undefined")) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `这些文件含 undefined：${offenders.join(", ")}`);
});

test("src/ 全部模块不含 Math.random / Date.now / performance.now（只看代码，跳过注释）", () => {
  const offenders = [];
  for (const file of walk("src")) {
    // 注释里解释"禁止 Math.random"是机制说明，不是调用点；判据只锚代码。
    const code = readFileSync(join(ROOT, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const needle of ["Math.random", "Date.now", "performance.now"]) {
      if (code.includes(needle)) offenders.push(`${file}:${needle}`);
    }
  }
  assert.deepEqual(offenders, []);
});
