import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("测试清单守门：tests/ 下的每个 .test.mjs 都被 package.json 列出", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const listed = [...pkg.scripts.test.matchAll(/tests\/([A-Za-z0-9_.-]+\.test\.mjs)/g)].map((m) => m[1]);
  const onDisk = readdirSync(join(ROOT, "tests"))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  assert.deepEqual([...new Set(listed)].sort(), onDisk, "测试文件与清单不一致（新增测试忘了登记）");
});

test("零依赖守门：dependencies 与 devDependencies 均为空", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.deepEqual(pkg.devDependencies ?? {}, {});
});

test("核心层不得引用 DOM 或随机/时钟 API（只看代码，跳过注释）", () => {
  const coreDir = join(ROOT, "src", "core");
  const offenders = [];
  for (const name of readdirSync(coreDir)) {
    if (!name.endsWith(".mjs")) continue;
    // 注释里解释"禁止 Math.random"是机制说明，不是调用点；判据只锚代码。
    const code = readFileSync(join(coreDir, name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const needle of ["Math.random", "Date.now", "new Date(", "performance.now", "document.", "window."]) {
      if (code.includes(needle)) offenders.push(`${name}:${needle}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("构建产物不引用任何外部 URL（源码 + 模板两个面）", () => {
  const scopes = ["index.html", "src/ui/render.mjs", "src/ui/app.mjs", "src/ui/level-source.mjs"];
  const hits = scopes.filter((path) => /https?:\/\//i.test(readFileSync(join(ROOT, path), "utf8")));
  assert.deepEqual(hits, []);
});

test("package.json 的 test 脚本确实能收集到所有登记文件（非空跑）", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const listed = [...pkg.scripts.test.matchAll(/tests\/([A-Za-z0-9_.-]+\.test\.mjs)/g)];
  assert.ok(listed.length >= 8, `登记的测试文件过少: ${listed.length}`);
});
