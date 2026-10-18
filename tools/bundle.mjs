// 极简 ESM → 单文件打包：按依赖顺序拼接，去掉相对 import 与 export 前缀。
// 只用 node: 内置模块；输出逐字节确定（无时间戳、无随机量）。

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const IMPORT_RE = /^import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?\s*$/gm;
const EXPORT_DECL_RE = /^export\s+(const|let|function|class)\s/gm;

export function resolveOrder(entry, readFile = (path) => readFileSync(path, "utf8")) {
  const seen = new Set();
  const order = [];

  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFile(file);
    const specifiers = [...source.matchAll(/^import\s*\{[^}]*\}\s*from\s*["']([^"']+)["']/gm)]
      .map((match) => match[1])
      .filter((spec) => spec.startsWith("."));
    for (const spec of specifiers) visit(resolve(dirname(file), spec));
    order.push(file);
  };
  visit(resolve(entry));
  return order;
}

export function stripModuleSyntax(source) {
  return source
    .replace(IMPORT_RE, "")
    .replace(EXPORT_DECL_RE, "$1 ")
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, "");
}

export function bundle(entry, { readFile } = {}) {
  const read = readFile ?? ((path) => readFileSync(path, "utf8"));
  const files = resolveOrder(entry, read);
  const parts = files.map((file) => {
    const source = stripModuleSyntax(read(file));
    return `// ---- ${file.replace(/\\/g, "/").split("/src/").pop()} ----\n${source.trim()}\n`;
  });
  return { files, code: parts.join("\n") };
}
