import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EARLY_LEVEL_LIMIT, EARLY_TERMS, copyFor, flattenCopy, forbiddenTermHits } from "../src/ui/copy.mjs";
import { campaignIndexFromSeed, campaignOptions, campaignSeed, CAMPAIGN_LAST } from "../src/ui/level-source.mjs";
import { generateLevel } from "../src/core/generator.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("D1 术语门槛：前 3 关的界面文案不出现 门 / NAND / AND / OR / NOT", () => {
  for (let index = 1; index <= EARLY_LEVEL_LIMIT; index += 1) {
    const copy = copyFor(index);
    assert.equal(copy.mode, "basic");
    const hits = forbiddenTermHits(copy);
    assert.deepEqual(hits, [], `第 ${index} 关出现禁用术语: ${JSON.stringify(hits)}`);
  }
});

test("D1 反面对照：扫描器真的能抓到术语（不是空跑）", () => {
  const bad = { ...copyFor(1), hintProbe: "这里有个门" };
  const hits = forbiddenTermHits(bad);
  assert.ok(hits.length > 0);
  assert.equal(hits[0].term, "门");
  const bad2 = { ...copyFor(1), palette: { NOT: "NOT 非门", AND: "AND", OR: "OR" } };
  assert.ok(forbiddenTermHits(bad2).length >= 3);
});

test("D1 边界：第 4 关起才出现正式名称（学习曲线藏在玩法后面）", () => {
  const full = copyFor(4);
  assert.equal(full.mode, "full");
  assert.ok(Object.values(full.palette).some((text) => text.includes("NOT")));
  assert.ok(Object.values(full.palette).some((text) => text.includes("AND")));
  assert.ok(Object.values(full.palette).some((text) => text.includes("OR")));
  assert.equal(copyFor(null).mode, "full");
  assert.equal(copyFor(undefined).mode, "full");
});

test("D1 术语门槛：前 3 关每个文案字段都被扫描到（无遗漏路径）", () => {
  const items = flattenCopy(copyFor(1));
  assert.ok(items.length >= 30, `扫描到的文案字段过少: ${items.length}`);
  const labels = items.map((item) => item.label);
  for (const required of ["palette.NOT", "palette.AND", "palette.OR", "settlement.yourGates", "mismatch"]) {
    assert.ok(labels.includes(required), `缺少字段: ${required}`);
  }
});

test("D1 术语门槛：index.html 的静态文案也不含禁用术语", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const hits = EARLY_TERMS.filter((term) => visible.includes(term));
  assert.deepEqual(hits, [], `index.html 可见文案含禁用术语: ${hits.join(",")}`);
});

test("战役种子：前 3 关预算更低，且都能生成", () => {
  assert.equal(campaignIndexFromSeed(campaignSeed(1)), 1);
  assert.equal(campaignIndexFromSeed("2026-10-19"), null);
  assert.equal(campaignIndexFromSeed(campaignSeed(CAMPAIGN_LAST + 1)), null);
  for (let index = 1; index <= EARLY_LEVEL_LIMIT; index += 1) {
    const options = campaignOptions(index);
    assert.equal(options.gateBudget, 2);
    const { ok, level } = generateLevel(campaignSeed(index), options);
    assert.equal(ok, true);
    assert.equal(level.optimal, 2);
    assert.equal(level.difficulty, "easy");
    // 隐藏实现里不得有恒等冗余门（AND(i,i) / OR(i,i)）
    for (const gate of level.netlist.gates) {
      assert.notEqual(gate.in[0], gate.in[1], `第 ${index} 关有冗余门 ${gate.id}`);
    }
  }
});

test("生成器：任何关卡的隐藏网表都不含恒等冗余门", () => {
  for (let seed = 0; seed < 400; seed += 1) {
    const { level } = generateLevel(seed);
    for (const gate of level.netlist.gates) {
      if (gate.in.length !== 2) continue;
      assert.notEqual(gate.in[0], gate.in[1], `seed ${seed} 的 ${gate.id} 是冗余门`);
    }
  }
});

test("战役种子：后续关卡预算回升，且同一关两次生成相同", () => {
  const seed = campaignSeed(5);
  const first = generateLevel(seed, campaignOptions(5));
  const second = generateLevel(seed, campaignOptions(5));
  assert.equal(first.ok, true);
  assert.equal(first.json, second.json);
  assert.ok(first.level.optimal >= 2);
});
