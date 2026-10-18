// 分享与回放：把一次结算压成短码，或把短码还原成"可回放的一关"。
// 纯计算：不碰 DOM、不读时钟、不发网络请求；文案由 ui/copy.mjs 提供（D1 单点）。
// 口径见 data/README.md §4.5（位布局 / 长度上限 / CRC）。

import { decodeRecord, encodeRecord, MAX_CODE_LENGTH, RECORD_VERSION } from "./replay.mjs";
import { recomputeProbes } from "./judge.mjs";
import { MAX_SOLVER_GATES, solveOptimal } from "./solver.mjs";
import { truthTableMasks } from "./sim.mjs";

export const SHARE_OVERFLOW_REASON = "code-overflow";

/** 分享文案需要的最小信息：探测次数 + 门数差 + 短码（超长时只剩前两项 + 种子）。 */
function summary(probes, difference) {
  return {
    probes: probes.length,
    difference: Number.isInteger(difference) ? difference : null,
  };
}

/**
 * 生成分享载荷。
 * 成功 → {ok:true, code, length, limit, version, probes, difference}
 * 失败 → {ok:false, reason, message, probes, difference}
 *        （调用方走降级文案：只分享种子 + 探测次数，不截断短码、不丢探测步骤）
 */
export function sharePayload({ seed, probes, netlist, difference }) {
  const list = Array.isArray(probes) ? [...probes] : [];
  try {
    const code = encodeRecord({ seed, probes: list, netlist });
    return {
      ok: true,
      reason: null,
      message: "",
      code,
      length: code.length,
      limit: MAX_CODE_LENGTH,
      version: RECORD_VERSION,
      ...summary(list, difference),
    };
  } catch (error) {
    const code = (error && error.code) || "";
    return {
      ok: false,
      reason: code === SHARE_OVERFLOW_REASON ? SHARE_OVERFLOW_REASON : "code-encode-failed",
      message: String((error && error.message) || error),
      code: null,
      length: Number.isInteger(error && error.length) ? error.length : 0,
      limit: MAX_CODE_LENGTH,
      version: RECORD_VERSION,
      ...summary(list, difference),
    };
  }
}

/**
 * 短码 → 回放数据。
 * 解码失败（篡改 / 截断 / 版本不兼容 / 非法字符）直接抛错，由 UI 明确提示，
 * 绝不"退而求其次"进普通关卡。
 * 返回的 level 与生成器产物同形（inputs / outputs / netlist / optimal），
 * 因此 recomputeProbes、buildRevealPlan、countedGates 都能原样复用。
 */
export function decodeReplay(code) {
  const record = decodeRecord(code);
  const netlist = record.netlist;
  const level = {
    seed: record.seedText,
    label: `replay-${record.seedText}`,
    inputs: [...netlist.inputs],
    outputs: [...netlist.outputs],
    netlist,
  };
  const { masks } = truthTableMasks(netlist);
  // 与生成器同一上限：解码侧重算的最优门数必须与分享者的 level.optimal 相等。
  const solved = solveOptimal(masks, level.inputs.length, MAX_SOLVER_GATES);
  level.optimal = solved.optimal;
  return {
    version: record.version,
    seed: record.seed,
    seedText: record.seedText,
    probes: [...record.probes],
    level,
    optimal: solved.optimal,
    steps: recomputeProbes(level, record.probes),
  };
}
