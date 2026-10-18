#!/usr/bin/env node
// 发布终态自检门。三种模式：
//   默认（离线）     —— 只查仓库内文件与构建产物；网络项报 SKIP，不报 PASS
//   --pre-tag       —— tag 相关项报 SKIP（让本脚本能随预备提交进 tag 树）
//   --online        —— 追加远端检查（仓库公开、tag、Release、附件下载重算 sha256）
// 退出码：0 全绿 / 1 有 FAIL / 2 用法错误。环境缺失（gh 不在/未登录）单独 exit 3。
// 本脚本刻意不进 CI：发布前它本来就该红。

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const MODE = args.has("--online") ? "online" : args.has("--pre-tag") ? "pre-tag" : "offline";
// 发布留档路径（可用环境变量覆盖：让"缺档报 SKIP / 报 FAIL"这两条模式语义能在
// 留档已存在之后继续被测；见 tests/release-gate.test.mjs）。
const RELEASE_DOC_PATH = process.env.RELEASE_DOC_PATH ?? "plan/RELEASE-M6.md";

class EnvironmentMissing extends Error {}
class NotAchieved extends Error {}

const checks = [];
const add = (id, status, detail) => checks.push({ id, status, detail });

function readIfExists(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

function checkVersionSingleSource() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const manifest = readIfExists("src/core/version.mjs");
  const version = /VERSION\s*=\s*"([^"]+)"/.exec(manifest ?? "")?.[1];
  const same = Boolean(version) && version === pkg.version;
  add("VERSION_SINGLE_SOURCE", same ? "PASS" : "FAIL", `package=${pkg.version} code=${version ?? "(missing)"}`);
}

function checkRepoClean() {
  try {
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
    const lines = status.split("\n").filter(Boolean);
    add("WORKTREE_CLEAN", lines.length === 0 ? "PASS" : "FAIL", `${lines.length} 项未提交`);
  } catch (error) {
    add("WORKTREE_CLEAN", "FAIL", "git 不可用");
  }
}

function checkNoBuildArtifactsTracked() {
  try {
    const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const forbidden = tracked.filter(
      (path) => path.startsWith("dist/") || path.includes("node_modules/") || path.startsWith("release/"),
    );
    add("NO_ARTIFACTS_TRACKED", forbidden.length === 0 ? "PASS" : "FAIL", forbidden.join(",") || "0 项");
  } catch {
    add("NO_ARTIFACTS_TRACKED", "FAIL", "git 不可用");
  }
}

function checkVerifySample() {
  const text = readIfExists("docs/verify-sample.txt");
  if (!text) {
    add("VERIFY_SAMPLE", "FAIL", "docs/verify-sample.txt 缺失");
    return;
  }
  const required = ["p50ms", "p99ms", "solverRecheckPassRate", "externalLinks"];
  const missing = required.filter((needle) => !text.includes(needle));
  add("VERIFY_SAMPLE", missing.length === 0 ? "PASS" : "FAIL", missing.join(",") || "四项齐全");
}

function checkDocsPresent() {
  const required = ["README.md", "LICENSE", "data/README.md", "plan/00-README总览.md", "plan/05-里程碑与发布.md"];
  const missing = required.filter((path) => !existsSync(join(ROOT, path)));
  add("DOCS_PRESENT", missing.length === 0 ? "PASS" : "FAIL", missing.join(",") || "齐全");
}

function checkNoLocalPaths() {
  const scopes = ["README.md", "plan", "src", "tools", "data"];
  const hits = [];
  const skipDirs = new Set(["node_modules", ".git", "dist"]);
  const walk = (rel) => {
    const full = join(ROOT, rel);
    if (!existsSync(full)) return;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(full)) {
        if (skipDirs.has(entry)) continue;
        walk(join(rel, entry));
      }
      return;
    }
    if (!/\.(md|mjs|js|json|txt|html)$/.test(rel)) return;
    const text = readFileSync(full, "utf8");
    if (/[A-Za-z]:\\\\?Users\\\\|C:\/Users\/|D:\/ProgramData/.test(text)) hits.push(rel);
  };
  for (const scope of scopes) walk(scope);
  add("NO_LOCAL_PATHS", hits.length === 0 ? "PASS" : "FAIL", hits.join(",") || "0 命中");
}

