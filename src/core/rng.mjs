// 确定性随机数：xorshift128+，口径见 data/README.md §4.2。
// 禁止 Math.random / Date.now / 区域设置参与生成。

const MASK64 = (1n << 64n) - 1n;
const GOLDEN = 0x9e3779b97f4a7c15n;

function mix64(value) {
  let z = value & MASK64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

/** FNV-1a 64 位，用于把日期字符串归一成整数 seed。 */
export function fnv1a64(text) {
  const bytes = new TextEncoder().encode(String(text));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & MASK64;
  }
  return hash;
}

/** 整数 seed 取低 64 位；字符串 seed 走 FNV-1a。 */
export function normalizeSeed(seed) {
  if (typeof seed === "bigint") return seed & MASK64;
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) throw new TypeError("seed 必须是有限数字或字符串");
    if (!Number.isInteger(seed)) throw new TypeError("seed 必须是整数");
    if (seed < 0) return BigInt.asUintN(64, BigInt(seed));
    return BigInt(seed) & MASK64;
  }
  if (typeof seed === "string") return fnv1a64(seed);
  throw new TypeError("seed 必须是整数、bigint 或字符串");
}

/**
 * @param {number|bigint|string} seed
 * @returns {{nextU64: () => bigint, nextU32: () => number, nextInt: (n: number) => number, seed: bigint}}
 */
export function createRng(seed) {
  const normalized = normalizeSeed(seed);
  let state = normalized;
  const split = () => {
    state = (state + GOLDEN) & MASK64;
    return mix64(state);
  };
  let s0 = split();
  let s1 = split();
  if ((s0 | s1) === 0n) s0 = 1n;

  const nextU64 = () => {
    let x = s0;
    const y = s1;
    s0 = y;
    x ^= (x << 23n) & MASK64;
    x ^= x >> 17n;
    x ^= y;
    x ^= y >> 26n;
    s1 = x & MASK64;
    return (s1 + y) & MASK64;
  };

  return {
    seed: normalized,
    nextU64,
    nextU32() {
      return Number(nextU64() >> 32n);
    },
    nextInt(n) {
      if (!Number.isInteger(n) || n <= 0) throw new RangeError("nextInt 需要正整数上界");
      return Math.floor((this.nextU32() / 4294967296) * n);
    },
  };
}

/** 从随机流里取 [0, n) 的不重复下标序列（用于无放回抽取）。 */
export function pickDistinct(rng, n, count) {
  const pool = Array.from({ length: n }, (_, i) => i);
  const picked = [];
  const limit = Math.min(count, n);
  for (let i = 0; i < limit; i += 1) {
    const j = i + rng.nextInt(n - i);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    picked.push(pool[i]);
  }
  return picked;
}
