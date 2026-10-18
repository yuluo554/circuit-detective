#!/usr/bin/env node
// 本地静态服务器（仅回环地址，零依赖）。用于 file:// 被浏览器拒绝时的人工验看，
// 也供跨引擎校验脚本以 http 源加载 ESM 模块。

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

/** 建一个只服务 ROOT 的静态服务器（已 listen）。 */
export function startStaticServer({ root = ROOT, port = 0, host = "127.0.0.1" } = {}) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    const path = join(root, relative === "" ? "index.html" : relative);
    if (!path.startsWith(root)) {
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
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolvePromise({
        server,
        port: address.port,
        origin: `http://${host}:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const port = Number(process.env.PORT ?? 4173);
  const handle = await startStaticServer({ port });
  process.stdout.write(`本地预览: ${handle.origin}/ (Ctrl+C 退出)\n`);
}
