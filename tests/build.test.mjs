import test from "node:test";
import assert from "node:assert/strict";
import { build } from "../tools/build.mjs";

test("构建产物：单文件、内联模块、无外部 URL", () => {
  const { html, files, bytes } = build({ write: false });
  assert.ok(bytes > 1000);
  assert.ok(files.length >= 3);
  assert.ok(html.includes("<script type=\"module\">"));
  assert.ok(!html.includes('src="./src/ui/app.mjs"'));
  assert.ok(!/https?:\/\//i.test(html), "构建产物不得包含外部 URL");
});

test("构建确定性：同一份源码两次构建逐字节一致", () => {
  const first = build({ write: false }).html;
  const second = build({ write: false }).html;
  assert.equal(first, second);
});

test("构建产物不含未替换的入口引用与未定义符号", () => {
  const { html } = build({ write: false });
  assert.ok(!html.includes('src="./src/'), "产物不得残留外部模块入口");
  assert.ok(!html.includes("undefined"));
});

test("构建产物保留页面骨架标识", () => {
  const { html } = build({ write: false });
  assert.ok(html.includes("黑盒电路侦探"));
  assert.ok(html.includes('id="board"'));
  assert.ok(html.includes("canvas"));
});
