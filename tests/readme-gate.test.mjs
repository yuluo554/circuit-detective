import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");

test("README 提到的 npm 脚本都真实存在", () => {
  const used = [...readme.matchAll(/npm run ([a-z:]+)/g)].map((match) => match[1]);
  const missing = used.filter((name) => !Object.hasOwn(pkg.scripts, name));
  assert.deepEqual(missing, []);
  assert.ok(used.length >= 3, "README 至少要给出三条可跑命令");
});

test("CI 调用的脚本与工具都有实物", () => {
  const npmRuns = [...workflow.matchAll(/npm run ([a-z:]+)/g)].map((match) => match[1]);
  const missingScripts = npmRuns.filter((name) => !Object.hasOwn(pkg.scripts, name));
  assert.deepEqual(missingScripts, []);

  const nodeTools = [...workflow.matchAll(/node (tools\/[A-Za-z0-9_.-]+)/g)].map((match) => match[1]);
  const missingTools = nodeTools.filter((path) => !existsSync(join(ROOT, path)));
  assert.deepEqual(missingTools, []);

  assert.ok(npmRuns.length >= 2);
  assert.ok(nodeTools.length >= 2);
});

test("README 声明的许可文件真实存在", () => {
  assert.ok(readme.includes("MIT"));
  assert.ok(existsSync(join(ROOT, "LICENSE")));
});

test("README 声明的 Node 版本与 engines 一致", () => {
  assert.ok(readme.includes(`>= ${pkg.engines.node.replace(">=", "").trim()}`));
});