function checkReleaseDoc() {
  const text = readIfExists(RELEASE_DOC_PATH);
  if (!text) {
    if (MODE === "pre-tag") {
      add("RELEASE_DOC", "SKIP", "tag 前尚未创建");
    } else {
      add("RELEASE_DOC", "FAIL", `${RELEASE_DOC_PATH} 缺失`);
    }
    return;
  }
  const hasBefore = /##\s*一、tag 前事实/.test(text);
  const hasAfter = /##\s*二、tag 后追加/.test(text);
  add("RELEASE_DOC", hasBefore && hasAfter ? "PASS" : "FAIL", `两栏: ${hasBefore}/${hasAfter}`);
}

function checkTag() {
  if (MODE !== "online") {
    add("TAG_PRESENT", "SKIP", `${MODE} 模式不查远端`);
    return;
  }
  try {
    const local = execFileSync("git", ["rev-parse", "v0.1.0"], { cwd: ROOT, encoding: "utf8" }).trim();
    add("TAG_PRESENT", local.length === 40 ? "PASS" : "FAIL", `local tag object ${local.slice(0, 12)}`);
  } catch {
    add("TAG_PRESENT", "FAIL", "本地无 v0.1.0 tag");
  }
}

function checkRemote() {
  if (MODE !== "online") {
    add("REMOTE_RELEASE", "SKIP", `${MODE} 模式不查远端`);
    return;
  }
  try {
    const json = execFileSync(
      "gh",
      ["release", "view", "v0.1.0", "--json", "isDraft,assets,tagName"],
      { cwd: ROOT, encoding: "utf8" },
    );
    const data = JSON.parse(json);
    const assets = (data.assets ?? []).map((asset) => asset.name);
    add("REMOTE_RELEASE", !data.isDraft && assets.length >= 2 ? "PASS" : "FAIL", `${data.tagName} draft=${data.isDraft} assets=${assets.join(",")}`);
  } catch (error) {
    const message = String(error.stderr ?? error.message);
    if (/gh: command not found|not logged|authentication/i.test(message)) {
      throw new EnvironmentMissing("gh 不可用或未登录");
    }
    throw new NotAchieved(`Release 不可达: ${message.split("\n")[0]}`);
  }
}

function main() {
  const offlineChecks = [
    checkVersionSingleSource,
    checkRepoClean,
    checkNoBuildArtifactsTracked,
    checkVerifySample,
    checkDocsPresent,
    checkNoLocalPaths,
    checkReleaseDoc,
    checkTag,
  ];
  for (const run of offlineChecks) {
    try {
      run();
    } catch (error) {
      add(run.name, "FAIL", error.message);
    }
  }
  try {
    checkRemote();
  } catch (error) {
    if (error instanceof EnvironmentMissing) {
      add("REMOTE_RELEASE", "SKIP", error.message);
      report();
      process.exitCode = 3;
      return;
    }
    add("REMOTE_RELEASE", "FAIL", error.message);
  }
  report();
  const failed = checks.filter((check) => check.status === "FAIL");
  process.exitCode = failed.length === 0 ? 0 : 1;
}

function report() {
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const check of checks) counts[check.status] += 1;
  process.stdout.write(`发布终态自检 · 模式=${MODE}\n`);
  process.stdout.write("=".repeat(48) + "\n");
  for (const check of checks) {
    process.stdout.write(`${check.status.padEnd(4)}  ${check.id}  ${check.detail}\n`);
  }
  process.stdout.write("=".repeat(48) + "\n");
  process.stdout.write(`PASS ${counts.PASS} / FAIL ${counts.FAIL} / SKIP ${counts.SKIP}\n`);
  process.stdout.write("SKIP 不计入 PASS；发布前本门允许红。\n");
}

main();
