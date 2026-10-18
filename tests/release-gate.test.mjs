import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(ROOT, "tools", "check-release.mjs");

function runGate(args = []) {
  try {
    const stdout = execFileSync(process.execPath, [GATE, ...args], { cwd: ROOT, encoding: "utf8" });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status ?? -1, stdout: String(error.stdout ?? "") };
  }
}

test("发布门：离线模式每项恰好一行结论，SKIP 与 PASS 分开计数", () => {
  const { stdout } = runGate();
  const lines = stdout.split("\n").filter((line) => /^(PASS|FAIL|SKIP)\s{2}/.test(line));
  assert.ok(lines.length >= 6, `结论行过少: ${lines.length}`);
  const ids = lines.map((line) => line.trim().split(/\s{2,}/)[1]);
  assert.equal(new Set(ids).size, ids.length, "同一检查项不得重复出结论");
  assert.match(stdout, /SKIP 不计入 PASS/);
});

test("发布门：离线模式不把网络项写成 PASS", () => {
  const { stdout } = runGate();
  assert.match(stdout, /^SKIP\s{2}REMOTE_RELEASE/m);
  assert.doesNotMatch(stdout, /^PASS\s{2}REMOTE_RELEASE/m);
});

test("发布门：--pre-tag 时缺失发布留档报 SKIP 而不是 FAIL", () => {
  const { stdout } = runGate(["--pre-tag"]);
  assert.match(stdout, /^SKIP\s{2}RELEASE_DOC/m);
});

test("发布门：检查项数量与结论行数对账", () => {
  const { stdout } = runGate();
  const summary = /PASS (\d+) \/ FAIL (\d+) \/ SKIP (\d+)/.exec(stdout);
  assert.ok(summary, "缺少汇总行");
  const total = Number(summary[1]) + Number(summary[2]) + Number(summary[3]);
  const lines = stdout.split("\n").filter((line) => /^(PASS|FAIL|SKIP)\s{2}/.test(line));
  assert.equal(total, lines.length);
});
