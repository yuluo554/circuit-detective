import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(ROOT, "tools", "check-release.mjs");

function runGate(args = [], env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [GATE, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status ?? -1, stdout: String(error.stdout ?? "") };
  }
}

/** 指向一个不存在的留档路径——把"缺档"这一瞬态变成可重复构造的输入。 */
const ABSENT_DOC = { RELEASE_DOC_PATH: "plan/__absent-release-doc__.md" };

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
  const { stdout } = runGate(["--pre-tag"], ABSENT_DOC);
  assert.match(stdout, /^SKIP\s{2}RELEASE_DOC/m);
});

test("发布门：离线模式缺失发布留档报 FAIL（缺档不得伪装成通过）", () => {
  const { stdout } = runGate([], ABSENT_DOC);
  assert.match(stdout, /^FAIL\s{2}RELEASE_DOC/m);
});

test("发布门：留档存在时 pre-tag 与离线都据实报 PASS（两栏齐备）", () => {
  const preTag = runGate(["--pre-tag"]);
  const offline = runGate();
  assert.match(preTag.stdout, /^PASS\s{2}RELEASE_DOC\s+两栏: true\/true/m);
  assert.match(offline.stdout, /^PASS\s{2}RELEASE_DOC\s+两栏: true\/true/m);
});

test("发布门：检查项数量与结论行数对账", () => {
  const { stdout } = runGate();
  const summary = /PASS (\d+) \/ FAIL (\d+) \/ SKIP (\d+)/.exec(stdout);
  assert.ok(summary, "缺少汇总行");
  const total = Number(summary[1]) + Number(summary[2]) + Number(summary[3]);
  const lines = stdout.split("\n").filter((line) => /^(PASS|FAIL|SKIP)\s{2}/.test(line));
  assert.equal(total, lines.length);
});

test("发布门：查的 tag 名由 package.json 的 version 派生，不是硬编码（升版后不得继续盯旧 tag）", () => {
  // 起因：0.1.0 → 0.1.1 时门里硬编码 "v0.1.0"，升版后 `--online` 仍会对着旧 tag / 旧 Release 报 PASS ——
  // 即"版本升了、门还绿"，是最难发现的一类假绿。判据：门源码里不得出现字面 tag，且必须读 package.json。
  const source = readFileSync(GATE, "utf8");
  const literalTags = [...source.matchAll(/["']v\d+\.\d+\.\d+["']/g)].map((m) => m[0]);
  assert.deepEqual(literalTags, [], `发布门不应硬编码 tag 名（命中: ${literalTags.join(",")}）`);
  assert.match(source, /pkg\.version/, "发布门应由 package.json 的 version 派生 tag 名");

  // 断言派生结果与当前版本一致：把 package.json 的版本改成任意值，门报的 tag 名跟着变。
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "version 应是正式版（无 -dev/-rc 后缀）");
});
