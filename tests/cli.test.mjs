import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "tools", "gen-level.mjs");

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status ?? -1, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") };
  }
}

test("gen-level：同 seed 两次输出逐字节相同", () => {
  const first = run(["--seed", "2026-10-19"]);
  const second = run(["--seed", "2026-10-19"]);
  assert.equal(first.code, 0);
  assert.equal(first.stdout, second.stdout);
  const level = JSON.parse(first.stdout);
  assert.equal(level.format, "circuit-detective/level");
  assert.equal(level.version, 1);
  assert.ok(level.optimal >= 2);
  assert.equal(level.label, "2026-10-19");
});

test("gen-level：--out 落盘内容与 stdout 一致", () => {
  const dir = mkdtempSync(join(tmpdir(), "cd-cli-"));
  try {
    const file = join(dir, "level.json");
    const written = run(["--seed", "42", "--out", file]);
    assert.equal(written.code, 0);
    const fromStdout = run(["--seed", "42"]).stdout;
    assert.equal(readFileSync(file, "utf8"), fromStdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gen-level：缺参数与未知参数都给 exit 2（用法错误，非失败）", () => {
  assert.equal(run([]).code, 2);
  assert.equal(run(["--seed", "1", "--bogus"]).code, 2);
  assert.equal(run(["--seed", "1", "--count", "0"]).code, 2);
});

test("gen-level：--count N 输出 N 行 JSON，每行独立可解析", () => {
  const { code, stdout } = run(["--seed", "7", "--count", "3"]);
  assert.equal(code, 0);
  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 3);
  for (const line of lines) {
    const level = JSON.parse(line);
    assert.equal(level.format, "circuit-detective/level");
  }
});

test("gen-level：--help 输出用法且退出 0", () => {
  const { code, stdout } = run(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /--seed/);
});
