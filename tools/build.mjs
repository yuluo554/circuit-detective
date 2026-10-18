#!/usr/bin/env node
// 构建：把 src/ 打成一个零外链单文件 dist/index.html。
// 输出逐字节确定：无时间戳、无随机量、文件顺序固定。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "./bundle.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

const EXTERNAL_RE = /https?:\/\//i;

export function build({ root = ROOT, write = true } = {}) {
  const template = readFileSync(join(root, "index.html"), "utf8").replace(/\r\n/g, "\n");
  const { files, code } = bundle(join(root, "src", "ui", "app.mjs"));

  if (EXTERNAL_RE.test(template) || EXTERNAL_RE.test(code)) {
    throw new Error("构建产物出现外部 URL：违反零外链约束");
  }

  const inline = `<script type="module">\n${code}\n</script>`;
  const html = template
    .replace('<script type="module" src="./src/ui/app.mjs"></script>', inline)
    .replace(/\n{3,}/g, "\n\n");

  if (write) {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "index.html"), html, "utf8");
  }
  return { html, files, bytes: Buffer.byteLength(html, "utf8") };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const { bytes, files } = build();
    process.stdout.write(`构建完成: dist/index.html (${bytes} 字节, ${files.length} 个模块)\n`);
  } catch (error) {
    process.stderr.write(`构建失败: ${error.message}\n`);
    process.exitCode = 1;
  }
}
