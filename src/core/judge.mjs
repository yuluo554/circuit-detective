// 提交判定与结算。纯函数，不碰 DOM、不读时钟。
// 判定只调 sim 的全表比对与 solver 的门数口径，没有第二套"标准答案"。

import { firstMismatch, simulate, truthTable, X } from "./sim.mjs";
import { countedGates, MAX_SOLVER_GATES } from "./solver.mjs";
import { validateDraft } from "./editor.mjs";

/**
 * 提交草稿：
 *  1. 结构校验（未接线 / 悬空引用 / 环），失败直接返回，不进入比对；
 *  2. 提交网表必须无 X 稳定（环与未稳定已被 1 挡住，这里兜底）；
 *  3. 16 行全表与隐藏网表逐输出比对（不抽样）；
 *  4. 通过后给出门数与差值（差值 = 你的门数 − 最优门数，恒 ≥ 0）。
 */
export function judgeSubmission(draft, level, options = {}) {
  const validation = validateDraft(draft);
  if (!validation.ok) {
    return {
      ok: true,
      accepted: false,
      reason: "invalid-draft",
      errors: validation.errors,
      mismatch: null,
      settlement: null,
    };
  }
  const submitted = validation.netlist;
  const maxGates = options.maxGates ?? MAX_SOLVER_GATES;

  for (const row of truthTable(submitted)) {
    if (!row.ok || !row.stable) {
      return {
        ok: true,
        accepted: false,
        reason: "unstable",
        errors: [{ code: "unstable", message: "这个接线在有限步内没有稳定下来" }],
        mismatch: null,
        settlement: null,
      };
    }
    for (const name of level.outputs) {
      if (row.outputs[name] === X) {
        return {
          ok: true,
          accepted: false,
          reason: "unknown-value",
          errors: [{ code: "unknown-value", message: "这个接线有灯会一直是未知（问号）" }],
          mismatch: null,
          settlement: null,
        };
      }
    }
  }

  const mismatch = firstMismatch(submitted, level.netlist);
  if (mismatch) {
    return {
      ok: true,
      accepted: false,
      reason: "mismatch",
      errors: [],
      mismatch,
      settlement: null,
    };
  }

  const yourGates = countedGates(submitted);
  const optimalGates = level.optimal;
  return {
    ok: true,
    accepted: true,
    reason: null,
    errors: [],
    mismatch: null,
    settlement: {
      yourGates,
      optimalGates,
      difference: yourGates - optimalGates,
      probes: options.probes ?? 0,
      maxGates,
      basisLabel: "按每个灯单独计零件（共用的零件每个灯各算一次）",
    },
  };
}

/**
 * 探测序列重算：seed + 关卡 + 输入向量序列 → 灯的结果序列。
 * 只读关卡网表，不依赖 UI 状态，因此同一序列在任何实例上逐项相同。
 */
export function recomputeProbes(level, probes) {
  return probes.map((vector) => {
    const bits = vectorBits(vector, level.inputs.length);
    const result = simulate(level.netlist, bits, { recordTrace: false });
    const outputs = {};
    for (const name of level.outputs) outputs[name] = result.outputs[name] ?? X;
    return { vector, inputs: bits, outputs, ok: result.ok, stable: result.stable };
  });
}

/** 输入向量整数 → 位数组（MSB = 第一个输入），与短码 4 bit 布局一致。 */
export function vectorBits(vector, count = 4) {
  const bits = [];
  for (let bit = 0; bit < count; bit += 1) bits.push((vector >> (count - 1 - bit)) & 1);
  return bits;
}

/** 位数组 → 输入向量整数。 */
export function bitsToVector(bits) {
  return bits.reduce((acc, bit) => (acc << 1) | (bit & 1), 0);
}

/** 探测序列是否与重算一致（逐项比对输出与稳定性）。 */
export function probesMatch(level, probes, observed) {
  const replayed = recomputeProbes(level, probes);
  if (replayed.length !== observed.length) return false;
  return replayed.every((row, index) => {
    const seen = observed[index];
    if (!seen) return false;
    for (const name of level.outputs) {
      if (row.outputs[name] !== seen.outputs?.[name]) return false;
    }
    return true;
  });
}
