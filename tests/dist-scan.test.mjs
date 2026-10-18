import test from "node:test";
import assert from "node:assert/strict";
import { scanDist } from "../tools/check-dist.mjs";

const good = '<html><body><canvas id="board"></canvas><script type="module">const a=1;</script></body></html>';

test("静态扫描：干净产物通过", () => {
  const report = scanDist(good);
  assert.equal(report.externalLinks, 0);
  assert.equal(report.hasInlineScript, true);
  assert.equal(report.hasCanvas, true);
});

test("静态扫描：外链被计数（阳性对照）", () => {
  assert.equal(scanDist(`${good}<img src="https://cdn.example/x.png">`).externalLinks, 1);
  assert.equal(scanDist(`${good}<a href="http://a"></a><a href="https://b"></a>`).externalLinks, 2);
});

test("静态扫描：缺失骨架被识别", () => {
  const report = scanDist("<html></html>");
  assert.equal(report.hasInlineScript, false);
  assert.equal(report.hasCanvas, false);
});

test("静态扫描：gzip 小于原始体积", () => {
  const report = scanDist(good.repeat(50));
  assert.ok(report.gzipBytes < report.bytes);
});
