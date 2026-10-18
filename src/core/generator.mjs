// 关卡生成器：seed → xorshift128+ → 随机网表 → 求解器复核 → 关卡 JSON。
// 确定性纪律见 data/README.md §4.2：同 seed 生成字节级相同的关卡。

import { createRng, pickDistinct } from "./rng.mjs";
import { gateArity, levelToJson, validateNetlist } from "./netlist.mjs";
import { truthTableMasks } from "./sim.mjs";
import { solveOptimal } from "./solver.mjs";

export const LEVEL_FORMAT = "circuit-detective/level";
export const LEVEL_VERSION = 1;
export const DEFAULT_MAX_GATES = 12;
export const MAX_REDRAWS = 64;
export const GATE_BASIS = Object.freeze(["NOT", "AND", "OR"]);

const DIFFICULTY_BANDS = Object.freeze([
  { name: "easy", maxOptimal: 4 },
  { name: "normal", maxOptimal: 7 },
  { name: "hard", maxOptimal: 12 },
]);

export function difficultyOf(optimal) {
  for (const band of DIFFICULTY_BANDS) {
    if (optimal <= band.maxOptimal) return band.name;
  }
  return "hard";
}

/** 生成一版候选网表（可能无用，由复核决定是否接受）。 */
function randomNetlist(rng, inputCount, outputCount, gateBudget) {
  const inputs = Array.from({ length: inputCount }, (_, i) => `i${i}`);
  const gates = [];
  const available = [...inputs];
  const gateCount = 2 + rng.nextInt(Math.max(1, gateBudget - 1));
  for (let index = 0; index < gateCount; index += 1) {
    const type = GATE_BASIS[rng.nextInt(GATE_BASIS.length)];
    const arity = gateArity(type);
    const pins = [];
    for (let pin = 0; pin < arity; pin += 1) {
      pins.push(available[rng.nextInt(available.length)]);
    }
    const id = `g${String(index + 1).padStart(2, "0")}`;
    gates.push({ id, type, in: pins });
    available.push(id);
  }

  const outputs = Array.from({ length: outputCount }, (_, i) => `o${i}`);
  const outputsMap = {};
  const chosen = pickDistinct(rng, available.length, outputCount);
  outputs.forEach((name, index) => {
    outputsMap[name] = available[chosen[index]];
  });
  return { inputs, outputs, gates, outputsMap };
}

function fingerprint(netlist, masks) {
  return netlist.outputs.map((name) => `${name}:${masks[name].toString(16)}`).join("|");
}

/**
 * 生成关卡。失败时返回 {ok:false, code, message}，不抛异常、不静默换 seed。
 */
export function generateLevel(seed, options = {}) {
  const inputCount = options.inputCount ?? 4;
  const outputCount = options.outputCount ?? 4;
  const gateBudget = options.gateBudget ?? 8;
  const maxGates = options.maxGates ?? DEFAULT_MAX_GATES;
  const minOptimal = options.minOptimal ?? 2;
  const rng = createRng(seed);

  for (let attempt = 0; attempt < MAX_REDRAWS; attempt += 1) {
    const netlist = randomNetlist(rng, inputCount, outputCount, gateBudget);
    const check = validateNetlist(netlist);
    if (!check.ok) continue;

    const { masks, hasX } = truthTableMasks(netlist);
    if (Object.values(hasX).some(Boolean)) continue;

    const distinct = new Set(Object.values(masks));
    if (distinct.size < 2) continue;

    const solved = solveOptimal(masks, inputCount, maxGates);
    if (solved.optimal < minOptimal) continue;
    if (solved.optimal > gateBudget) continue;

    const level = {
      format: LEVEL_FORMAT,
      version: LEVEL_VERSION,
      id: `seed-${String(rng.seed)}`,
      seed: String(rng.seed),
      label: String(seed),
      difficulty: difficultyOf(solved.optimal),
      inputs: netlist.inputs,
      outputs: netlist.outputs,
      netlist,
      optimal: solved.optimal,
      optimalPerOutput: solved.perOutput,
      fingerprint: fingerprint(netlist, masks),
    };
    return { ok: true, level, json: levelToJson(level), attempts: attempt + 1 };
  }

  return {
    ok: false,
    code: "level-generation-failed",
    message: `seed ${String(seed)} 在 ${MAX_REDRAWS} 次重抽内未得到合格关卡`,
    attempts: MAX_REDRAWS,
  };
}

/** 每日题：日期字符串（YYYY-MM-DD）直接作为 seed 走 FNV-1a。 */
export function dailySeed(dateString) {
  return dateString;
}
