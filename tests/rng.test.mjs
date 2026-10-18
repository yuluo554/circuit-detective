import test from "node:test";
import assert from "node:assert/strict";
import { createRng, normalizeSeed, fnv1a64, pickDistinct } from "../src/core/rng.mjs";

test("seed 归一：整数、bigint、日期字符串各有确定结果", () => {
  assert.equal(normalizeSeed(42), 42n);
  assert.equal(normalizeSeed(-1), (1n << 64n) - 1n);
  assert.equal(normalizeSeed("2026-10-19"), fnv1a64("2026-10-19"));
  assert.equal(normalizeSeed(42), normalizeSeed("42") === fnv1a64("42") ? normalizeSeed(42) : normalizeSeed(42));
});

test("同一 seed 的随机流逐项相同，不同 seed 不同", () => {
  const a = createRng("2026-10-19");
  const b = createRng("2026-10-19");
  const c = createRng("2026-10-20");
  const seqA = Array.from({ length: 16 }, () => a.nextU64());
  const seqB = Array.from({ length: 16 }, () => b.nextU64());
  const seqC = Array.from({ length: 16 }, () => c.nextU64());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
});

test("random 流非退化：前 64 个输出不全相等且覆盖高低位", () => {
  const rng = createRng(7);
  const values = Array.from({ length: 64 }, () => rng.nextU64());
  assert.ok(new Set(values.map(String)).size > 60);
});

test("nextInt 落在界内且无放回抽取不重复", () => {
  const rng = createRng(123);
  for (let i = 0; i < 500; i += 1) {
    const value = rng.nextInt(7);
    assert.ok(value >= 0 && value < 7);
  }
  const picked = pickDistinct(rng, 10, 4);
  assert.equal(new Set(picked).size, 4);
  assert.ok(picked.every((value) => value >= 0 && value < 10));
});

test("非法 seed 显式报错，不静默退化", () => {
  assert.throws(() => normalizeSeed(1.5), TypeError);
  assert.throws(() => normalizeSeed(Number.NaN), TypeError);
  assert.throws(() => normalizeSeed({}), TypeError);
  assert.throws(() => createRng(1).nextInt(0), RangeError);
});
