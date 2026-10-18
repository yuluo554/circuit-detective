import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(ROOT, "tools", "check-sprint-layout.mjs");

function runGate(cwd = ROOT, script = GATE) {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [script], { cwd, encoding: "utf8" }) };
  } catch (error) {
    return { code: error.status ?? -1, stdout: String(error.stdout ?? "") };
  }
}

test("布局门：当前工作树上全绿（布局是常驻不变量，不是发布期一次性动作）", () => {
  const { code, stdout } = runGate();
  assert.equal(code, 0, `布局门应常绿；实际 rc=${code}\n${stdout}`);
});

test("布局门：每项恰好一行结论，且报出「这轮扫到了几个」（非空跑自证）", () => {
  const { stdout } = runGate();
  const lines = stdout.split("\n").filter((line) => /^(PASS|FAIL)\s{2}LAYOUT\./.test(line));
  assert.ok(lines.length >= 6, `结论行过少: ${lines.length}`);
  const ids = lines.map((line) => line.trim().split(/\s{2,}/)[1]);
  assert.equal(new Set(ids).size, ids.length, "同一检查项不得重复出结论");
  assert.match(stdout, /这轮扫到：文档 \d+ \/ 交接单 \d+ \/ 状态副本 \d+/);
  assert.match(stdout, /^结论: /m);
});

test("布局门：被检查对象不存在时报 FAIL 并跑完，不崩（否则 rc=1 却一条结论都没有）", () => {
  // 在中立临时目录里只放"没有 AGENTS.md 的 plan/"，验证门走 FAIL 分支而不是抛异常逃逸。
  // 注意：必须跑**副本里的那份脚本**——门按自身路径定位仓库根，跑原路径时它仍在扫真仓库，
  // 缺档分支永远不会执行（"跑原路径即假门"，本项目实测踩过）。
  const sandbox = mkdtempSync(join(tmpdir(), "layout-gate-"));
  try {
    cpSync(join(ROOT, "plan"), join(sandbox, "plan"), { recursive: true });
    cpSync(join(ROOT, "README.md"), join(sandbox, "README.md"));
    cpSync(join(ROOT, "tools"), join(sandbox, "tools"), { recursive: true });
    const { code, stdout } = runGate(sandbox, join(sandbox, "tools", "check-sprint-layout.mjs"));
    assert.equal(code, 1, "缺 AGENTS.md 应判 FAIL（rc=1）");
    assert.match(stdout, /^FAIL\s{2}LAYOUT\.FILES\s+缺: AGENTS\.md/m);
    assert.match(stdout, /^结论: \d+ 项 FAIL/m, "应跑完并给出结论");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("布局门：落点都在仓库内文件上，不读 git 元数据（浅克隆/无 .git 形态下结论不变）", () => {
  const source = readFileSync(GATE, "utf8");
  const forbidden = ["execFileSync", "execSync", "spawnSync", "child_process"];
  const hit = forbidden.filter((needle) => source.includes(needle));
  assert.deepEqual(hit, [], `布局门不应依赖 git / 子进程（命中: ${hit.join(",")}）`);
});
