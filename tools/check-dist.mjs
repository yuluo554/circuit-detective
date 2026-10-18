#!/usr/bin/env node
// 产物静态扫描：零外链 / 体积 / 必需骨架。构建后跑，也可被 verify 复用。

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "dist", "index.html");
const EXTERNAL_RE = /https?:\/\//gi;
const EXTERNAL_MAX = 0;

export function scanDist(text) {
  const external = [...text.matchAll(EXTERNAL_RE)].map((match) => match[0]);
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    gzipBytes: gzipSync(Buffer.from(text, "utf8"), { level: 9 }).length,
    externalLinks: external.length,
    hasInlineScript: text.includes('<script type="module">'),
    hasCanvas: text.includes('id="board"'),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (!existsSync(FILE)) {
    process.stderr.write("dist/index.html 不存在；先跑 npm run build\n");
    process.exitCode = 1;
  } else {
    const report = scanDist(readFileSync(FILE, "utf8"));
    const ok =
      report.externalLinks <= EXTERNAL_MAX && report.hasInlineScript && report.hasCanvas;
    process.stdout.write(
      `${ok ? "PASS" : "FAIL"} dist: ${report.bytes} 字节 / gzip ${report.gzipBytes} 字节 / 外链 ${report.externalLinks}\n`,
    );
    if (!ok) process.exitCode = 1;
  }
}
