// 求解器：在声明的门基（NOT / AND / OR）下给出最少门数。
// 口径见 data/README.md §4.3 与 plan/00 决策 D14：
//   · 每个输出端口单独计数（输出锥内部门数之和；共享门按使用它的输出各计一次）
//   · 单输出最少数 = 公式复杂度：{AND, OR, NOT} + 输入变量，精确动态规划
// 因此求解结果是"在声明口径下的可证明最小值"，不是理论绝对最优。

import { inputCombinations } from "./sim.mjs";

const MASK16 = 0xffff;

/** 输入变量掩码：第 j 个输入在第 i 行（inputCombinations 顺序）为 1 时置位。 */
export function inputMasks(count) {
  const rows = inputCombinations(count);
  return Array.from({ length: count }, (_, j) => {
    let mask = 0;
    rows.forEach((row, index) => {
      if (row[j] === 1) mask |= 1 << index;
    });
    return mask;
  });
}

/**
 * 建成本表：cost[mask] = 用 NOT/AND/OR 计算该 16 位函数所需的最少门数（-1 = 未达）。
 * 按门数递增分层展开，与门数上限无关的成本表只需建一次。
 */
export function buildCostTable(inputCount, maxGates) {
  if (inputCount < 1 || inputCount > 4) throw new RangeError("首期只支持 1–4 个输入");
  const cost = new Int16Array(1 << 16).fill(-1);
  const levels = [[]];
  const vars = inputMasks(inputCount);
  for (const mask of vars) {
    if (cost[mask] === -1) {
      cost[mask] = 0;
      levels[0].push(mask);
    }
  }
  for (let k = 1; k <= maxGates; k += 1) {
    const fresh = new Set();
    for (let i = 0; i < k; i += 1) {
      const j = k - 1 - i;
      if (!levels[i] || !levels[j]) continue;
      const left = levels[i];
      const right = levels[j];
      for (const a of left) {
        for (const b of right) {
          const andMask = a & b;
          if (cost[andMask] === -1) {
            cost[andMask] = k;
            fresh.add(andMask);
          }
          const orMask = a | b;
          if (cost[orMask] === -1) {
            cost[orMask] = k;
            fresh.add(orMask);
          }
        }
      }
    }
    const prev = levels[k - 1] || [];
    for (const a of prev) {
      const notMask = ~a & MASK16;
      if (cost[notMask] === -1) {
        cost[notMask] = k;
        fresh.add(notMask);
      }
    }
    levels.push([...fresh].sort((x, y) => x - y));
  }
  return { cost, vars, maxGates };
}

const tableCache = new Map();

export function costTable(inputCount, maxGates) {
  const key = `${inputCount}:${maxGates}`;
  if (!tableCache.has(key)) tableCache.set(key, buildCostTable(inputCount, maxGates));
  return tableCache.get(key);
}

/** 单个输出函数的最少门数；不可达返回 -1。 */
export function minimalGatesForMask(mask, inputCount, maxGates) {
  const { cost } = costTable(inputCount, maxGates);
  return cost[mask & MASK16];
}

/** 输出锥（含该输出映射到的信号及其上游门）。 */
export function coneOf(netlist, outputName) {
  const gateById = new Map(netlist.gates.map((gate) => [gate.id, gate]));
  const seen = new Set();
  const stack = [netlist.outputsMap[outputName]];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id) || !gateById.has(id)) continue;
    seen.add(id);
    for (const src of gateById.get(id).in) stack.push(src);
  }
  return seen;
}

/**
 * 按声明口径计算提交网表的门数：各输出锥内部门数之和。
 * 未使用的门不计分（不惩罚玩家摆放的草稿），但也不能用来"凑数"。
 */
export function countedGates(netlist) {
  const seen = new Set();
  for (const name of netlist.outputs) {
    for (const id of coneOf(netlist, name)) seen.add(`${name}:${id}`);
  }
  return seen.size;
}

/**
 * 求解一个真值表集合的最少门数（按声明口径求和）。
 * @param {Record<string, number>} masks 输出端口 → 16 位掩码
 * @param {number} inputCount
 * @param {number} maxGates
 */
export function solveOptimal(masks, inputCount, maxGates) {
  const { cost } = costTable(inputCount, maxGates);
  const perOutput = {};
  let total = 0;
  for (const [name, mask] of Object.entries(masks)) {
    const value = cost[mask & MASK16];
    perOutput[name] = value;
    if (value < 0) return { optimal: -1, perOutput, reason: "unreachable" };
    total += value;
  }
  return { optimal: total, perOutput, reason: null };
}
