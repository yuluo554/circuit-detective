// 求解器：在声明的门基（NOT / AND / OR）下给出最少门数。
// 口径见 data/README.md §4.3 与 plan/00 决策 D14：
//   · 每个输出端口单独计数（输出锥内部门数之和；共享门按使用它的输出各计一次）
//   · 单输出最少数 = 公式复杂度：{AND, OR, NOT} + 输入变量，精确动态规划
// 因此求解结果是"在声明口径下的可证明最小值"，不是理论绝对最优。

import { inputCombinations } from "./sim.mjs";

const MASK16 = 0xffff;

/** 求解器门数上限（首期 12）。生成器与结算共用这一处。 */
export const MAX_SOLVER_GATES = 12;

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
  const op = new Uint8Array(1 << 16); // 0 未定 / 1 AND / 2 OR / 3 NOT
  const left = new Int32Array(1 << 16).fill(-1);
  const right = new Int32Array(1 << 16).fill(-1);
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
      const aLevel = levels[i];
      const bLevel = levels[j];
      for (const a of aLevel) {
        for (const b of bLevel) {
          const andMask = a & b;
          if (cost[andMask] === -1) {
            cost[andMask] = k;
            op[andMask] = 1;
            left[andMask] = a;
            right[andMask] = b;
            fresh.add(andMask);
          }
          const orMask = a | b;
          if (cost[orMask] === -1) {
            cost[orMask] = k;
            op[orMask] = 2;
            left[orMask] = a;
            right[orMask] = b;
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
        op[notMask] = 3;
        left[notMask] = a;
        fresh.add(notMask);
      }
    }
    levels.push([...fresh].sort((x, y) => x - y));
  }
  return { cost, op, left, right, vars, maxGates };
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
 * 按声明口径计算提交网表的门数：每个输出锥内**按引用展开后**的门数之和。
 * 共享门每被引用一次计一次（同一输出内的重复引用也各计一次），未使用的门不计分。
 * 口径与单输出公式复杂度对齐：展开后的计数即该输出的公式规模，因此
 * `countedGates(submitted) >= optimal` 恒成立（差值为负会破坏结算语义）。
 */
export function countedGates(netlist) {
  const gateById = new Map(netlist.gates.map((gate) => [gate.id, gate]));
  let total = 0;
  for (const name of netlist.outputs) {
    total += countUses(netlist.outputsMap[name], gateById, new Set());
  }
  return total;
}

function countUses(signal, gateById, stack) {
  const gate = gateById.get(signal);
  if (!gate || stack.has(gate.id)) return 0; // 输入端口计 0；环不再展开
  stack.add(gate.id);
  let total = 1;
  for (const src of gate.in) total += countUses(src, gateById, stack);
  stack.delete(gate.id);
  return total;
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

/**
 * 按成本表的构造痕迹展开一个函数的最优公式。
 * 用来证明"最优门数确实可达"：生成的网表门数 == 该函数的最少门数。
 * 返回 {gates, signal}，门 id 由调用方给的工厂分配。
 */
export function formulaForMask(mask, inputCount, maxGates, nextId) {
  const { cost, op, left, right, vars } = costTable(inputCount, maxGates);
  const gates = [];

  const build = (node) => {
    const value = node & MASK16;
    const varIndex = vars.indexOf(value);
    if (cost[value] === 0 && varIndex >= 0) return `i${varIndex}`;
    if (cost[value] < 0) throw new Error(`函数 ${value.toString(16)} 在门数上限内不可达`);
    const id = nextId();
    const kind = op[value];
    if (kind === 1) gates.push({ id, type: "AND", in: [build(left[value]), build(right[value])] });
    else if (kind === 2) gates.push({ id, type: "OR", in: [build(left[value]), build(right[value])] });
    else if (kind === 3) gates.push({ id, type: "NOT", in: [build(left[value])] });
    else throw new Error(`成本表缺少构造痕迹: ${value.toString(16)}`);
    return id;
  };

  const signal = build(mask);
  // 递归是后序的，gates 已按依赖先于使用者的顺序排列。
  return { gates, signal };
}

/**
 * 用求解器结果构造一个"最优网表"：每个输出各建一棵独立公式（不共享），
 * 因此 countedGates(结果) == solveOptimal(masks).optimal。
 */
export function optimalNetlist(masks, inputCount, maxGates, outputs) {
  const names = outputs ?? Object.keys(masks);
  let counter = 1;
  const nextId = () => `w${String(counter++).padStart(2, "0")}`;
  const gates = [];
  const outputsMap = {};
  for (const name of names) {
    const { gates: built, signal } = formulaForMask(masks[name], inputCount, maxGates, nextId);
    gates.push(...built);
    outputsMap[name] = signal;
  }
  const netlist = {
    inputs: Array.from({ length: inputCount }, (_, i) => `i${i}`),
    outputs: [...names],
    gates,
    outputsMap,
  };
  return netlist;
}
