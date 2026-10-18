#!/usr/bin/env node
// 本地静态服务器（仅回环地址，零依赖）。用于 file:// 被浏览器拒绝时的人工验看。

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  const path = join(ROOT, relative === "" ? "index.html" : relative);
  if (!path.startsWith(ROOT)) {
    response.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(path);
    response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});

const port = Number(process.env.PORT ?? 4173);
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`本地预览: http://127.0.0.1:${port}/ (Ctrl+C 退出)\n`);
});
