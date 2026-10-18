import test from "node:test";
import assert from "node:assert/strict";
import { generateLevel, difficultyOf, MAX_REDRAWS } from "../src/core/generator.mjs";
import { truthTableMasks } from "../src/core/sim.mjs";
import { solveOptimal } from "../src/core/solver.mjs";

test("同一 seed 两次生成字节级相同", () => {
  const first = generateLevel("2026-10-19");
  const second = generateLevel("2026-10-19");
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.json, second.json);
});

test("生成的关卡：求解器复核一致、无 X、可通过网表校验", () => {
  for (let seed = 0; seed < 60; seed += 1) {
    const result = generateLevel(seed);
    assert.equal(result.ok, true, `seed ${seed} 生成失败`);
    const { masks, hasX } = truthTableMasks(result.level.netlist);
    assert.ok(Object.values(hasX).every((value) => value === false));
    const solved = solveOptimal(masks, 4, 12);
    assert.equal(solved.optimal, result.level.optimal);
  }
});

test("难度分档由求解器给出的最少门数决定", () => {
  assert.equal(difficultyOf(2), "easy");
  assert.equal(difficultyOf(3), "normal");
  assert.equal(difficultyOf(4), "normal");
  assert.equal(difficultyOf(5), "hard");
  assert.equal(difficultyOf(9), "hard");
});

test("不合格 seed 显式失败，不静默换 seed", () => {
  const result = generateLevel(1, { minOptimal: 99 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "level-generation-failed");
  assert.equal(result.attempts, MAX_REDRAWS);
  assert.ok(result.message.includes("1"));
});

test("输出端口互不相同：至少两个不同的输出函数", () => {
  for (let seed = 100; seed < 130; seed += 1) {
    const { level } = generateLevel(seed);
    const { masks } = truthTableMasks(level.netlist);
    assert.ok(new Set(Object.values(masks)).size >= 2);
  }
});
